// Comprueba la Parte 3 del parcial: página de sitios de interés + API guardada en CockroachDB.
//
// CockroachDB Cloud no se puede usar en las pruebas automáticas (necesita tu cuenta), pero habla el mismo protocolo
// que PostgreSQL: aquí se usa el PostgreSQL del contenedor de docker/ como sustituto (crea una base temporal y la borra).
//
// Requisitos: MongoDB LOCAL encendido y el contenedor de Postgres de docker/ (cd docker && docker compose up -d).
// Uso:
//   MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora node scripts/verify-sitios.js
// Si prefieres otro Postgres de práctica: define SITIOS_PRUEBA_URL (usuario con permiso para crear bases).

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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
const sufijo = Date.now();
const uri = (() => { const url = new URL(uriBase); url.pathname = `/ecoflora_sitios_${sufijo}`; return url.toString(); })();

const env = leerDockerEnv();
const URL_ADMIN_PG = process.env.SITIOS_PRUEBA_URL
  || (env.PG_PASSWORD ? `postgres://ecoflora:${encodeURIComponent(env.PG_PASSWORD)}@127.0.0.1:${env.PG_PORT || 5433}/postgres` : '');
if (!URL_ADMIN_PG) {
  console.error('Falta un Postgres de práctica: enciende docker/ (docker compose up -d) o define SITIOS_PRUEBA_URL.');
  process.exit(1);
}
const BASE_PRUEBA = `sitios_prueba_${sufijo}`;
const urlPrueba = (() => { const url = new URL(URL_ADMIN_PG); url.pathname = `/${BASE_PRUEBA}`; url.searchParams.set('sslmode', 'disable'); return url.toString(); })();

const CLAVE_ADMIN = 'ClaveAdmin2026';
const LLAVE_MAPS = 'llave-de-prueba-del-mapa-000000';
Object.assign(process.env, {
  NODE_ENV: 'development',
  SESSION_SECRET: 'secreto-de-prueba-sitios',
  ADMIN_INITIAL_PASSWORD: CLAVE_ADMIN,
  PUBLIC_URL: '',
  RENDER_EXTERNAL_URL: '',
  RESEND_API_KEY: '',
  FACE_ENCRYPTION_KEY: '',
  GOOGLE_MAPS_API_KEY: LLAVE_MAPS
});
delete process.env.COCKROACH_URL;

let comprobaciones = 0;
function assert(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
  comprobaciones += 1;
  console.log('ok', mensaje);
}
const titulo = (texto) => console.log(`\n== ${texto} ==`);

function crearCliente(base, ip) {
  const cookies = new Map();
  const jar = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  async function pedir(metodo, ruta, { form, json, crudo, csrf } = {}) {
    const headers = { 'X-Forwarded-For': ip, Accept: 'application/json' };
    if (cookies.size) headers.Cookie = jar();
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(csrf === undefined ? form : { _csrf: csrf, ...form }).toString();
    } else if (json !== undefined || crudo !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = crudo !== undefined ? crudo : JSON.stringify(json);
    }
    if (csrf && !form) headers['X-CSRF-Token'] = csrf;
    const r = await fetch(base + ruta, { method: metodo, headers, body, redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      const valor = par.slice(i + 1);
      if (valor === '' || /expires=Thu, 01 Jan 1970/i.test(c)) cookies.delete(par.slice(0, i));
      else cookies.set(par.slice(0, i), valor);
    });
    const texto = await r.text();
    let datos = null;
    try { datos = JSON.parse(texto); } catch (error) { /* no era JSON */ }
    return { status: r.status, texto, datos, cabeceras: r.headers, ubicacion: r.headers.get('location') || '' };
  }
  const cliente = { pedir };
  cliente.token = async () => {
    const r = await pedir('GET', '/login');
    const m = /name="_csrf" value="([^"]+)"/.exec(r.texto);
    if (!m) throw new Error('la página no trae token CSRF');
    return m[1];
  };
  cliente.entrar = async (usuario, password) => pedir('POST', '/login', { form: { usuario, password }, csrf: await cliente.token() });
  return cliente;
}

