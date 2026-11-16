// Comprueba la Parte 1 del parcial (usuarios en MongoDB): CRUD de usuarios desde el admin, entrar con Google
// y recuperar la contraseña por correo.
//
// Uso (con MongoDB LOCAL encendido; crea una base temporal "ecoflora_cuentas_..." y la borra al terminar):
//   MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora node scripts/verify-cuentas.js
//
// La app corre dentro de este mismo proceso para poder:
//  - fabricar tokens de Google firmados con una llave de prueba y entregárselos a la librería oficial
//    (google-auth-library), que SÍ comprueba firma, audiencia, emisor y vencimiento; solo se reemplaza
//    la descarga de los certificados de Google por la llave de prueba;
//  - recibir los correos en un "Resend" falso (la app respeta RESEND_API_URL) y leer el enlace de recuperación.

const crypto = require('crypto');
const http = require('http');

const uriBase = process.env.MONGODB_URI || '';
if (!uriBase) {
  console.error('Define MONGODB_URI (una base LOCAL de pruebas).');
  process.exit(1);
}
const nombreBase = `ecoflora_cuentas_${Date.now()}`;
const uri = (() => { const url = new URL(uriBase); url.pathname = '/' + nombreBase; return url.toString(); })();

const CLIENT_ID = 'ecoflora-prueba.apps.googleusercontent.com';
const CLAVE_ADMIN = 'ClaveAdmin2026';
Object.assign(process.env, {
  NODE_ENV: 'development',
  SESSION_SECRET: 'secreto-de-prueba-cuentas',
  ADMIN_INITIAL_PASSWORD: CLAVE_ADMIN,
  GOOGLE_CLIENT_ID: CLIENT_ID,
  RESEND_API_KEY: 'clave-falsa',
  PUBLIC_URL: '',
  RENDER_EXTERNAL_URL: '',
  FACE_ENCRYPTION_KEY: ''
});

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
let comprobaciones = 0;
function assert(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
  comprobaciones += 1;
  console.log('ok', mensaje);
}
const titulo = (texto) => console.log(`\n== ${texto} ==`);

// ---------- Resend falso ----------
const correos = [];
function levantarResendFalso() {
  return new Promise((resolver) => {
    const servidor = http.createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (d) => { cuerpo += d; });
      req.on('end', () => {
        try { correos.push(JSON.parse(cuerpo)); } catch (error) { /* ignorar */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"id":"falso"}');
      });
    });
    servidor.listen(0, '127.0.0.1', () => resolver(servidor));
  });
}
async function esperarCorreos(cantidad, ms = 4000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite && correos.length < cantidad) await dormir(50);
  return correos.length >= cantidad;
}

// ---------- Cliente HTTP con cookies y CSRF ----------
function crearCliente(base, ip) {
  const cookies = new Map();
  const jar = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  async function pedir(metodo, ruta, { form, json, csrf, cabeceras = {} } = {}) {
    const headers = { ...cabeceras, 'X-Forwarded-For': ip };
    if (cookies.size) headers.Cookie = jar();
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(csrf === undefined ? form : { _csrf: csrf, ...form }).toString();
    } else if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers.Accept = 'application/json';
      if (csrf) headers['X-CSRF-Token'] = csrf;
      body = JSON.stringify(json);
    }
    const r = await fetch(base + ruta, { method: metodo, headers, body, redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      const nombre = par.slice(0, i);
      const valor = par.slice(i + 1);
      if (c.match(/expires=Thu, 01 Jan 1970/i) || valor === '') cookies.delete(nombre);
      else cookies.set(nombre, valor);
    });
    const texto = await r.text();
    return { status: r.status, texto, cabeceras: r.headers, ubicacion: r.headers.get('location') || '' };
  }
  const cliente = { pedir };
  // Token CSRF de la sesión actual (lo imprime cualquier página con formulario).
  cliente.token = async (ruta = '/login') => {
    const r = await pedir('GET', ruta);
    const m = /name="_csrf" value="([^"]+)"/.exec(r.texto) || /data-csrf="([^"]+)"/.exec(r.texto);
    if (!m) throw new Error(`la página ${ruta} no trae token CSRF`);
    return m[1];
  };
  cliente.entrar = async (usuario, password) => {
    const csrf = await cliente.token('/login');
    return pedir('POST', '/login', { form: { usuario, password }, csrf });
  };
  return cliente;
}

