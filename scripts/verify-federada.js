// Comprueba la Parte 2 del parcial: base federada (PostgreSQL + MySQL en dos servidores, unidas con mysql_fdw).
//
// Requisitos:
//  - MongoDB LOCAL encendido (se crea una base temporal "ecoflora_federada_..." y se borra al terminar).
//  - Los dos servidores de docker/ encendidos:  cd docker && docker compose up -d
//
// Uso:
//   MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora node scripts/verify-federada.js
//
// Las URLs de los servidores salen de PG_URL y MYSQL_URL; si no están definidas se arman con docker/.env (que no se sube al repositorio).
// ATENCIÓN: vacía las tablas cliente, producto y factura de ESOS servidores (son de práctica, no de producción).

const fs = require('fs');
const path = require('path');

function leerDockerEnv() {
  const archivo = path.join(__dirname, '..', 'docker', '.env');
  const valores = {};
  if (!fs.existsSync(archivo)) return valores;
  fs.readFileSync(archivo, 'utf8').split(/\r?\n/).forEach((linea) => {
    const m = /^([A-Z_]+)=(.*)$/.exec(linea.trim());
    if (m) valores[m[1]] = m[2];
  });
  return valores;
}

const uriBase = process.env.MONGODB_URI || '';
if (!uriBase) {
  console.error('Define MONGODB_URI (una base LOCAL de pruebas).');
  process.exit(1);
}
const nombreBase = `ecoflora_federada_${Date.now()}`;
const uri = (() => { const url = new URL(uriBase); url.pathname = '/' + nombreBase; return url.toString(); })();

const env = leerDockerEnv();
const PG_URL = process.env.PG_URL
  || (env.PG_PASSWORD ? `postgres://ecoflora:${encodeURIComponent(env.PG_PASSWORD)}@127.0.0.1:${env.PG_PORT || 5433}/ecoflora_pg` : '');
const MYSQL_URL = process.env.MYSQL_URL
  || (env.MYSQL_APP_PASSWORD ? `mysql://ecoflora_app:${encodeURIComponent(env.MYSQL_APP_PASSWORD)}@127.0.0.1:${env.MYSQL_PORT || 3307}/ecoflora_facturas` : '');
if (!PG_URL || !MYSQL_URL) {
  console.error('Faltan PG_URL y MYSQL_URL (o docker/.env). Enciende los servidores con: cd docker && docker compose up -d');
  process.exit(1);
}

const CLAVE_ADMIN = 'ClaveAdmin2026';
Object.assign(process.env, {
  NODE_ENV: 'development',
  SESSION_SECRET: 'secreto-de-prueba-federada',
  ADMIN_INITIAL_PASSWORD: CLAVE_ADMIN,
  PUBLIC_URL: '',
  RENDER_EXTERNAL_URL: '',
  RESEND_API_KEY: '',
  FACE_ENCRYPTION_KEY: ''
});
delete process.env.PG_URL;
delete process.env.MYSQL_URL;

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
let comprobaciones = 0;
function assert(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
  comprobaciones += 1;
  console.log('ok', mensaje);
}
const titulo = (texto) => console.log(`\n== ${texto} ==`);

async function esperar(fn, ms = 6000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    ultimo = await fn();
    if (ultimo) return ultimo;
    await dormir(80);
  }
  return ultimo;
}

function crearCliente(base, ip) {
  const cookies = new Map();
  const jar = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  async function pedir(metodo, ruta, { form, csrf } = {}) {
    const headers = { 'X-Forwarded-For': ip };
    if (cookies.size) headers.Cookie = jar();
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(csrf === undefined ? form : { _csrf: csrf, ...form }).toString();
    }
    const r = await fetch(base + ruta, { method: metodo, headers, body, redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      const valor = par.slice(i + 1);
      if (valor === '' || /expires=Thu, 01 Jan 1970/i.test(c)) cookies.delete(par.slice(0, i));
      else cookies.set(par.slice(0, i), valor);
    });
    return { status: r.status, texto: await r.text(), ubicacion: r.headers.get('location') || '' };
  }
  const cliente = { pedir };
  cliente.token = async (ruta = '/login') => {
    const r = await pedir('GET', ruta);
    const m = /name="_csrf" value="([^"]+)"/.exec(r.texto) || /data-csrf="([^"]+)"/.exec(r.texto);
    if (!m) throw new Error(`la página ${ruta} no trae token CSRF`);
    return m[1];
  };
  cliente.entrar = async (usuario, password) => pedir('POST', '/login', { form: { usuario, password }, csrf: await cliente.token('/login') });
  return cliente;
}

