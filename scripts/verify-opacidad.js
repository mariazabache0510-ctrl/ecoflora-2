// Comprueba que el HTML que ve el navegador (y quien pulsa "Ver código fuente") NO lleva secretos del servidor:
// URLs de bases, claves, stacks, IDs de Google fuera de login/registro, ni la llave de Maps en /sitios.
//
// Uso:
//   MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora node scripts/verify-opacidad.js

const uriBase = process.env.MONGODB_URI || '';
if (!uriBase) {
  console.error('Define MONGODB_URI (una base LOCAL de pruebas).');
  process.exit(1);
}
const sufijo = Date.now();
const uri = (() => { const url = new URL(uriBase); url.pathname = `/ecoflora_opacidad_${sufijo}`; return url.toString(); })();

const CLAVE_ADMIN = 'ClaveAdmin2026';
const CLIENT_ID = 'ecoflora-opacidad.apps.googleusercontent.com';
const LLAVE_MAPS = 'AIzaSyOpacidadPrueba000000000000000001';
const SECRETO_FACE = 'clave-face-opacidad-0123456789abcdef';
const MONGO_SECRETA = 'mongodb+srv://usuario:ClaveSuperSecreta99@cluster.mongodb.net/ecoflora';
const COCKROACH_SECRETA = 'postgresql://neo:ClaveNeonSecreta88@ep-demo.aws.neon.tech/neondb?sslmode=require';

Object.assign(process.env, {
  NODE_ENV: 'development',
  SESSION_SECRET: 'secreto-de-prueba-opacidad-largo-seguro',
  ADMIN_INITIAL_PASSWORD: CLAVE_ADMIN,
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_MAPS_API_KEY: LLAVE_MAPS,
  FACE_ENCRYPTION_KEY: SECRETO_FACE,
  COCKROACH_URL: COCKROACH_SECRETA,
  MONGODB_URI: uri,
  PUBLIC_URL: 'https://ejemplo.test',
  RESEND_API_KEY: '',
  RENDER_EXTERNAL_URL: ''
});

let n = 0;
function assert(ok, msg) {
  if (!ok) throw new Error(msg);
  n += 1;
  console.log('ok', msg);
}

function crearCliente(base, ip) {
  const cookies = new Map();
  async function pedir(metodo, ruta, { form, csrf } = {}) {
    const headers = { 'X-Forwarded-For': ip, Accept: 'text/html' };
    if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
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
      if (!valor || /expires=Thu, 01 Jan 1970/i.test(c)) cookies.delete(par.slice(0, i));
      else cookies.set(par.slice(0, i), valor);
    });
    return { status: r.status, texto: await r.text(), cabeceras: r.headers, ubicacion: r.headers.get('location') || '' };
  }
  const c = { pedir };
  c.token = async () => {
    const r = await pedir('GET', '/login');
    return (/name="_csrf" value="([^"]+)"/.exec(r.texto) || [])[1];
  };
  c.entrar = async (u, p) => pedir('POST', '/login', { form: { usuario: u, password: p }, csrf: await c.token() });
  return c;
}

const SECRETOS = [
  SECRETO_FACE, 'ClaveSuperSecreta99', 'ClaveNeonSecreta88', MONGO_SECRETA, COCKROACH_SECRETA,
  'FACE_ENCRYPTION_KEY', 'SESSION_SECRET', 'MONGODB_URI=', 'COCKROACH_URL=',
  'at Object.', 'node_modules/', 'Error: ENOENT'
];