// ---------- Tokens de Google de prueba ----------
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otraLlave = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (objeto) => Buffer.from(JSON.stringify(objeto)).toString('base64url');
function fabricarToken(extra = {}, { llave = privateKey, kid = 'llave-de-prueba' } = {}) {
  const ahora = Math.floor(Date.now() / 1000);
  const carga = {
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1000000000000000001', email: 'persona@gmail.com',
    email_verified: true, name: 'Persona de Prueba', iat: ahora - 5, exp: ahora + 3600, ...extra
  };
  Object.keys(carga).forEach((k) => { if (carga[k] === undefined) delete carga[k]; });
  const firmar = `${b64({ alg: 'RS256', typ: 'JWT', kid })}.${b64(carga)}`;
  const firma = crypto.sign('RSA-SHA256', Buffer.from(firmar), llave).toString('base64url');
  return `${firmar}.${firma}`;
}

async function main() {
  const resend = await levantarResendFalso();
  process.env.RESEND_API_URL = `http://127.0.0.1:${resend.address().port}/emails`;

  const mongoose = require('mongoose');
  const { connect } = require('../src/db');
  const { importIfEmpty } = require('../src/importer');
  const { createApp } = require('../src/app');
  const google = require('../src/google');
  const { Usuario, Recuperacion } = require('../src/models');
  const { hashPassword } = require('../src/passwords');

  await connect(uri);
  await importIfEmpty();
  // Los certificados de Google se reemplazan por la llave pública de prueba.
  google.cliente.getFederatedSignonCertsAsync = async () => ({
    certs: { 'llave-de-prueba': publicKey.export({ type: 'spki', format: 'pem' }) },
    format: 'PEM'
  });

  const servidor = createApp().listen(0, '127.0.0.1');
  await new Promise((resolver) => servidor.on('listening', resolver));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let n = 10;
  const nuevoCliente = () => crearCliente(base, `10.20.0.${n++}`);

  try {
    /* ============ CRUD del admin ============ */
    titulo('Parte 1a: CRUD de usuarios desde el panel de administración');
    const invitado = nuevoCliente();
    assert((await invitado.pedir('GET', '/admin/usuarios/nuevo')).status === 302, 'sin sesión, "Nuevo usuario" redirige (no es público)');
    const admin = nuevoCliente();
    const entrada = await admin.entrar('admin', CLAVE_ADMIN);
    assert(entrada.status === 302 && entrada.ubicacion === '/admin', 'el admin entra con su contraseña');

    const formulario = await admin.pedir('GET', '/admin/usuarios/nuevo');
    assert(formulario.status === 200 && /Nuevo Usuario/.test(formulario.texto) && /action="\/admin\/usuarios\/nuevo"/.test(formulario.texto), 'el admin ve el formulario de "Nuevo Usuario"');
    const lista0 = await admin.pedir('GET', '/admin/usuarios');
    assert(/href="\/admin\/usuarios\/nuevo"/.test(lista0.texto), 'la lista de usuarios tiene el botón "Nuevo usuario"');

    const csrf = await admin.token('/admin/usuarios/nuevo');
    const base1 = { nombre: 'Ana Prueba', usuario: 'ana_prueba', email: 'ana@prueba.com', telefono: '3001112222', ciudad: 'Villavicencio', direccion: 'Calle 1', rol: 'cliente', password: 'ClaveAna2026' };
    const crear = (campos, token = csrf) => admin.pedir('POST', '/admin/usuarios/nuevo', { form: campos, csrf: token });
    assert((await admin.pedir('POST', '/admin/usuarios/nuevo', { form: base1 })).status === 403, 'crear un usuario sin token CSRF se rechaza');
    let r = await crear({ ...base1, email: 'esto-no-es-correo' });
    assert(r.status === 400 && /correo válido/.test(r.texto), 'un correo inválido se rechaza y el formulario conserva lo escrito');
    assert(/value="ana_prueba"/.test(r.texto), 'al fallar, el formulario no pierde los datos escritos');
    r = await crear({ ...base1, usuario: 'ana@algo' });
    assert(r.status === 400 && /sin espacios ni @/.test(r.texto), 'un usuario con "@" se rechaza (no se confunde con un correo)');
    r = await crear({ ...base1, password: '1234567' });
    assert(r.status === 400 && /al menos 8/.test(r.texto), 'una contraseña de 7 caracteres se rechaza');
    r = await crear({ ...base1, nombre: 'x'.repeat(101) });
    assert(r.status === 400 && /hasta 100/.test(r.texto), 'un nombre demasiado largo se rechaza');
    r = await crear({ ...base1, usuario: 'admin' });
    assert(r.status === 400 && /ya están registrados/.test(r.texto), 'no se puede repetir un usuario existente');
    r = await crear({ ...base1, email: 'ADMIN@ecoflora.com' });
    assert(r.status === 400 && /ya están registrados/.test(r.texto), 'no se puede repetir un correo (sin importar mayúsculas)');
    r = await crear(base1);
    assert(r.status === 302 && r.ubicacion === '/admin/usuarios?creado=1', 'CREAR: el usuario se crea y se vuelve a la lista');
    const ana = await Usuario.findOne({ usuario: 'ana_prueba' }).lean();
    assert(ana && ana.rol === 'cliente' && ana.proveedor === 'local' && ana.password.startsWith('$2') && !ana.password.includes('ClaveAna'), 'la contraseña se guarda cifrada (bcrypt), nunca en claro');
    const lista = await admin.pedir('GET', '/admin/usuarios?creado=1');
    assert(/Usuario creado correctamente/.test(lista.texto) && /ana@prueba\.com/.test(lista.texto), 'LEER: la lista muestra el aviso y el usuario nuevo');

    const anaCliente = nuevoCliente();
    const entradaAna = await anaCliente.entrar('ana_prueba', 'ClaveAna2026');
    assert(entradaAna.status === 302, 'la cuenta creada por el admin puede iniciar sesión');
    const intruso = await anaCliente.pedir('GET', '/admin/usuarios/nuevo');
    assert(intruso.status === 302 && /error=/.test(intruso.ubicacion), 'un cliente no puede abrir "Nuevo usuario"');
    const csrfAna = await anaCliente.token('/usuario/perfil');
    r = await anaCliente.pedir('POST', '/admin/usuarios/nuevo', { form: { ...base1, usuario: 'colado', email: 'colado@x.com' }, csrf: csrfAna });
    assert(r.status === 302 && !(await Usuario.exists({ usuario: 'colado' })), 'un cliente tampoco puede crear usuarios con un POST directo');

    const editar = await admin.pedir('GET', `/admin/usuarios/${ana.id_usuario}/editar`);
    assert(editar.status === 200 && /Editar Usuario/.test(editar.texto), 'LEER: se abre el formulario de edición');
    const csrfEdit = await admin.token(`/admin/usuarios/${ana.id_usuario}/editar`);
    const cambiar = (campos) => admin.pedir('POST', `/admin/usuarios/${ana.id_usuario}`, { form: { nombre: 'Ana Editada', usuario: 'ana_prueba', email: 'ana@prueba.com', telefono: '', ciudad: '', direccion: '', rol: 'cliente', password: '', ...campos }, csrf: csrfEdit });
    r = await cambiar({ email: 'mal correo' });
    assert(r.status === 302 && /error=/.test(r.ubicacion), 'ACTUALIZAR: un correo inválido se rechaza');
    r = await cambiar({});
    assert(r.status === 302 && r.ubicacion === '/admin/usuarios?actualizado=1', 'ACTUALIZAR: el cambio se guarda');
    assert((await Usuario.findOne({ id_usuario: ana.id_usuario }).lean()).nombre === 'Ana Editada', 'el nombre quedó actualizado en MongoDB');

    // Sesión abierta de Ana + cambio de contraseña hecho por el admin => la sesión de Ana se cierra.
    assert((await anaCliente.pedir('GET', '/usuario/perfil')).status === 200, 'Ana tiene una sesión abierta');
    r = await cambiar({ password: 'ClaveNuevaAna2026' });
    assert(r.status === 302 && r.ubicacion === '/admin/usuarios?actualizado=1', 'el admin le cambia la contraseña a Ana');
    assert((await anaCliente.pedir('GET', '/usuario/perfil')).status === 302, 'al cambiarle la contraseña se cierra la sesión que Ana tenía abierta');
    assert((await nuevoCliente().entrar('ana_prueba', 'ClaveNuevaAna2026')).status === 302, 'Ana entra con la contraseña nueva');

    // Siempre debe quedar un administrador.
    const adminDb = await Usuario.findOne({ usuario: 'admin' }).lean();
    r = await admin.pedir('POST', `/admin/usuarios/${adminDb.id_usuario}`, { form: { nombre: 'Admin', usuario: 'admin', email: 'admin@ecoflora.com', telefono: '', ciudad: '', direccion: '', rol: 'cliente', password: '' }, csrf: csrfEdit });
    assert(r.status === 302 && /Debe%20quedar%20al%20menos%20un%20administrador/.test(r.ubicacion), 'el último administrador no se puede degradar');
    r = await admin.pedir('POST', `/admin/usuarios/${adminDb.id_usuario}/eliminar`, { csrf: csrfEdit, form: {} });
    assert(r.status === 302 && /propia%20cuenta/.test(r.ubicacion), 'el admin no puede borrarse a sí mismo');

    r = await admin.pedir('POST', `/admin/usuarios/${ana.id_usuario}/eliminar`, { csrf: csrfEdit, form: {} });
    assert(r.status === 302 && r.ubicacion === '/admin/usuarios?eliminado=1', 'ELIMINAR: el usuario se borra');
    assert(!(await Usuario.exists({ usuario: 'ana_prueba' })), 'ya no existe en MongoDB');

    /* ============ Google ============ */
    titulo('Parte 1b: iniciar sesión / registrarse con Google');
    const paginaLogin = (await nuevoCliente().pedir('GET', '/login')).texto;
    assert(/data-google/.test(paginaLogin) && new RegExp(`data-client-id="${CLIENT_ID.replace(/\./g, '\\.')}"`).test(paginaLogin), 'con GOOGLE_CLIENT_ID configurado, el login muestra "Continuar con Google"');
    assert(/data-google/.test((await nuevoCliente().pedir('GET', '/registro')).texto), 'y el registro también');
    assert(/href="\/recuperar"/.test(paginaLogin), 'el login ofrece "¿Olvidaste tu contraseña?"');
    const csp = (await nuevoCliente().pedir('GET', '/login')).cabeceras.get('content-security-policy');
    assert(/accounts\.google\.com\/gsi\/client/.test(csp), 'la CSP permite el script de Google Identity Services');

    const g = nuevoCliente();
    const csrfG = await g.token('/login');
    const enviarGoogle = (cliente, credential, token = csrfG) => cliente.pedir('POST', '/auth/google', { json: { credential }, csrf: token });
    assert((await g.pedir('POST', '/auth/google', { json: { credential: fabricarToken() } })).status === 403, 'sin token CSRF, /auth/google se rechaza');
    r = await enviarGoogle(g, 'esto-no-es-un-token');
    assert(r.status === 401, 'un texto cualquiera se rechaza');
    r = await enviarGoogle(g, fabricarToken({}, { llave: otraLlave.privateKey }));
    assert(r.status === 401, 'un token firmado con otra llave (no es de Google) se rechaza');
    r = await enviarGoogle(g, fabricarToken({ aud: 'otro-sitio.apps.googleusercontent.com' }));
    assert(r.status === 401, 'un token hecho para OTRO sitio se rechaza (audiencia)');
    r = await enviarGoogle(g, fabricarToken({ exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 7200 }));
    assert(r.status === 401, 'un token vencido se rechaza');
    r = await enviarGoogle(g, fabricarToken({ iss: 'https://sitio-falso.com' }));
    assert(r.status === 401, 'un token de otro emisor se rechaza');
    r = await enviarGoogle(g, fabricarToken({ email_verified: false }));
    assert(r.status === 403 && /no está verificado/.test(r.texto), 'un correo de Google sin verificar se rechaza');
    assert(!(await Usuario.exists({ email: 'persona@gmail.com' })), 'ningún intento fallido creó una cuenta');

    r = await enviarGoogle(g, fabricarToken());
    let cuerpo = JSON.parse(r.texto);
    assert(r.status === 200 && cuerpo.ok === true && cuerpo.nuevo === true && /bienvenida=1/.test(cuerpo.destino), 'REGISTRO con Google: un token válido crea la cuenta y entra');
    const personaDb = await Usuario.findOne({ email: 'persona@gmail.com' }).lean();
    assert(personaDb && personaDb.proveedor === 'google' && personaDb.google_id === '1000000000000000001' && personaDb.password === '' && personaDb.rol === 'cliente', 'se guardó proveedor=google, google_id y sin contraseña, como cliente');
    assert(/^[\w.-]{3,40}$/.test(personaDb.usuario), `se inventó un usuario válido (${personaDb.usuario})`);
    assert((await g.pedir('GET', '/usuario/perfil')).status === 200, 'la sesión quedó abierta');
    const perfil = await g.pedir('GET', '/usuario/perfil?bienvenida=1');
    assert(/Bienvenido a EcoFlora/.test(perfil.texto), 'se le da la bienvenida en su perfil');

    const g2 = nuevoCliente();
    r = await g2.entrar('persona@gmail.com', 'cualquier-cosa');
    assert(r.status === 401, 'una cuenta de Google sin contraseña NO entra con el formulario de clave');
    const g3 = nuevoCliente();
    r = await enviarGoogle(g3, fabricarToken(), await g3.token('/login'));
    cuerpo = JSON.parse(r.texto);
    assert(r.status === 200 && cuerpo.nuevo === false && cuerpo.destino === '/', 'LOGIN con Google: la segunda vez entra a la misma cuenta');
    assert((await Usuario.countDocuments({ email: 'persona@gmail.com' })) === 1, 'no se duplica la cuenta');

    // Cuenta local existente con el mismo correo => se vincula, y su contraseña sigue sirviendo.
    await Usuario.create({ id_usuario: 9001, nombre: 'Luis Local', usuario: 'luis', email: 'luis@gmail.com', password: await hashPassword('ClaveLuis2026'), rol: 'cliente' });
    const g4 = nuevoCliente();
    r = await enviarGoogle(g4, fabricarToken({ sub: '2000000000000000002', email: 'luis@gmail.com', name: 'Luis' }), await g4.token('/login'));
    assert(r.status === 200 && JSON.parse(r.texto).nuevo === false, 'si el correo ya tenía cuenta, entra a ESA cuenta (no crea otra)');
    const luis = await Usuario.findOne({ usuario: 'luis' }).lean();
    assert(luis.google_id === '2000000000000000002' && luis.password.startsWith('$2'), 'la cuenta se vinculó con Google y conserva su contraseña');
    assert((await nuevoCliente().entrar('luis', 'ClaveLuis2026')).status === 302, 'Luis sigue pudiendo entrar con su contraseña');
    const g5 = nuevoCliente();
    r = await enviarGoogle(g5, fabricarToken({ sub: '3000000000000000003', email: 'luis@gmail.com' }), await g5.token('/login'));
    assert(r.status === 403 && JSON.parse(r.texto).codigo === 'otra_cuenta_google', 'otra cuenta de Google con el mismo correo no puede apropiarse de esa cuenta');

    const g6 = nuevoCliente();
    r = await enviarGoogle(g6, fabricarToken({ sub: '4000000000000000004', email: 'admin@ecoflora.com' }), await g6.token('/login'));
    assert(r.status === 403 && JSON.parse(r.texto).codigo === 'solo_contrasena', 'la cuenta de administración NO entra con Google');
    assert(!(await Usuario.findOne({ usuario: 'admin' }).lean()).google_id, 'y no se le vincula ningún google_id');

    // Límite de intentos
    const g7 = nuevoCliente();
    const csrf7 = await g7.token('/login');
    let limitado = false;
    for (let i = 0; i < 25 && !limitado; i += 1) limitado = (await enviarGoogle(g7, 'basura.basura.basura-basura', csrf7)).status === 429;
    assert(limitado, 'demasiados intentos desde una IP se frenan (429)');

    /* ============ Recuperar contraseña ============ */
    titulo('Parte 1c: recuperar la contraseña por correo');
    const paginaRec = await nuevoCliente().pedir('GET', '/recuperar');
    assert(paginaRec.status === 200 && /name="dato"/.test(paginaRec.texto) && paginaRec.cabeceras.get('cache-control') === 'no-store', 'la página /recuperar existe y no se guarda en caché');

    const pedirRecuperacion = async (cliente, dato) => cliente.pedir('POST', '/recuperar', { form: { dato }, csrf: await cliente.token('/recuperar') });
    const generico = /Si existe una cuenta con esos datos/;
    const r1 = nuevoCliente();
    let rr = await pedirRecuperacion(r1, 'nadie@noexiste.com');
    assert(rr.status === 200 && generico.test(rr.texto), 'un correo que no existe recibe el mismo mensaje genérico');
    await dormir(300);
    assert(correos.length === 0, 'y no se envía ningún correo');

    const r2 = nuevoCliente();
    rr = await pedirRecuperacion(r2, 'luis@gmail.com');
    assert(rr.status === 200 && generico.test(rr.texto), 'un correo que sí existe recibe EL MISMO mensaje');
    assert(await esperarCorreos(1), 'se envió un correo');
    const correo = correos[0];
    assert(correo.to.length === 1 && correo.to[0] === 'luis@gmail.com', 'el correo va a la dirección de la cuenta (no al dueño del sitio)');
    const enlace = (/https?:\/\/[^\s"<]+\/recuperar\/[\w-]{43}/.exec(correo.text) || [])[0];
    assert(Boolean(enlace), 'el correo trae un enlace con un token de 256 bits');
    const token = enlace.split('/').pop();
    assert(/30 minutos/.test(correo.text) && /ignora este correo/i.test(correo.text), 'el correo avisa que vale 30 minutos y qué hacer si no fue la persona');
    const guardado = await Recuperacion.find({ id_usuario: 9001 }).lean();
    assert(guardado.length === 1 && guardado[0].token_hash !== token && guardado[0].token_hash === crypto.createHash('sha256').update(token).digest('hex'), 'en MongoDB solo queda el hash SHA-256 del token, no el token');
    assert(guardado[0].vence.getTime() - Date.now() <= 30 * 60 * 1000 && guardado[0].vence.getTime() - Date.now() > 29 * 60 * 1000, 'vence en 30 minutos');
    assert(rr.texto.includes(token) === false, 'la respuesta del sitio nunca incluye el token');

    const r3 = nuevoCliente();
    let pagina = await r3.pedir('GET', `/recuperar/${token}`);
    assert(pagina.status === 200 && /Elige tu nueva contraseña/.test(pagina.texto) && pagina.cabeceras.get('cache-control') === 'no-store', 'el enlace abre el formulario de contraseña nueva');
    const { Historial } = require('../src/models');
    assert((await Historial.countDocuments({ url: { $regex: '/recuperar/' } })) === 0, 'el token del enlace NO queda guardado en el historial de navegación');
    assert((await r3.pedir('GET', '/recuperar/' + 'a'.repeat(43))).status === 400, 'un token inventado no sirve');
    assert((await r3.pedir('GET', '/recuperar/corto')).status === 400, 'un token con formato raro no sirve');
    const csrfR = await r3.token(`/recuperar/${token}`);
    const cambiarClave = (cliente, tk, campos, csrfToken) => cliente.pedir('POST', `/recuperar/${tk}`, { form: campos, csrf: csrfToken });
    assert((await r3.pedir('POST', `/recuperar/${token}`, { form: { password: 'ClaveLuisNueva1', confirmar: 'ClaveLuisNueva1' } })).status === 403, 'cambiar la clave sin token CSRF se rechaza');
    rr = await cambiarClave(r3, token, { password: 'ClaveLuisNueva1', confirmar: 'otra-distinta' }, csrfR);
    assert(rr.status === 400 && /no coinciden/.test(rr.texto), 'si las contraseñas no coinciden se avisa (el enlace sigue vivo)');
    rr = await cambiarClave(r3, token, { password: '1234567', confirmar: '1234567' }, csrfR);
    assert(rr.status === 400 && /al menos 8/.test(rr.texto), 'una contraseña de 7 caracteres se rechaza');
    assert((await Recuperacion.countDocuments({ id_usuario: 9001 })) === 1, 'los intentos fallidos no gastan el enlace');

    // Luis tiene una sesión abierta en otro navegador: al cambiar la clave debe cerrarse.
    const luisSesion = nuevoCliente();
    await luisSesion.entrar('luis', 'ClaveLuis2026');
    assert((await luisSesion.pedir('GET', '/usuario/perfil')).status === 200, 'Luis tiene una sesión abierta en otro navegador');
    rr = await cambiarClave(r3, token, { password: 'ClaveLuisNueva1', confirmar: 'ClaveLuisNueva1' }, csrfR);
    assert(rr.status === 302 && rr.ubicacion === '/login?clave=cambiada', 'con datos correctos la contraseña se cambia y se envía al login');
    const loginMsg = await r3.pedir('GET', rr.ubicacion);
    assert(/tu contraseña se cambió/.test(loginMsg.texto), 'el login confirma el cambio');
    assert((await nuevoCliente().entrar('luis', 'ClaveLuis2026')).status === 401, 'la contraseña vieja ya no sirve');
    assert((await nuevoCliente().entrar('luis', 'ClaveLuisNueva1')).status === 302, 'la nueva sí');
    assert((await luisSesion.pedir('GET', '/usuario/perfil')).status === 302, 'la sesión que estaba abierta se cerró al cambiar la contraseña');
    pagina = await nuevoCliente().pedir('GET', `/recuperar/${token}`);
    assert(pagina.status === 400 && /Enlace no válido/.test(pagina.texto), 'el enlace es de UN solo uso: ya no abre');
    rr = await cambiarClave(r3, token, { password: 'OtraClave12345', confirmar: 'OtraClave12345' }, csrfR);
    assert(rr.status === 400 && (await nuevoCliente().entrar('luis', 'OtraClave12345')).status === 401, 'reusar el enlace tampoco cambia la contraseña');

    // Vencimiento
    const r4 = nuevoCliente();
    correos.length = 0;
    await pedirRecuperacion(r4, 'luis');
    await esperarCorreos(1);
    const token2 = (/\/recuperar\/([\w-]{43})/.exec(correos[0].text) || [])[1];
    assert(Boolean(token2) && token2 !== token, 'se puede pedir un enlace por nombre de usuario y es distinto al anterior');
    await Recuperacion.updateOne({ id_usuario: 9001 }, { $set: { vence: new Date(Date.now() - 1000) } });
    pagina = await nuevoCliente().pedir('GET', `/recuperar/${token2}`);
    assert(pagina.status === 400 && /Enlace no válido/.test(pagina.texto), 'un enlace vencido no abre');

    // Un enlace nuevo invalida el anterior
    const r5 = nuevoCliente();
    correos.length = 0;
    await pedirRecuperacion(r5, 'luis@gmail.com');
    await esperarCorreos(1);
    const tokenA = (/\/recuperar\/([\w-]{43})/.exec(correos[0].text) || [])[1];
    const r6 = nuevoCliente();
    await pedirRecuperacion(r6, 'luis@gmail.com');
    await esperarCorreos(2);
    const tokenB = (/\/recuperar\/([\w-]{43})/.exec(correos[1].text) || [])[1];
    assert((await nuevoCliente().pedir('GET', `/recuperar/${tokenA}`)).status === 400 && (await nuevoCliente().pedir('GET', `/recuperar/${tokenB}`)).status === 200, 'pedir un enlace nuevo invalida el anterior');

    // Límite por cuenta: 3 correos por hora (ya van 5 pedidos de luis; ninguno más sale)
    correos.length = 0;
    await pedirRecuperacion(nuevoCliente(), 'luis@gmail.com');
    await dormir(400);
    assert(correos.length === 0, 'una misma cuenta no puede recibir más de 3 correos por hora (aun así se muestra el mensaje genérico)');

    // Una cuenta de Google puede crear contraseña con este mismo camino
    correos.length = 0;
    await pedirRecuperacion(nuevoCliente(), 'persona@gmail.com');
    await esperarCorreos(1);
    const tokenG = (/\/recuperar\/([\w-]{43})/.exec(correos[0].text) || [])[1];
    const rg = nuevoCliente();
    const csrfRg = await rg.token(`/recuperar/${tokenG}`);
    rr = await cambiarClave(rg, tokenG, { password: 'ClavePersona2026', confirmar: 'ClavePersona2026' }, csrfRg);
    assert(rr.status === 302 && (await nuevoCliente().entrar('persona@gmail.com', 'ClavePersona2026')).status === 302, 'quien se registró con Google puede crear una contraseña desde "Olvidé mi contraseña"');

    // Límite por IP
    const ipLimitada = crearCliente(base, '10.99.99.99');
    let paro = false;
    for (let i = 0; i < 8 && !paro; i += 1) paro = (await pedirRecuperacion(ipLimitada, `alguien${i}@x.com`)).status === 429;
    assert(paro, 'demasiadas solicitudes desde una IP se frenan (429)');

    // El enlace no se arma con el encabezado Host en producción
    const { urlPublica } = require('../src/mailer');
    assert(urlPublica() === '', 'sin PUBLIC_URL/RENDER_EXTERNAL_URL no hay dirección pública configurada (en producción no se envía el correo con un Host falso)');
  } finally {
    servidor.close();
    resend.close();
    try { await mongoose.connection.dropDatabase(); } catch (error) { /* nada */ }
    await mongoose.disconnect();
  }
  console.log(`\nTodo bien: ${comprobaciones} comprobaciones de la Parte 1 (usuarios, Google y recuperación) pasaron.`);
}

main().catch(async (error) => {
  console.error('\nFALLO:', error.message);
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  } catch (e) { /* nada */ }
  process.exit(1);
});

