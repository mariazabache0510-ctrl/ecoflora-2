// Parte 2 del parcial: la aplicación conectada A LA VEZ a dos servidores relacionales distintos.
//
//   PostgreSQL (PG_URL)   -> tablas cliente y producto, y la tabla externa factura_mysql (mysql_fdw)
//   MySQL      (MYSQL_URL) -> tabla factura
//
// La tienda sigue guardando todo en MongoDB (catálogo, usuarios, pedidos). Esta capa COPIA a los dos servidores lo que
// necesita el sistema de información: clientes y productos a Postgres, facturas a MySQL. Desde Postgres, la vista
// v_ventas_federada une las dos bases en una sola consulta (cliente + producto en Postgres, factura en MySQL).
//
// Si no hay URLs (ni variables sueltas de host/clave), todo esto queda apagado y la tienda no cambia.
// Y si un servidor falla, el pedido igual se guarda: el error se anota en el log y "Sincronizar ahora" lo repone.

const { Pool } = require('pg');
const mysql = require('mysql2/promise');

const TIEMPO_CONEXION_MS = 8000;

let pgPool = null;
let mysqlPool = null;

function codificar(valor) {
  return encodeURIComponent(String(valor));
}

// Acepta PG_URL completa (local) o piezas PGHOST/PGPASSWORD/... (Render private services).
function pgUrl() {
  const directa = String(process.env.PG_URL || '').trim();
  if (directa) return directa;
  const host = String(process.env.PGHOST || '').trim();
  const password = String(process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || process.env.PG_PASSWORD || '').trim();
  if (!host || !password) return '';
  const user = String(process.env.PGUSER || 'ecoflora').trim() || 'ecoflora';
  const port = String(process.env.PGPORT || '5432').trim() || '5432';
  const database = String(process.env.PGDATABASE || 'ecoflora_pg').trim() || 'ecoflora_pg';
  return `postgres://${codificar(user)}:${codificar(password)}@${host}:${port}/${database}`;
}

function mysqlUrl() {
  const directa = String(process.env.MYSQL_URL || '').trim();
  if (directa) return directa;
  const host = String(process.env.MYSQL_HOST || '').trim();
  const password = String(process.env.MYSQL_PASSWORD || process.env.MYSQL_APP_PASSWORD || '').trim();
  if (!host || !password) return '';
  const user = String(process.env.MYSQL_USER || 'ecoflora_app').trim() || 'ecoflora_app';
  const port = String(process.env.MYSQL_PORT || '3306').trim() || '3306';
  const database = String(process.env.MYSQL_DATABASE || 'ecoflora_facturas').trim() || 'ecoflora_facturas';
  return `mysql://${codificar(user)}:${codificar(password)}@${host}:${port}/${database}`;
}

function habilitada() {
  return Boolean(pgUrl() && mysqlUrl());
}

function pg() {
  if (!pgPool) {
    pgPool = new Pool({ connectionString: pgUrl(), max: 4, connectionTimeoutMillis: TIEMPO_CONEXION_MS, idleTimeoutMillis: 30000 });
    // Un servidor caído no debe tumbar la aplicación: el error de una conexión ociosa solo se anota.
    pgPool.on('error', (error) => console.error('Postgres (federada):', error.message));
  }
  return pgPool;
}

function my() {
  if (!mysqlPool) {
    mysqlPool = mysql.createPool({
      uri: mysqlUrl(),
      connectionLimit: 4,
      connectTimeout: TIEMPO_CONEXION_MS,
      dateStrings: true,
      decimalNumbers: true
    });
  }
  return mysqlPool;
}

async function cerrar() {
  const pools = [pgPool, mysqlPool].filter(Boolean);
  pgPool = null;
  mysqlPool = null;
  await Promise.all(pools.map((pool) => pool.end().catch(() => null)));
}

const texto = (valor, largo) => String(valor === undefined || valor === null ? '' : valor).slice(0, largo);
const numeroFactura = (idPedido) => `F-${String(idPedido).padStart(6, '0')}`;
// estado del pedido (tienda) -> estado de la factura
const ESTADO_FACTURA = { pendiente: 'emitida', confirmado: 'emitida', en_camino: 'emitida', entregado: 'pagada', cancelado: 'anulada' };
const estadoFactura = (estado) => ESTADO_FACTURA[estado] || 'emitida';

/* ---------- Escritura ---------- */