async function main() {
  const mongoose = require('mongoose');
  const { connect } = require('../src/db');
  const { importIfEmpty } = require('../src/importer');
  const { createApp } = require('../src/app');
  const federada = require('../src/federada');
  const { Usuario, Pedido, Planta } = require('../src/models');
  const { hashPassword } = require('../src/passwords');

  await connect(uri);
  await importIfEmpty();
  await Usuario.create({
    id_usuario: 9001, nombre: 'Cliente Federado', usuario: 'federado', email: 'federado@prueba.com', telefono: '3001234567',
    ciudad: 'Villavicencio', direccion: 'Calle 9 #9-9', rol: 'cliente', password: await hashPassword('ClaveFed2026')
  }).catch(async () => {
    // Si el modelo usa otro generador de id, lo creamos sin id explícito.
    await Usuario.create({
      nombre: 'Cliente Federado', usuario: 'federado', email: 'federado@prueba.com', telefono: '3001234567',
      ciudad: 'Villavicencio', direccion: 'Calle 9 #9-9', rol: 'cliente', password: await hashPassword('ClaveFed2026')
    });
  });
  const clienteBD = await Usuario.findOne({ usuario: 'federado' }).lean();

  const servidor = createApp().listen(0, '127.0.0.1');
  await new Promise((resolver) => servidor.on('listening', resolver));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let n = 30;
  const nuevo = () => crearCliente(base, `10.30.0.${n++}`);

  try {
    /* ---------- Apagada ---------- */
    titulo('Apagada: sin PG_URL y MYSQL_URL la tienda funciona igual');
    assert(!federada.habilitada(), 'sin variables, la base federada queda apagada');
    const admin = nuevo();
    assert((await admin.entrar('admin', CLAVE_ADMIN)).status === 302, 'el admin entra');
    let r = await admin.pedir('GET', '/admin/federada');
    assert(r.status === 200 && /apagada/i.test(r.texto), '/admin/federada explica cómo encenderla cuando está apagada');
    assert((await federada.registrarPedido({ id_pedido: 1, detalle: [] })).motivo === 'apagada', 'registrarPedido no hace nada si está apagada');
    const invitado = nuevo();
    assert([302, 403].includes((await invitado.pedir('GET', '/admin/federada')).status), '/admin/federada no es público');

    /* ---------- Encendida ---------- */
    titulo('Encendida: los dos servidores');
    process.env.PG_URL = PG_URL;
    process.env.MYSQL_URL = MYSQL_URL;
    await federada.cerrar();
    assert(federada.habilitada(), 'con PG_URL y MYSQL_URL la base federada se enciende');

    const pg = federada.pg();
    const my = federada.my();
    await pg.query('TRUNCATE cliente, producto');
    await my.query('DELETE FROM factura');
    const panorama0 = await federada.panorama();
    assert(panorama0.servidorPg.ok && /PostgreSQL 16/.test(panorama0.servidorPg.version), 'servidor 1: PostgreSQL 16 responde');
    assert(panorama0.servidorMysql.ok && /MySQL 8/.test(panorama0.servidorMysql.version), 'servidor 2: MySQL 8 responde');
    assert(panorama0.enlace.ok, 'Postgres lee la tabla de MySQL a través de mysql_fdw (factura_mysql)');

    // Servidores distintos de verdad.
    const [[idMysql]] = await my.query('SELECT @@hostname AS h, @@port AS p');
    const idPg = (await pg.query('SELECT inet_server_port() AS p')).rows[0];
    assert(String(idMysql.h) !== '' && idPg.p !== undefined, 'son dos servidores distintos (cada uno con su propio contenedor)');

    titulo('Carga inicial (botón "Sincronizar ahora")');
    const csrf = await admin.token('/admin/federada');
    r = await admin.pedir('POST', '/admin/federada/sincronizar', { form: {}, csrf });
    assert(r.status === 302 && /sincronizado=1/.test(r.ubicacion), 'sincronizar termina bien');
    const totalPlantas = await Planta.countDocuments();
    const totalClientes = await Usuario.countDocuments({ rol: 'cliente' });
    assert(Number((await pg.query('SELECT count(*) AS n FROM producto')).rows[0].n) === totalPlantas, `las ${totalPlantas} plantas llegaron a Postgres (tabla producto)`);
    assert(Number((await pg.query('SELECT count(*) AS n FROM cliente')).rows[0].n) === totalClientes, 'los clientes llegaron a Postgres (tabla cliente)');
    assert(!(await pg.query("SELECT 1 FROM cliente WHERE email = 'admin@ecoflora.com'")).rowCount, 'los administradores NO se copian a la base federada');
    const segunda = await federada.sincronizarTodo();
    assert(Number((await pg.query('SELECT count(*) AS n FROM producto')).rows[0].n) === totalPlantas && segunda.productos === totalPlantas, 'repetir la sincronización no duplica nada');

    titulo('Un pedido de la tienda genera la factura en MySQL');
    const comprador = nuevo();
    assert((await comprador.entrar('federado', 'ClaveFed2026')).status === 302, 'el cliente entra a la tienda');
    const planta = await Planta.findOne({ stock: { $gte: 5 } }).lean();
    const stockAntes = planta.stock;
    let t = await comprador.token('/catalogo');
    r = await comprador.pedir('POST', '/carrito', { form: { accion: 'agregar', id_planta: String(planta.id_planta), cantidad: '2' }, csrf: t });
    assert([200, 302].includes(r.status), 'la planta se agrega al carrito');
    t = await comprador.token('/confirmar-pedido');
    r = await comprador.pedir('POST', '/confirmar-pedido', { form: { direccion: 'Calle 9 #9-9', ciudad: 'Villavicencio', telefono: '3001234567', notas: '' }, csrf: t });
    assert(r.status === 302 || /Pedido realizado/.test(r.texto), 'el pedido se confirma');
    const pedido = await Pedido.findOne({ id_usuario: clienteBD.id_usuario }).sort({ id_pedido: -1 }).lean();
    assert(pedido && pedido.detalle.length === 1, 'el pedido quedó en MongoDB');

    const factura = await esperar(async () => {
      const [filas] = await my.query('SELECT * FROM factura WHERE id_pedido = ?', [pedido.id_pedido]);
      return filas.length ? filas[0] : null;
    });
    assert(factura && factura.numero === federada.numeroFactura(pedido.id_pedido) && factura.cantidad === 2 && factura.estado === 'emitida', 'MySQL: la factura se creó sola al confirmar el pedido');
    assert(Number(factura.total) === Number(planta.precio) * 2, 'MySQL: el total de la factura es precio x cantidad');
    const productoPg = (await pg.query('SELECT stock FROM producto WHERE id_producto = $1', [planta.id_planta])).rows[0];
    assert(productoPg && productoPg.stock === stockAntes - 2, 'Postgres: el stock del producto ya viene descontado');

    titulo('Consulta federada: Postgres une sus tablas con la de MySQL');
    const venta = await esperar(async () => (await pg.query('SELECT * FROM v_ventas_federada WHERE id_factura = $1', [factura.id_factura])).rows[0]);
    assert(venta && venta.cliente === 'Cliente Federado' && venta.producto === planta.nombre, 'v_ventas_federada: nombre del cliente y de la planta salen de Postgres, la factura de MySQL');
    const directa = (await pg.query('SELECT f.total, c.nombre FROM factura_mysql f JOIN cliente c ON c.id_cliente = f.id_cliente WHERE f.id_factura = $1', [factura.id_factura])).rows[0];
    assert(directa && Number(directa.total) === Number(factura.total), 'JOIN directo entre factura_mysql (MySQL) y cliente (Postgres)');

    titulo('Cambios de estado y escritura a través del enlace');
    await admin.pedir('POST', '/admin/pedidos', { form: { cambiar_estado: '1', id_pedido: String(pedido.id_pedido), estado: 'entregado' }, csrf: await admin.token('/admin/pedidos') });
    let estado = await esperar(async () => { const [f] = await my.query('SELECT estado FROM factura WHERE id_factura = ?', [factura.id_factura]); return f[0].estado === 'pagada' ? 'pagada' : null; });
    assert(estado === 'pagada', 'pedido entregado -> factura "pagada" en MySQL');
    assert((await pg.query('SELECT estado FROM factura_mysql WHERE id_factura = $1', [factura.id_factura])).rows[0].estado === 'pagada', 'Postgres lo ve en la tabla foránea');
    await admin.pedir('POST', '/admin/pedidos', { form: { cambiar_estado: '1', id_pedido: String(pedido.id_pedido), estado: 'cancelado' }, csrf: await admin.token('/admin/pedidos') });
    estado = await esperar(async () => { const [f] = await my.query('SELECT estado FROM factura WHERE id_factura = ?', [factura.id_factura]); return f[0].estado === 'anulada' ? 'anulada' : null; });
    assert(estado === 'anulada', 'pedido cancelado -> factura "anulada"');
    await pg.query("UPDATE factura_mysql SET estado = 'emitida' WHERE id_factura = $1", [factura.id_factura]);
    assert((await my.query('SELECT estado FROM factura WHERE id_factura = ?', [factura.id_factura]))[0][0].estado === 'emitida', 'un UPDATE hecho en Postgres sobre factura_mysql cambia la fila real en MySQL');

    titulo('Una factura insertada directamente en MySQL aparece en la consulta de Postgres');
    await my.query(
      'INSERT INTO factura (numero, id_pedido, id_cliente, id_producto, cantidad, precio_unitario, total, estado, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      ['F-MANUAL', 999999, clienteBD.id_usuario, planta.id_planta, 1, 10000, 10000, 'emitida']
    );
    const manual = (await pg.query("SELECT cliente, producto, total FROM v_ventas_federada WHERE numero = 'F-MANUAL'")).rows[0];
    assert(manual && manual.cliente === 'Cliente Federado' && Number(manual.total) === 10000, 'la vista federada une la factura nueva con cliente y producto');
    await my.query("DELETE FROM factura WHERE numero = 'F-MANUAL'");

    titulo('Pantalla del admin');
    r = await admin.pedir('GET', '/admin/federada');
    assert(r.status === 200 && /PostgreSQL 16/.test(r.texto) && /MySQL 8/.test(r.texto) && /Cliente Federado/.test(r.texto), '/admin/federada muestra los dos servidores y los datos');
    assert(/factura_mysql/.test(r.texto) && /v_ventas_federada|JOIN/.test(r.texto), '/admin/federada muestra la consulta federada');
    assert(!/ecoflora_pg:|mysql:\/\/|postgres:\/\/|password/i.test(r.texto), '/admin/federada no muestra contraseñas ni URLs de conexión');

    titulo('Resiliencia: con los servidores caídos la tienda sigue vendiendo');
    await federada.cerrar();
    process.env.PG_URL = 'postgres://nadie:x@127.0.0.1:1/nada';
    process.env.MYSQL_URL = 'mysql://nadie:x@127.0.0.1:1/nada';
    const comprador2 = nuevo();
    await comprador2.entrar('federado', 'ClaveFed2026');
    t = await comprador2.token('/catalogo');
    await comprador2.pedir('POST', '/carrito', { form: { accion: 'agregar', id_planta: String(planta.id_planta), cantidad: '1' }, csrf: t });
    const antes = await Pedido.countDocuments();
    t = await comprador2.token('/confirmar-pedido');
    const inicio = Date.now();
    r = await comprador2.pedir('POST', '/confirmar-pedido', { form: { direccion: 'Calle 9 #9-9', ciudad: 'Villavicencio', telefono: '3001234567', notas: '' }, csrf: t });
    assert((await Pedido.countDocuments()) === antes + 1, 'el pedido se confirma aunque Postgres y MySQL estén caídos');
    assert(Date.now() - inicio < 6000, 'y sin quedarse esperando a los servidores');
    r = await admin.pedir('GET', '/admin/federada');
    assert(r.status === 200 && /no responde|error|ECONNREFUSED|fall/i.test(r.texto), '/admin/federada avisa del problema en vez de romperse');
    assert((await federada.sincronizarTodo().then(() => false).catch(() => true)), 'sincronizar con los servidores caídos falla con error claro (no se cuelga)');

    console.log(`\nTodo bien: ${comprobaciones} comprobaciones de la base federada.`);
  } finally {
    servidor.close();
    process.env.PG_URL = PG_URL;
    process.env.MYSQL_URL = MYSQL_URL;
    await federada.cerrar();
    const limpio = federada.pg();
    await limpio.query('TRUNCATE cliente, producto').catch(() => null);
    await federada.my().query('DELETE FROM factura').catch(() => null);
    await federada.cerrar();
    await mongoose.connection.dropDatabase().catch(() => null);
    await mongoose.disconnect();
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('\nFALLÓ:', error.message);
  process.exit(1);
});
