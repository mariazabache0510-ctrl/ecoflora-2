// Sitios de interés (Parte 3 del parcial): se guardan en CockroachDB, una base distribuida compatible con PostgreSQL.
// Como habla el mismo protocolo que Postgres, se usa el cliente "pg". Si COCKROACH_URL no está definida,
// la función queda apagada y el resto de la tienda funciona igual.
//
// La cadena de conexión es un secreto: vive solo en tu .env y en Render (nunca en el repositorio).

const { Pool } = require('pg');

const CATEGORIAS = ['vivero', 'jardin', 'parque', 'tienda', 'otro'];
const MAX_POR_USUARIO = 200;
const TIEMPO_CONEXION_MS = 4000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let pool = null;
let tablaLista = null;

function urlConfigurada() {
  return String(process.env.COCKROACH_URL || '').trim();
}

function habilitada() {
  return Boolean(urlConfigurada());
}

// SSL es obligatorio (CockroachDB Cloud solo acepta conexiones cifradas). La única excepción es una base
// de práctica en TU computador con sslmode=disable, que sirve para las pruebas con Docker.
function opcionesDeConexion() {
  const url = new URL(urlConfigurada());
  const modo = url.searchParams.get('sslmode');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('sslrootcert');
  const ssl = modo === 'disable' && local ? false : { rejectUnauthorized: true };
  return { connectionString: url.toString(), ssl };
}

function pg() {
  if (!pool) {
    pool = new Pool({ ...opcionesDeConexion(), max: 4, connectionTimeoutMillis: TIEMPO_CONEXION_MS, idleTimeoutMillis: 30000 });
    pool.on('error', (error) => console.error('CockroachDB (sitios):', error.message));
  }
  return pool;
}

// Crea la tabla la primera vez (y si la conexión falla, se vuelve a intentar en la siguiente petición).
function asegurarTabla() {
  if (!tablaLista) {
    tablaLista = (async () => {
      await pg().query(`CREATE TABLE IF NOT EXISTS sitios_interes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        id_usuario INT NOT NULL,
        nombre VARCHAR(100) NOT NULL,
        descripcion VARCHAR(500) NOT NULL DEFAULT '',
        categoria VARCHAR(30) NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        creado TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await pg().query('CREATE INDEX IF NOT EXISTS ix_sitios_usuario ON sitios_interes (id_usuario)');
    })().catch((error) => {
      tablaLista = null;
      throw error;
    });
  }
  return tablaLista;
}

async function cerrar() {
  const actual = pool;
  pool = null;
  tablaLista = null;
  if (actual) await actual.end().catch(() => null);
}

/* ---------- Validación ---------- */

class ErrorDeSitio extends Error {}

function limpiarTexto(valor, max) {
  // Quita caracteres de control y espacios sobrantes.
  return String(valor === undefined || valor === null ? '' : valor).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function numeroEnRango(valor, min, max, nombre) {
  // Solo números (o texto numérico simple): nada de NaN, Infinity ni notación rara.
  if (typeof valor === 'string' && !/^-?\d{1,3}(\.\d{1,15})?$/.test(valor.trim())) throw new ErrorDeSitio(`${nombre} no es válida.`);
  if (typeof valor !== 'string' && typeof valor !== 'number') throw new ErrorDeSitio(`${nombre} no es válida.`);
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < min || numero > max) throw new ErrorDeSitio(`${nombre} debe estar entre ${min} y ${max}.`);
  return Math.round(numero * 1e6) / 1e6;
}

function validarSitio(cuerpo) {
  const datos = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? cuerpo : {};
  if (typeof datos.nombre !== 'string' || typeof (datos.descripcion === undefined ? '' : datos.descripcion) !== 'string') {
    throw new ErrorDeSitio('Escribe el nombre y la descripción como texto.');
  }
  const nombre = limpiarTexto(datos.nombre, 101);
  if (nombre.length < 2 || nombre.length > 100) throw new ErrorDeSitio('El nombre debe tener entre 2 y 100 caracteres.');
  const descripcion = limpiarTexto(datos.descripcion, 501);
  if (descripcion.length > 500) throw new ErrorDeSitio('La descripción puede tener hasta 500 caracteres.');
  const categoria = String(datos.categoria || '');
  if (!CATEGORIAS.includes(categoria)) throw new ErrorDeSitio('Elige una categoría de la lista.');
  const lat = numeroEnRango(datos.lat, -90, 90, 'La latitud');
  const lng = numeroEnRango(datos.lng, -180, 180, 'La longitud');
  return { nombre, descripcion, categoria, lat, lng };
}

/* ---------- Consultas ---------- */

const COLUMNAS = 'id, id_usuario, nombre, descripcion, categoria, lat, lng, creado';

async function listar({ idUsuario, todos = false }) {
  await asegurarTabla();
  const r = todos
    ? await pg().query(`SELECT ${COLUMNAS} FROM sitios_interes ORDER BY creado DESC LIMIT 500`)
    : await pg().query(`SELECT ${COLUMNAS} FROM sitios_interes WHERE id_usuario = $1 ORDER BY creado DESC LIMIT 500`, [idUsuario]);
  return r.rows;
}

async function crear(idUsuario, datos) {
  await asegurarTabla();
  const actuales = Number((await pg().query('SELECT count(*) AS n FROM sitios_interes WHERE id_usuario = $1', [idUsuario])).rows[0].n);
  if (actuales >= MAX_POR_USUARIO) throw new ErrorDeSitio(`Llegaste al máximo de ${MAX_POR_USUARIO} sitios. Borra alguno para agregar otro.`);
  const r = await pg().query(
    `INSERT INTO sitios_interes (id_usuario, nombre, descripcion, categoria, lat, lng) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNAS}`,
    [idUsuario, datos.nombre, datos.descripcion, datos.categoria, datos.lat, datos.lng]
  );
  return r.rows[0];
}

// Cada persona borra solo lo suyo; el admin puede borrar cualquiera. Devuelve true si se borró algo.
async function borrar(id, { idUsuario, esAdmin }) {
  if (!UUID.test(String(id))) return false;
  await asegurarTabla();
  const r = esAdmin
    ? await pg().query('DELETE FROM sitios_interes WHERE id = $1', [id])
    : await pg().query('DELETE FROM sitios_interes WHERE id = $1 AND id_usuario = $2', [id, idUsuario]);
  return r.rowCount > 0;
}

module.exports = {
  CATEGORIAS, MAX_POR_USUARIO, ErrorDeSitio, habilitada, cerrar, validarSitio, listar, crear, borrar, pg, opcionesDeConexion
};