async function guardarCliente(usuario, cliente = pg()) {
  await cliente.query(
    `INSERT INTO cliente (id_cliente, nombre, email, telefono, direccion, ciudad)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id_cliente) DO UPDATE SET
       nombre = EXCLUDED.nombre, email = EXCLUDED.email, telefono = EXCLUDED.telefono,
       direccion = EXCLUDED.direccion, ciudad = EXCLUDED.ciudad, actualizado = now()`,
    [usuario.id_usuario, texto(usuario.nombre, 100), texto(usuario.email, 150), texto(usuario.telefono, 30), texto(usuario.direccion, 200), texto(usuario.ciudad, 100)]
  );
}

async function guardarProducto(planta, categoria, cliente = pg()) {
  await cliente.query(
    `INSERT INTO producto (id_producto, nombre, nombre_cientifico, categoria, precio, stock)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id_producto) DO UPDATE SET
       nombre = EXCLUDED.nombre, nombre_cientifico = EXCLUDED.nombre_cientifico, categoria = EXCLUDED.categoria,
       precio = EXCLUDED.precio, stock = EXCLUDED.stock, actualizado = now()`,
    [planta.id_planta, texto(planta.nombre, 150), texto(planta.nombre_cientifico, 150), texto(categoria, 100), Number(planta.precio) || 0, Math.max(0, Number(planta.stock) || 0)]
  );
}

// Una línea por planta del pedido. Es idempotente: repetirla no duplica la factura (llave única pedido+producto).
async function guardarFactura(pedido) {
  const filas = (pedido.detalle || []).map((linea) => [
    numeroFactura(pedido.id_pedido), pedido.id_pedido, pedido.id_usuario, linea.id_planta, linea.cantidad,
    linea.precio_unitario, Math.round(linea.precio_unitario * linea.cantidad * 100) / 100, estadoFactura(pedido.estado),
    new Date(pedido.fecha_pedido || Date.now())
  ]);
  for (const fila of filas) {
    await my().query(
      `INSERT INTO factura (numero, id_pedido, id_cliente, id_producto, cantidad, precio_unitario, total, estado, fecha)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE cantidad = VALUES(cantidad), precio_unitario = VALUES(precio_unitario),
         total = VALUES(total), estado = VALUES(estado)`,
      fila
    );
  }
  return filas.length;
}

/* ---------- Sincronización desde la tienda (MongoDB) ---------- */

async function nombresDeCategorias() {
  const { Categoria } = require('./models');
  const categorias = await Categoria.find({}, { id_categoria: 1, nombre: 1 }).lean();
  return new Map(categorias.map((c) => [c.id_categoria, c.nombre]));
}

// Al confirmar un pedido: el cliente y las plantas pedidas (con su stock ya descontado) van a Postgres y la factura a MySQL.
async function registrarPedido(pedido) {
  if (!habilitada()) return { ok: false, motivo: 'apagada' };
  try {
    const { Usuario, Planta } = require('./models');
    const datos = pedido.toObject ? pedido.toObject() : pedido;
    const usuario = await Usuario.findOne({ id_usuario: datos.id_usuario }).lean();
    if (usuario) await guardarCliente(usuario);
    const ids = (datos.detalle || []).map((linea) => linea.id_planta);
    const plantas = await Planta.find({ id_planta: { $in: ids } }).lean();
    const categorias = await nombresDeCategorias();
    for (const planta of plantas) await guardarProducto(planta, categorias.get(planta.id_categoria) || '');
    const lineas = await guardarFactura(datos);
    return { ok: true, lineas };
  } catch (error) {
    console.error(`Federada: no se pudo registrar el pedido #${pedido && pedido.id_pedido}:`, error.message);
    return { ok: false, motivo: error.message };
  }
}

// El admin cambia el estado de un pedido: la factura cambia con él (cancelado -> anulada, entregado -> pagada).
async function actualizarEstado(idPedido, estado) {
  if (!habilitada()) return { ok: false, motivo: 'apagada' };
  try {
    await my().query('UPDATE factura SET estado = ? WHERE id_pedido = ?', [estadoFactura(estado), idPedido]);
    return { ok: true };
  } catch (error) {
    console.error(`Federada: no se pudo actualizar la factura del pedido #${idPedido}:`, error.message);
    return { ok: false, motivo: error.message };
  }
}