function sinSecretos(texto, donde) {
  for (const s of SECRETOS) {
    assert(!texto.includes(s), `${donde}: no aparece el secreto/detalle "${s.slice(0, 24)}…"`);
  }
  assert(!/postgresql:\/\/[^\s"']+:[^\s"']+@/i.test(texto), `${donde}: no hay URL de Postgres con usuario:clave`);
  assert(!/mongodb(\+srv)?:\/\/[^\s"']+:[^\s"']+@/i.test(texto), `${donde}: no hay URL de Mongo con usuario:clave`);
}

async function main() {
  // Evitar que sitios intente conectar de verdad a Neon: usamos una URL local inventada y apagamos al probar HTML.
  process.env.COCKROACH_URL = '';

  const mongoose = require('mongoose');
  const { connect } = require('../src/db');
  const { importIfEmpty } = require('../src/importer');
  const { createApp } = require('../src/app');

  await connect(uri);
  await importIfEmpty();

  // Reactivar "sitios disponible" sin base real: el HTML solo mira habilitada(); para eso hace falta URL.
  // Usamos una URL que no se imprime (solo el booleano disponible).
  process.env.COCKROACH_URL = COCKROACH_SECRETA;
  // sitios.habilitada() lee env en cada llamada; la conexión real fallará en API, no en el HTML.

  const servidor = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => servidor.on('listening', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const cliente = crearCliente(base, '10.55.0.1');
  const admin = crearCliente(base, '10.55.0.2');

  try {
    console.log('\n== Páginas públicas (como Ver código fuente) ==');
    for (const ruta of ['/', '/catalogo', '/contacto', '/nosotros', '/login', '/registro', '/recuperar', '/privacidad']) {
      const r = await cliente.pedir('GET', ruta);
      assert(r.status === 200, `${ruta} responde 200`);
      sinSecretos(r.texto, ruta);
      assert(!r.texto.includes(LLAVE_MAPS), `${ruta}: no está la llave de Maps`);
      if (ruta === '/login' || ruta === '/registro') {
        assert(r.texto.includes(CLIENT_ID), `${ruta}: sí incluye el Client ID de Google (necesario para el botón)`);
      } else {
        assert(!r.texto.includes(CLIENT_ID), `${ruta}: NO incluye el Client ID de Google`);
      }
      assert(!r.cabeceras.get('x-powered-by'), `${ruta}: sin X-Powered-By`);
    }

    console.log('\n== Login y sitios ==');
    assert((await admin.entrar('admin', CLAVE_ADMIN)).status === 302, 'admin entra');
    let r = await admin.pedir('GET', '/sitios');
    // Sin base real, habilitada() es true si hay URL; puede mostrar formulario o 503 en API.
    assert(r.status === 200, '/sitios responde 200 con sesión');
    sinSecretos(r.texto, '/sitios');
    assert(!r.texto.includes(LLAVE_MAPS), '/sitios HTML: la llave de Maps NO está en el código fuente');
    assert(!r.texto.includes(CLIENT_ID), '/sitios HTML: no está el Client ID de Google');
    assert(!/data-maps-key=/.test(r.texto), '/sitios HTML: no hay atributo data-maps-key');

    r = await admin.pedir('GET', '/admin');
    sinSecretos(r.texto, '/admin');
    r = await admin.pedir('GET', '/admin/federada');
    sinSecretos(r.texto, '/admin/federada');

    console.log('\n== Errores ==');
    r = await cliente.pedir('GET', '/ruta-que-no-existe-' + sufijo);
    assert(r.status === 404, '404 genérico');
    sinSecretos(r.texto, '404');

    console.log('\n== Encabezados (modo producción) ==');
    process.env.NODE_ENV = 'production';
    const prod = createApp().listen(0, '127.0.0.1');
    await new Promise((r) => prod.on('listening', r));
    const baseProd = `http://127.0.0.1:${prod.address().port}`;
    const rp = await fetch(baseProd + '/', { redirect: 'manual' });
    const hp = rp.headers;
    assert(/same-origin/.test(hp.get('cross-origin-resource-policy') || ''), 'Cross-Origin-Resource-Policy: same-origin');
    assert(/same-origin-allow-popups/.test(hp.get('cross-origin-opener-policy') || ''), 'Cross-Origin-Opener-Policy permite el popup de Google');
    assert(hp.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
    assert(!hp.get('x-powered-by'), 'producción: sin X-Powered-By');
    assert(/no-store/.test(hp.get('cache-control') || ''), 'en producción las páginas HTML van con Cache-Control: no-store');
    assert(/max-age=15552000/.test(hp.get('strict-transport-security') || ''), 'en producción se envía HSTS');
    const htmlProd = await rp.text();
    sinSecretos(htmlProd, 'producción /');
    prod.close();
    process.env.NODE_ENV = 'development';

    console.log(`\nTodo bien: ${n} comprobaciones de opacidad del HTML.`);
  } finally {
    servidor.close();
    await mongoose.connection.dropDatabase().catch(() => null);
    await mongoose.disconnect();
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('\nFALLÓ:', e.message);
  process.exit(1);
});