async function main() {
  const admin = new Client({ connectionString: URL_ADMIN_PG });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${BASE_PRUEBA}`);

  const mongoose = require('mongoose');
  const { connect } = require('../src/db');
  const { importIfEmpty } = require('../src/importer');
  const { createApp } = require('../src/app');
  const sitios = require('../src/sitios');
  const { Usuario } = require('../src/models');
  const { hashPassword } = require('../src/passwords');

  await connect(uri);
  await importIfEmpty();
  for (const [id, usuario, nombre] of [[9101, 'ana_sitios', 'Ana Sitios'], [9102, 'beto_sitios', 'Beto Sitios'], [9103, 'carla_sitios', 'Carla Sitios']]) {
    await Usuario.create({ id_usuario: id, nombre, usuario, email: `${usuario}@prueba.com`, rol: 'cliente', password: await hashPassword('ClaveSitios2026') });
  }

  const servidor = createApp().listen(0, '127.0.0.1');
  await new Promise((resolver) => servidor.on('listening', resolver));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let n = 50;
  const nuevo = () => crearCliente(base, `10.40.0.${n++}`);
  const valido = { nombre: 'Vivero La Palma', descripcion: 'Buenas orquídeas', categoria: 'vivero', lat: 4.142, lng: -73.6266 };

  try {
    titulo('Apagada: sin COCKROACH_URL');
    assert(!sitios.habilitada(), 'sin COCKROACH_URL la función queda apagada');
    const ana0 = nuevo();
    assert((await ana0.entrar('ana_sitios', 'ClaveSitios2026')).status === 302, 'una clienta entra');
    let r = await ana0.pedir('GET', '/sitios');
    assert(r.status === 200 && /todavía no están disponibles/.test(r.texto), '/sitios avisa que falta la base, sin romperse');
    r = await ana0.pedir('GET', '/api/sitios');
    assert(r.status === 503 && r.datos.codigo === 'no_disponible', 'la API responde 503 limpio');

    titulo('Acceso: solo con sesión');
    process.env.COCKROACH_URL = urlPrueba;
    await sitios.cerrar();
    const invitado = nuevo();
    r = await invitado.pedir('GET', '/sitios');
    assert(r.status === 302 && r.ubicacion === '/login', '/sitios sin sesión manda a ingresar');
    r = await invitado.pedir('GET', '/api/sitios');
    assert(r.status === 401, 'GET /api/sitios sin sesión: 401');
    r = await invitado.pedir('POST', '/api/sitios', { json: valido });
    assert(r.status === 401 || r.status === 403, 'POST /api/sitios sin sesión se rechaza');
    r = await invitado.pedir('DELETE', '/api/sitios/00000000-0000-4000-8000-000000000000');
    assert(r.status === 401 || r.status === 403, 'DELETE sin sesión se rechaza');

    titulo('Encendida (PostgreSQL de práctica en lugar de CockroachDB)');
    const ana = nuevo();
    await ana.entrar('ana_sitios', 'ClaveSitios2026');
    const csrfAna = await ana.token();
    r = await ana.pedir('GET', '/sitios');
    assert(r.status === 200 && /data-sitios/.test(r.texto) && /Nuevo sitio/.test(r.texto), '/sitios muestra el mapa y el formulario');
    assert(r.texto.includes(`data-maps-key="${LLAVE_MAPS}"`), 'la llave de Google Maps llega a la vista desde la variable de entorno');
    assert(/src="\/js\/sitios\.js" nonce="/.test(r.texto), 'el script de la página lleva nonce (CSP)');
    assert(/maps\.googleapis\.com/.test(r.cabeceras.get('content-security-policy')), 'la CSP permite cargar Google Maps');
    assert(/Mis sitios/.test(r.texto) && !/Todos los sitios/.test(r.texto), 'la clienta ve "Mis sitios"');

    r = await ana.pedir('GET', '/api/sitios');
    assert(r.status === 200 && r.datos.ok && r.datos.sitios.length === 0, 'la lista empieza vacía');
    const columnas = (await sitios.pg().query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sitios_interes'")).rows;
    const tipos = Object.fromEntries(columnas.map((c) => [c.column_name, c.data_type]));
    assert(tipos.id === 'uuid' && tipos.id_usuario === 'integer' && tipos.lat === 'double precision' && tipos.lng === 'double precision' && tipos.creado.startsWith('timestamp') && tipos.nombre && tipos.descripcion && tipos.categoria, 'la tabla sitios_interes se creó sola con las columnas del plan');

    titulo('Crear');
    r = await ana.pedir('POST', '/api/sitios', { json: valido });
    assert(r.status === 403 && r.datos.codigo === 'csrf', 'crear sin token CSRF se rechaza');
    r = await ana.pedir('POST', '/api/sitios', { json: valido, csrf: csrfAna });
    assert(r.status === 201 && r.datos.ok && /^[0-9a-f-]{36}$/.test(r.datos.sitio.id) && r.datos.sitio.propio === true, 'crear un sitio válido: 201 con id UUID');
    const idAna = r.datos.sitio.id;
    assert(r.datos.sitio.lat === 4.142 && r.datos.sitio.lng === -73.6266, 'las coordenadas se guardan tal cual');
    r = await ana.pedir('GET', '/api/sitios');
    assert(r.datos.sitios.length === 1 && r.datos.sitios[0].nombre === 'Vivero La Palma', 'leer: aparece en "mis sitios"');
    assert(!('id_usuario' in r.datos.sitios[0]), 'la API no expone id_usuario');

    titulo('Validaciones');
    const rechazos = [
      ['latitud 91', { ...valido, lat: 91 }],
      ['latitud -91', { ...valido, lat: -91 }],
      ['longitud 181', { ...valido, lng: 181 }],
      ['latitud texto', { ...valido, lat: 'abc' }],
      ['latitud NaN como texto', { ...valido, lat: 'NaN' }],
      ['latitud 1e3', { ...valido, lat: '1e3' }],
      ['latitud nula', { ...valido, lat: null }],
      ['latitud ausente', { ...valido, lat: undefined }],
      ['latitud objeto', { ...valido, lat: { a: 1 } }],
      ['longitud booleana', { ...valido, lng: true }],
      ['categoría inventada', { ...valido, categoria: 'hacker' }],
      ['sin categoría', { ...valido, categoria: undefined }],
      ['nombre vacío', { ...valido, nombre: '   ' }],
      ['nombre de 1 letra', { ...valido, nombre: 'a' }],
      ['nombre de 101 letras', { ...valido, nombre: 'a'.repeat(101) }],
      ['nombre que no es texto', { ...valido, nombre: { $gt: '' } }],
      ['descripción de 501', { ...valido, descripcion: 'd'.repeat(501) }],
      ['descripción que no es texto', { ...valido, descripcion: ['x'] }]
    ];
    for (const [nombre, cuerpo] of rechazos) {
      r = await ana.pedir('POST', '/api/sitios', { json: cuerpo, csrf: csrfAna });
      assert(r.status === 400 && r.datos && r.datos.ok === false, `se rechaza: ${nombre}`);
    }
    r = await ana.pedir('POST', '/api/sitios', { crudo: '{esto no es json', csrf: csrfAna });
    assert(r.status === 400, 'un JSON roto se rechaza con 400');
    r = await ana.pedir('POST', '/api/sitios', { crudo: JSON.stringify({ ...valido, descripcion: 'x'.repeat(6000) }), csrf: csrfAna });
    assert(r.status >= 400 && r.status < 500, 'un cuerpo gigante se rechaza');
    r = await ana.pedir('POST', '/api/sitios', { json: [1, 2, 3], csrf: csrfAna });
    assert(r.status === 400, 'un arreglo en lugar de objeto se rechaza');
    r = await ana.pedir('POST', '/api/sitios', { json: { ...valido, lat: '-90', lng: '180', nombre: '  Polo\u0000   Norte  ', descripcion: '' }, csrf: csrfAna });
    assert(r.status === 201 && r.datos.sitio.nombre === 'Polo Norte' && r.datos.sitio.lat === -90 && r.datos.sitio.lng === 180, 'los extremos exactos son válidos y se limpian caracteres de control/espacios');
    const idPolo = r.datos.sitio.id;
    r = await ana.pedir('POST', '/api/sitios', { json: { ...valido, nombre: "Robert'); DROP TABLE sitios_interes;--", lat: 0, lng: 0 }, csrf: csrfAna });
    assert(r.status === 201, 'un intento de inyección SQL se guarda como texto inofensivo');
    const idSql = r.datos.sitio.id;
    assert((await sitios.pg().query('SELECT count(*) AS n FROM sitios_interes')).rows[0].n >= 3, 'la tabla sigue existiendo y con datos');
    r = await ana.pedir('POST', '/api/sitios', { json: { ...valido, nombre: '<img src=x onerror=alert(1)>', lat: 1, lng: 1 }, csrf: csrfAna });
    assert(r.status === 201, 'un nombre con HTML se guarda como texto');
    const idXss = r.datos.sitio.id;
    r = await ana.pedir('GET', '/sitios');
    assert(!r.texto.includes('onerror=alert') && !r.texto.includes('DROP TABLE'), 'la página no incluye los sitios en su HTML (se piden por la API y se pintan con textContent)');
    assert(/textContent/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'sitios.js'), 'utf8')) && !/innerHTML\s*=\s*(?!['"])\S/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'sitios.js'), 'utf8')), 'sitios.js pinta con textContent (sin innerHTML con datos)');

    titulo('Cada usuario ve solo lo suyo; el admin ve todo');
    const beto = nuevo();
    await beto.entrar('beto_sitios', 'ClaveSitios2026');
    const csrfBeto = await beto.token();
    r = await beto.pedir('GET', '/api/sitios');
    assert(r.datos.sitios.length === 0, 'Beto no ve los sitios de Ana');
    r = await beto.pedir('POST', '/api/sitios', { json: { ...valido, nombre: 'Parque de Beto', categoria: 'parque' }, csrf: csrfBeto });
    assert(r.status === 201, 'Beto guarda su sitio');
    const idBeto = r.datos.sitio.id;
    r = await beto.pedir('DELETE', `/api/sitios/${idAna}`, { csrf: csrfBeto });
    assert(r.status === 404, 'Beto NO puede borrar el sitio de Ana');
    assert((await sitios.pg().query('SELECT 1 FROM sitios_interes WHERE id = $1', [idAna])).rowCount === 1, 'el sitio de Ana sigue ahí');
    r = await beto.pedir('POST', '/api/sitios', { json: { ...valido, id_usuario: 9101, id: idAna, nombre: 'Intento de suplantar' }, csrf: csrfBeto });
    assert(r.status === 201 && r.datos.sitio.propio, 'si Beto manda id_usuario en el cuerpo, se ignora (queda como suyo)');
    const idSuplantar = r.datos.sitio.id;
    assert((await sitios.pg().query('SELECT id_usuario FROM sitios_interes WHERE id = $1', [idSuplantar])).rows[0].id_usuario === 9102, 'en la base quedó a nombre de Beto (9102)');

    const jefe = nuevo();
    await jefe.entrar('admin', CLAVE_ADMIN);
    const csrfJefe = await jefe.token();
    r = await jefe.pedir('GET', '/sitios');
    assert(r.status === 200 && /Todos los sitios/.test(r.texto), 'el admin ve "Todos los sitios"');
    r = await jefe.pedir('GET', '/api/sitios');
    assert(r.datos.esAdmin && r.datos.sitios.length >= 6, 'el admin ve los sitios de todos');
    const deAna = r.datos.sitios.find((s) => s.id === idAna);
    assert(deAna && deAna.autor === 'Ana Sitios' && deAna.propio === false, 'el admin ve de quién es cada sitio');
    r = await ana.pedir('GET', '/api/sitios');
    assert(r.datos.sitios.every((s) => s.autor === undefined), 'un cliente nunca ve el autor de los sitios');

    titulo('Borrar');
    r = await ana.pedir('DELETE', `/api/sitios/${idXss}`);
    assert(r.status === 403, 'borrar sin token CSRF se rechaza');
    for (const mala of ['abc', '1', "' OR '1'='1", '00000000-0000-4000-8000-000000000000', '%00']) {
      r = await ana.pedir('DELETE', `/api/sitios/${encodeURIComponent(mala)}`, { csrf: csrfAna });
      assert(r.status === 404, `un id inválido o inexistente da 404 (${mala})`);
    }
    r = await ana.pedir('DELETE', `/api/sitios/${idXss}`, { csrf: csrfAna });
    assert(r.status === 200 && r.datos.ok, 'Ana borra su sitio');
    r = await jefe.pedir('DELETE', `/api/sitios/${idBeto}`, { csrf: csrfJefe });
    assert(r.status === 200, 'el admin puede borrar el sitio de otra persona');
    r = await beto.pedir('GET', '/api/sitios');
    assert(!r.datos.sitios.some((s) => s.id === idBeto), 'ese sitio ya no aparece');
    await ana.pedir('DELETE', `/api/sitios/${idPolo}`, { csrf: csrfAna });
    await ana.pedir('DELETE', `/api/sitios/${idSql}`, { csrf: csrfAna });

    titulo('Límites');
    const carla = nuevo();
    await carla.entrar('carla_sitios', 'ClaveSitios2026');
    const csrfCarla = await carla.token();
    await sitios.pg().query(`INSERT INTO sitios_interes (id_usuario, nombre, categoria, lat, lng)
      SELECT 9103, 'relleno ' || g, 'otro', 1, 1 FROM generate_series(1, ${sitios.MAX_POR_USUARIO}) g`);
    r = await carla.pedir('POST', '/api/sitios', { json: valido, csrf: csrfCarla });
    assert(r.status === 400 && /máximo/.test(r.datos.error), `con ${sitios.MAX_POR_USUARIO} sitios ya no deja guardar más`);
    await sitios.pg().query('DELETE FROM sitios_interes WHERE id_usuario = 9103');
    let ultimo = 0;
    for (let i = 0; i < 35 && ultimo !== 429; i += 1) {
      r = await carla.pedir('POST', '/api/sitios', { json: { ...valido, nombre: `Sitio ${i}` }, csrf: csrfCarla });
      ultimo = r.status;
    }
    assert(ultimo === 429, 'guardar sitios sin parar activa el límite de velocidad (429)');

    titulo('Conexión: SSL obligatorio y caídas');
    process.env.COCKROACH_URL = 'postgresql://usuario:clave@mi-cluster.cockroachlabs.cloud:26257/defaultdb';
    assert(sitios.opcionesDeConexion().ssl && sitios.opcionesDeConexion().ssl.rejectUnauthorized === true, 'una URL de la nube usa SSL verificado');
    process.env.COCKROACH_URL = 'postgresql://usuario:clave@mi-cluster.cockroachlabs.cloud:26257/defaultdb?sslmode=disable';
    assert(sitios.opcionesDeConexion().ssl && sitios.opcionesDeConexion().ssl.rejectUnauthorized === true, 'sslmode=disable se ignora si el servidor NO es local');
    process.env.COCKROACH_URL = urlPrueba;
    assert(sitios.opcionesDeConexion().ssl === false, 'solo en tu computador (localhost) se permite sin SSL, para las pruebas');

    await sitios.cerrar();
    process.env.COCKROACH_URL = 'postgresql://secreto:supersecreta@127.0.0.1:1/nada?sslmode=disable';
    r = await ana.pedir('GET', '/api/sitios');
    assert(r.status === 503 && r.datos.codigo === 'base_caida', 'con la base caída la API responde 503');
    assert(!/supersecreta|secreto|127\.0\.0\.1|ECONN/.test(r.texto), 'el error no revela usuario, clave ni dirección de la base');
    r = await ana.pedir('GET', '/catalogo');
    assert(r.status === 200, 'el resto de la tienda sigue funcionando');

    process.env.COCKROACH_URL = urlPrueba;
    await sitios.cerrar();
    r = await ana.pedir('GET', '/api/sitios');
    assert(r.status === 200 && r.datos.ok, 'al volver la base, la API se recupera sola');

    titulo('Llave de Maps');
    process.env.GOOGLE_MAPS_API_KEY = 'llave" onload="alert(1)';
    r = await ana.pedir('GET', '/sitios');
    assert(r.status === 200 && !r.texto.includes('onload="alert') && /data-maps-key=""/.test(r.texto), 'una llave con caracteres raros no se inyecta en la página');
    delete process.env.GOOGLE_MAPS_API_KEY;
    r = await ana.pedir('GET', '/sitios');
    assert(r.status === 200 && /todavía no está configurado/.test(r.texto), 'sin llave el mapa avisa y el formulario sigue usable con coordenadas');
    r = await ana.pedir('GET', '/usuario/perfil');
    assert(/href="\/sitios"/.test(r.texto), 'el menú tiene el enlace "Sitios de interés"');

    console.log(`\nTodo bien: ${comprobaciones} comprobaciones de los sitios de interés.`);
  } finally {
    servidor.close();
    await sitios.cerrar();
    await mongoose.connection.dropDatabase().catch(() => null);
    await mongoose.disconnect();
    await admin.query(`DROP DATABASE IF EXISTS ${BASE_PRUEBA} WITH (FORCE)`).catch((e) => console.error('No se pudo borrar la base de práctica:', e.message));
    await admin.end();
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('\nFALLÓ:', error.message);
  process.exit(1);
});