// Carga completa (botón "Sincronizar ahora" y scripts/federada-sync.js). Se puede repetir sin duplicar nada.
async function sincronizarTodo() {
  const { Usuario, Planta, Pedido } = require('./models');
  const categorias = await nombresDeCategorias();
  const resultado = { clientes: 0, productos: 0, facturas: 0 };

  const cliente = await pg().connect();
  try {
    await cliente.query('BEGIN');
    for await (const usuario of Usuario.find({ rol: 'cliente' }).lean().cursor()) {
      await guardarCliente(usuario, cliente);
      resultado.clientes += 1;
    }
    for await (const planta of Planta.find().lean().cursor()) {
      await guardarProducto(planta, categorias.get(planta.id_categoria) || '', cliente);
      resultado.productos += 1;
    }
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    cliente.release();
  }

  // Los clientes de pedidos antiguos que ya no existen como cuenta no se pueden relacionar: se omiten con su aviso.
  const idsClientes = new Set((await pg().query('SELECT id_cliente FROM cliente')).rows.map((fila) => fila.id_cliente));
  resultado.omitidas = 0;
  for await (const pedido of Pedido.find().lean().cursor()) {
    if (!idsClientes.has(pedido.id_usuario)) { resultado.omitidas += 1; continue; }
    resultado.facturas += await guardarFactura(pedido);
  }
  return resultado;
}

/* ---------- Lectura (pantalla del admin) ---------- */

async function medir(fn) {
  const inicio = Date.now();
  try {
    const dato = await fn();
    return { ok: true, ms: Date.now() - inicio, ...dato };
  } catch (error) {
    return { ok: false, ms: Date.now() - inicio, error: error.message || String(error) };
  }
}

const SQL_VISTA = `SELECT f.id_factura, f.numero, f.fecha, c.nombre AS cliente, p.nombre AS producto,
       f.cantidad, f.precio_unitario, f.total
FROM factura_mysql f                          -- tabla de MySQL (servidor 2), vista desde Postgres con mysql_fdw
JOIN cliente  c ON c.id_cliente  = f.id_cliente   -- tabla de Postgres (servidor 1)
JOIN producto p ON p.id_producto = f.id_producto  -- tabla de Postgres (servidor 1)
ORDER BY f.fecha DESC, f.id_factura DESC`;

async function panorama() {
  const servidorPg = await medir(async () => {
    const r = await pg().query("SELECT version() AS version, current_database() AS base");
    return { version: r.rows[0].version.split(' on ')[0], base: r.rows[0].base };
  });
  const servidorMysql = await medir(async () => {
    const [filas] = await my().query('SELECT VERSION() AS version, DATABASE() AS base');
    return { version: `MySQL ${filas[0].version}`, base: filas[0].base };
  });
  const enlace = servidorPg.ok
    ? await medir(async () => ({ filas: Number((await pg().query('SELECT count(*) AS n FROM factura_mysql')).rows[0].n) }))
    : { ok: false, error: 'Postgres no responde' };

  const datos = { servidorPg, servidorMysql, enlace, sqlVista: SQL_VISTA, clientes: [], productos: [], facturas: [], ventas: [], totales: {} };
  if (servidorPg.ok) {
    datos.totales.clientes = Number((await pg().query('SELECT count(*) AS n FROM cliente')).rows[0].n);
    datos.totales.productos = Number((await pg().query('SELECT count(*) AS n FROM producto')).rows[0].n);
    datos.clientes = (await pg().query('SELECT id_cliente, nombre, email, ciudad FROM cliente ORDER BY actualizado DESC, id_cliente DESC LIMIT 8')).rows;
    datos.productos = (await pg().query('SELECT id_producto, nombre, categoria, precio, stock FROM producto ORDER BY actualizado DESC, id_producto DESC LIMIT 8')).rows;
  }
  if (servidorMysql.ok) {
    const [[conteo]] = await my().query('SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS suma FROM factura');
    datos.totales.facturas = Number(conteo.n);
    datos.totales.facturado = Number(conteo.suma);
    const [filas] = await my().query('SELECT id_factura, numero, id_cliente, id_producto, cantidad, total, estado, fecha FROM factura ORDER BY fecha DESC, id_factura DESC LIMIT 8');
    datos.facturas = filas;
  }
  if (servidorPg.ok && enlace.ok) {
    datos.ventas = (await pg().query(`${SQL_VISTA.replace(/\s+--[^\n]*/g, '')} LIMIT 12`)).rows;
  }
  return datos;
}

module.exports = {
  habilitada, cerrar, numeroFactura, estadoFactura,
  guardarCliente, guardarProducto, guardarFactura,
  registrarPedido, actualizarEstado, sincronizarTodo, panorama,
  pg, my
};
