// Comprueba las medidas de seguridad de EcoFlora: límite de intentos y mensaje genérico en el login,
// sesión (cookie propia, regeneración, logout), CSRF, encabezados (CSP/HSTS), contraseñas, límites de
// tamaño, y el arranque en producción (SESSION_SECRET obligatoria, contraseña del admin).
//
// Uso (con MongoDB LOCAL encendido; el script levanta sus propias copias de la app y borra sus bases al terminar):
//   MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora node scripts/verify-seguridad.js
//
// Variables opcionales: TEST_APP_PORT (por defecto 3201; también usa el siguiente número).
// No toca la base que indiques en MONGODB_URI: crea bases temporales "ecoflora_seg_..." en el mismo MongoDB.
// Los límites de intentos viven en la memoria de cada copia de la app, por eso se puede repetir sin reiniciar nada.

const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const PUERTO = Number(process.env.TEST_APP_PORT) || 3201;
const uriBase = process.env.MONGODB_URI || '';
const CLAVE_ADMIN = 'ClaveAdmin2026';
const SECRETO = 'secreto-de-prueba-' + crypto.randomBytes(12).toString('hex');
const MENSAJE_GENERICO = 'Usuario o contraseña incorrectos';
const sufijo = Date.now();

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const basesCreadas = [];
const procesos = new Set();
let comprobaciones = 0;

function assert(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
  comprobaciones += 1;
  console.log('ok', mensaje);
}

function titulo(texto) {
  console.log(`\n== ${texto} ==`);
}

// ---------- Bases temporales y copias de la app ----------

function uriDeBase(nombre) {
  const url = new URL(uriBase);
  url.pathname = '/' + nombre;
  return url.toString();
}

function nuevaBase(etiqueta) {
  const nombre = `ecoflora_seg_${etiqueta}_${sufijo}`;
  basesCreadas.push(nombre);
  return uriDeBase(nombre);
}

// Variables del entorno que NO deben colarse del terminal de quien corre la prueba.
const VARIABLES_LIMPIAS = ['NODE_ENV', 'SESSION_SECRET', 'ADMIN_INITIAL_PASSWORD', 'FACE_ENCRYPTION_KEY', 'FACE_MATCH_THRESHOLD',
  'FACE_MATCH_THRESHOLD_ADMIN', 'RESEND_API_KEY', 'RENDER'];

function lanzar({ puerto, uri, env = {} }) {
  const entorno = { ...process.env };
  VARIABLES_LIMPIAS.forEach((nombre) => { entorno[nombre] = ''; }); // vacío: así tampoco las rellena dotenv
  Object.assign(entorno, { PORT: String(puerto), MONGODB_URI: uri }, env);
  const proceso = spawn(process.execPath, ['server.js'], { cwd: raiz, env: entorno, stdio: ['ignore', 'pipe', 'pipe'] });
  procesos.add(proceso);
  let log = '';
  proceso.stdout.on('data', (d) => { log += d; });
  proceso.stderr.on('data', (d) => { log += d; });
  const salida = new Promise((resolver) => proceso.on('exit', (codigo) => { procesos.delete(proceso); resolver(codigo); }));
  const base = `http://127.0.0.1:${puerto}`;
  return {
    base,
    log: () => log,
    salida,
    async listo() {
      for (let i = 0; i < 60; i += 1) {
        if (proceso.exitCode !== null) throw new Error('La app se cerró al arrancar:\n' + log);
        try {
          const r = await fetch(base + '/health');
          if (r.status === 200) return;
        } catch (error) { /* todavía no */ }
        await dormir(500);
      }
      throw new Error('La app no respondió a tiempo:\n' + log);
    },
    async detener() {
      if (proceso.exitCode === null) proceso.kill('SIGTERM');
      await Promise.race([salida, dormir(5000)]);
      if (proceso.exitCode === null) proceso.kill('SIGKILL');
    }
  };
}

async function esperarSalida(app, ms = 20000) {
  const resultado = await Promise.race([app.salida, dormir(ms).then(() => 'sigue')]);
  return resultado;
}

// ---------- Cliente HTTP que imita al navegador ----------

// Guarda cookies y el token CSRF de la sesión, y lo manda en cada POST (_csrf en formularios, X-CSRF-Token en JSON).
// Opciones de pedir(): form, json, crudo, ip (X-Forwarded-For), sinCsrf (no manda token), csrf (token distinto).
function crearCliente(base, encabezadosBase = {}) {
  const jar = new Map();
  let token = null;
  let ultimaSetCookie = [];

  async function enviar(metodo, ruta, { json, form, ip, crudo, encabezados, tipo } = {}) {
    const headers = { Accept: json !== undefined || crudo !== undefined ? 'application/json' : 'text/html', ...encabezadosBase };
    const cookie = [...jar.entries()].map(([nombre, valor]) => `${nombre}=${valor}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    if (ip) headers['X-Forwarded-For'] = ip;
    Object.assign(headers, encabezados || {});
    let cuerpo;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(json);
    } else if (crudo !== undefined) {
      headers['Content-Type'] = tipo || 'application/json';
      cuerpo = crudo;
    } else if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      cuerpo = new URLSearchParams(form).toString();
    }
    const inicio = process.hrtime.bigint();
    const respuesta = await fetch(base + ruta, { method: metodo, headers, body: cuerpo, redirect: 'manual' });
    const texto = await respuesta.text();
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    const sesionAntes = jar.get('ecoflora.sid');
    ultimaSetCookie = respuesta.headers.getSetCookie ? respuesta.headers.getSetCookie() : [];
    ultimaSetCookie.forEach((entrada) => {
      const [par] = entrada.split(';');
      const i = par.indexOf('=');
      const nombre = par.slice(0, i).trim();
      const valor = par.slice(i + 1).trim();
      if (!valor) jar.delete(nombre);
      else jar.set(nombre, valor);
    });
    if (jar.get('ecoflora.sid') !== sesionAntes) token = null; // sesión nueva: el token anterior ya no sirve
    const encontrado = texto.match(/name="_csrf" value="([^"]+)"/) || texto.match(/data-csrf="([^"]+)"/);
    if (encontrado) token = encontrado[1];
    let datos = null;
    try { datos = JSON.parse(texto); } catch (error) { datos = null; }
    return { status: respuesta.status, texto, datos, location: respuesta.headers.get('location'), cabeceras: respuesta.headers, setCookie: ultimaSetCookie, ms };
  }

  async function pedir(metodo, ruta, opciones = {}) {
    if (metodo !== 'GET' && !opciones.sinCsrf) {
      if (!token && opciones.csrf === undefined) await enviar('GET', '/login', { ip: opciones.ip });
      const valor = opciones.csrf !== undefined ? opciones.csrf : token;
      if (opciones.json !== undefined || opciones.crudo !== undefined) {
        opciones = { ...opciones, encabezados: { 'X-CSRF-Token': valor, ...(opciones.encabezados || {}) } };
      } else {
        opciones = { ...opciones, form: { ...(opciones.form || {}), _csrf: valor } };
      }
    }
    return enviar(metodo, ruta, opciones);
  }

  return {
    pedir,
    cookie: (nombre) => jar.get(nombre),
    ponerCookie: (nombre, valor) => jar.set(nombre, valor),
    token: () => token
  };
}

// ---------- Utilidades ----------

const mediana = (numeros) => [...numeros].sort((a, b) => a - b)[Math.floor(numeros.length / 2)];

function formulariosPost(html) {
  const resultado = [];
  const re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bmethod\s*=\s*["']?post/i.test(m[1])) resultado.push({ etiqueta: m[1], cuerpo: m[2] });
  }
  return resultado;
}

async function registrar(app, usuario, clave = 'clave12345', extra = {}) {
  const c = crearCliente(app.base);
  const r = await c.pedir('POST', '/registro', {
    form: { nombre: 'Prueba ' + usuario, usuario, email: `${usuario}@ecoflora.test`, telefono: '3000000000', direccion: 'Calle 1', ciudad: 'Bogotá', password: clave, confirmar: clave, ...extra }
  });
  return { c, r };
}

async function entrar(app, usuario, password, ip) {
  const c = crearCliente(app.base);
  const r = await c.pedir('POST', '/login', { form: { usuario, password }, ip });
  return { c, r };
}

// ---------- Pruebas ----------

async function pruebaLogin(app) {
  titulo('Parte 1: login con contraseña (límite de intentos y mensaje genérico)');

  const admin = await entrar(app, 'admin', CLAVE_ADMIN);
  assert(admin.r.status === 302 && admin.r.location === '/admin', 'el admin entra con la contraseña de ADMIN_INITIAL_PASSWORD');
  const fabrica = await entrar(app, 'admin', 'Admin123', '10.9.9.9');
  assert(fabrica.r.status === 401, 'la contraseña de fábrica Admin123 ya NO entra (el volcado SQL no trae su hash)');

  await registrar(app, 'existe_ya');
  const mal = await entrar(app, 'existe_ya', 'otra-clave-mala', '10.2.0.1');
  const fantasma = await entrar(app, 'usuario_que_no_existe', 'otra-clave-mala', '10.2.0.2');
  assert(mal.r.status === 401 && fantasma.r.status === 401, 'contraseña mala y usuario inexistente responden igual (401)');
  assert(mal.r.texto.includes(MENSAJE_GENERICO) && fantasma.r.texto.includes(MENSAJE_GENERICO), `los dos reciben el mensaje "${MENSAJE_GENERICO}"`);
  assert(!/no existe|no encontrad|no está registrad|Contraseña incorrecta\./i.test(mal.r.texto + fantasma.r.texto), 'ningún mensaje revela si el usuario existe');

  // Tiempo parecido: el usuario inexistente también gasta un bcrypt (contra un hash falso).
  const conUsuario = [];
  const sinUsuario = [];
  for (let i = 0; i < 5; i += 1) {
    conUsuario.push((await entrar(app, 'existe_ya', 'clave-mala-' + i, `10.3.0.${i + 1}`)).r.ms);
    sinUsuario.push((await entrar(app, 'fantasma_' + i, 'clave-mala-' + i, `10.3.1.${i + 1}`)).r.ms);
  }
  const a = mediana(conUsuario);
  const b = mediana(sinUsuario);
  assert(b > a * 0.5 && b < a * 2, `el tiempo de respuesta es parecido (mediana ${a.toFixed(0)} ms con usuario, ${b.toFixed(0)} ms sin usuario)`);

  // 5 intentos fallidos desde la misma IP + usuario -> el sexto se bloquea (aunque la clave sea la correcta).
  await registrar(app, 'limite_ip');
  const codigos = [];
  for (let i = 0; i < 5; i += 1) codigos.push((await entrar(app, 'limite_ip', 'mala-' + i, '10.1.1.1')).r.status);
  assert(codigos.every((c) => c === 401), `los primeros 5 intentos fallidos responden 401 (${codigos.join(', ')})`);
  const sexto = await entrar(app, 'limite_ip', 'mala-6', '10.1.1.1');
  assert(sexto.r.status === 429 && /demasiados|intenta de nuevo|minutos/i.test(sexto.r.texto), 'el sexto intento se frena con 429 y un aviso');
  const correctaBloqueada = await entrar(app, 'limite_ip', 'clave12345', '10.1.1.1');
  assert(correctaBloqueada.r.status === 429, 'mientras está frenado, ni la contraseña correcta entra desde esa IP');
  const otraIp = await entrar(app, 'limite_ip', 'clave12345', '10.1.1.2');
  assert(otraIp.r.status === 302, 'la dueña de la cuenta sí entra desde otra IP (el límite es por IP + usuario)');
  await registrar(app, 'otro_usuario');
  const mismaIp = await entrar(app, 'otro_usuario', 'clave12345', '10.1.1.1');
  assert(mismaIp.r.status === 302, 'otro usuario desde la IP frenada no se ve afectado');

  // 10 fallos al mismo usuario desde 10 IPs distintas -> se frena el usuario (aunque la IP sea nueva).
  await registrar(app, 'limite_usuario');
  for (let i = 0; i < 10; i += 1) await entrar(app, 'limite_usuario', 'mala-' + i, `10.4.0.${i + 1}`);
  const nuevaIp = await entrar(app, 'limite_usuario', 'clave12345', '10.4.9.9');
  assert(nuevaIp.r.status === 429, 'a los 10 fallos el usuario queda frenado incluso desde una IP nueva');

  // Entrar bien reinicia la cuenta de fallos.
  await registrar(app, 'reinicio');
  for (let i = 0; i < 4; i += 1) await entrar(app, 'reinicio', 'mala-' + i, '10.5.0.1');
  const bien = await entrar(app, 'reinicio', 'clave12345', '10.5.0.1');
  assert(bien.r.status === 302, 'entrar bien tras 4 fallos funciona');
  const despues = [];
  for (let i = 0; i < 5; i += 1) despues.push((await entrar(app, 'reinicio', 'mala-' + i, '10.5.0.1')).r.status);
  assert(despues.every((c) => c === 401), `entrar bien reinició el contador (5 fallos más sin bloqueo: ${despues.join(', ')})`);

  // Inyección NoSQL: un objeto en lugar de texto no sirve para entrar.
  const inyeccion = crearCliente(app.base);
  const inyec = await inyeccion.pedir('POST', '/login', { form: { 'usuario[$ne]': 'nadie', 'password[$ne]': 'nada' }, ip: '10.6.0.1' });
  assert(inyec.status !== 302 && inyec.status < 500, `un usuario con forma de objeto ({"$ne":...}) no entra (estado ${inyec.status})`);
  await dormir(300);
  assert(/Entrada sanitizada en POST \/login/.test(app.log()), 'express-mongo-sanitize quitó la clave "$ne" (queda anotado en el log)');
}

async function pruebaSesion(app) {
  titulo('Parte 2: sesión (cookie propia, regeneración, logout)');

  const c = crearCliente(app.base);
  const inicio = await c.pedir('GET', '/login');
  const crudaSesion = inicio.setCookie.find((s) => s.startsWith('ecoflora.sid='));
  assert(Boolean(crudaSesion), 'la cookie de sesión se llama "ecoflora.sid"');
  assert(!inicio.setCookie.some((s) => s.startsWith('connect.sid')), 'ya no se usa el nombre por defecto "connect.sid"');
  assert(/HttpOnly/i.test(crudaSesion) && /SameSite=Lax/i.test(crudaSesion), 'la cookie es HttpOnly y SameSite=Lax');
  assert(!/;\s*Secure/i.test(crudaSesion), 'en desarrollo (http) la cookie no exige https');

  await registrar(app, 'carrito_user');

  // Carrito de invitado -> inicia sesión -> el carrito se conserva y la sesión cambia.
  const invitado = crearCliente(app.base);
  await invitado.pedir('POST', '/carrito', { form: { accion: 'agregar', id_planta: '1', cantidad: '2' } });
  const sidInvitado = invitado.cookie('ecoflora.sid');
  assert(Boolean(sidInvitado), 'el invitado tiene una sesión con su carrito');
  const antes = await invitado.pedir('GET', '/carrito');
  assert(antes.texto.includes('Monstera'), 'el carrito de invitado muestra la Monstera');
  const login = await invitado.pedir('POST', '/login', { form: { usuario: 'carrito_user', password: 'clave12345' }, ip: '10.7.0.1' });
  const sidNueva = invitado.cookie('ecoflora.sid');
  assert(login.status === 302 && sidNueva && sidNueva !== sidInvitado, 'al iniciar sesión el identificador de sesión CAMBIA (no hay fijación de sesión)');
  const despues = await invitado.pedir('GET', '/carrito');
  assert(despues.texto.includes('Monstera'), 'el carrito de invitado se conserva tras iniciar sesión');

  const viejo = crearCliente(app.base);
  viejo.ponerCookie('ecoflora.sid', sidInvitado);
  const conViejo = await viejo.pedir('GET', '/usuario/perfil');
  assert(conViejo.status === 302 && /^\/(\?|login)/.test(conViejo.location || '') && !/^\/usuario/.test(conViejo.location || ''), 'la cookie anterior al login ya no abre ninguna sesión');
  const conNueva = await invitado.pedir('GET', '/usuario/perfil');
  assert(conNueva.status === 200, 'la cookie nueva sí abre el perfil');

  // Logout: borra la sesión del servidor y la cookie del navegador.
  const sidAntesDeSalir = invitado.cookie('ecoflora.sid');
  const salir = await invitado.pedir('GET', '/logout');
  const borra = salir.setCookie.find((s) => s.startsWith('ecoflora.sid='));
  assert(salir.status === 302 && Boolean(borra) && /(Expires=Thu, 01 Jan 1970|Max-Age=0)/i.test(borra), 'al salir se borra la cookie ecoflora.sid');
  const reutilizada = crearCliente(app.base);
  reutilizada.ponerCookie('ecoflora.sid', sidAntesDeSalir);
  const trasSalir = await reutilizada.pedir('GET', '/usuario/perfil');
  assert(trasSalir.status === 302 && /^\/(\?|login)/.test(trasSalir.location || ''), 'la sesión anterior ya no sirve después de salir (se destruyó en el servidor)');
}

async function pruebaCsrf(app) {
  titulo('Parte 3: CSRF');

  const sinToken = crearCliente(app.base);
  const r1 = await sinToken.pedir('POST', '/login', { form: { usuario: 'admin', password: 'x' }, sinCsrf: true });
  assert(r1.status === 403 && r1.texto.includes('No pudimos confirmar'), 'un POST sin token se rechaza con 403 y una página amable');
  const r2 = await sinToken.pedir('POST', '/login', { form: { usuario: 'admin', password: 'x' }, csrf: 'token-falso', ip: '10.8.0.1' });
  assert(r2.status === 403, 'un token falso se rechaza (403)');
  const r3 = await sinToken.pedir('POST', '/login', { form: { usuario: 'admin', password: 'x' }, csrf: 'x'.repeat(500), ip: '10.8.0.1' });
  assert(r3.status === 403, 'un token de otro largo se rechaza sin romper nada (timingSafeEqual sobre hashes)');
  const r4 = await sinToken.pedir('POST', '/login', { form: { usuario: 'admin', password: 'x' }, ip: '10.8.0.1' });
  assert(r4.status === 401, 'con el token correcto el POST llega a la ruta (aquí: contraseña incorrecta, 401)');

  // JSON (rostro): el token va en el encabezado X-CSRF-Token.
  const j1 = await sinToken.pedir('POST', '/login/rostro/comprobar', { json: { usuario: 'admin' }, sinCsrf: true });
  assert(j1.status === 403 && j1.datos && j1.datos.codigo === 'csrf', 'un POST JSON del rostro sin X-CSRF-Token se rechaza (403, JSON)');
  const j2 = await sinToken.pedir('POST', '/login/rostro/comprobar', { json: { usuario: 'admin' } });
  assert(j2.status !== 403 && !(j2.datos && j2.datos.codigo === 'csrf'), `con el encabezado X-CSRF-Token el POST JSON del rostro pasa el control CSRF (llega a la ruta: estado ${j2.status})`);

  // El token de una sesión no sirve en otra.
  const a = crearCliente(app.base);
  const b = crearCliente(app.base);
  await a.pedir('GET', '/login');
  await b.pedir('GET', '/login');
  assert(a.token() && b.token() && a.token() !== b.token() && a.token().length >= 32, 'cada sesión tiene su propio token aleatorio (≥ 32 caracteres)');
  const cruzado = await b.pedir('POST', '/login', { form: { usuario: 'admin', password: 'x' }, csrf: a.token(), ip: '10.8.0.2' });
  assert(cruzado.status === 403, 'el token de otra sesión se rechaza');

  // Acciones que antes eran GET.
  const cliente = crearCliente(app.base);
  await cliente.pedir('POST', '/login', { form: { usuario: 'carrito_user', password: 'clave12345' }, ip: '10.8.1.1' });
  await cliente.pedir('POST', '/carrito', { form: { accion: 'agregar', id_planta: '1', cantidad: '1' } });
  await cliente.pedir('GET', '/carrito?eliminar=1');
  assert((await cliente.pedir('GET', '/carrito')).texto.includes('Monstera'), 'GET /carrito?eliminar=ID ya NO quita nada del carrito');
  const sinTokenQuitar = await cliente.pedir('POST', '/carrito/eliminar', { form: { id_planta: '1' }, sinCsrf: true });
  assert(sinTokenQuitar.status === 403 && (await cliente.pedir('GET', '/carrito')).texto.includes('Monstera'), 'POST /carrito/eliminar sin token se rechaza y no quita nada');
  await cliente.pedir('POST', '/carrito/eliminar', { form: { id_planta: '1' } });
  assert(!(await cliente.pedir('GET', '/carrito')).texto.includes('Monstera'), 'POST /carrito/eliminar con token sí quita la planta');

  const admin = crearCliente(app.base);
  await admin.pedir('POST', '/login', { form: { usuario: 'admin', password: CLAVE_ADMIN }, ip: '10.8.2.1' });
  await registrar(app, 'para_borrar');
  const lista = await admin.pedir('GET', '/admin/usuarios');
  const fila = lista.texto.split('</tr>').find((f) => f.includes('para_borrar'));
  const id = fila && (fila.match(/\/admin\/usuarios\/(\d+)\/editar/) || [])[1];
  assert(Boolean(id), 'se encuentra la cuenta "para_borrar" en el panel');
  const viejoGet = await admin.pedir('GET', `/admin/usuarios/${id}/eliminar`);
  assert(viejoGet.status === 404 && (await admin.pedir('GET', '/admin/usuarios')).texto.includes('para_borrar'), 'GET /admin/usuarios/:id/eliminar ya no existe ni borra nada');
  const sinTokenBorrar = await admin.pedir('POST', `/admin/usuarios/${id}/eliminar`, { form: {}, sinCsrf: true });
  assert(sinTokenBorrar.status === 403 && (await admin.pedir('GET', '/admin/usuarios')).texto.includes('para_borrar'), 'POST de eliminar usuario sin token se rechaza');
  await admin.pedir('POST', `/admin/usuarios/${id}/eliminar`, { form: {} });
  assert(!(await admin.pedir('GET', '/admin/usuarios')).texto.includes('para_borrar'), 'POST de eliminar usuario con token sí lo borra');

  const csrfJs = fs.readFileSync(path.join(raiz, 'src/csrf.js'), 'utf8');
  const rostroJs = fs.readFileSync(path.join(raiz, 'public/js/rostro.js'), 'utf8');
  assert(csrfJs.includes('crypto.timingSafeEqual') && csrfJs.includes('crypto.randomBytes'), 'el token usa crypto.randomBytes y se compara con crypto.timingSafeEqual');
  assert(rostroJs.includes('X-CSRF-Token'), 'el JavaScript del rostro manda el encabezado X-CSRF-Token');
}

async function pruebaPaginas(app) {
  titulo('Partes 3 y 4: todas las páginas (token en cada formulario POST, sin JavaScript en línea, CSP)');

  // Datos para que existan formularios en el panel (pedido, mensaje).
  const cliente = crearCliente(app.base);
  await cliente.pedir('POST', '/login', { form: { usuario: 'carrito_user', password: 'clave12345' }, ip: '10.9.1.1' });
  await cliente.pedir('POST', '/carrito', { form: { accion: 'agregar', id_planta: '1', cantidad: '1' } });
  await cliente.pedir('POST', '/carrito', { form: { accion: 'agregar', id_planta: '2', cantidad: '1' } });
  const pedido = await cliente.pedir('POST', '/confirmar-pedido', { form: { direccion: 'Calle 45 #12-30', ciudad: 'Bogotá', telefono: '3010000000', notas: '' } });
  assert(pedido.status === 302 || pedido.status === 200, `un cliente hace un pedido con el token (estado ${pedido.status})`);
  await cliente.pedir('POST', '/carrito', { form: { accion: 'agregar', id_planta: '3', cantidad: '1' } });
  const invitado = crearCliente(app.base);
  await invitado.pedir('POST', '/carrito', { form: { accion: 'agregar', id_planta: '4', cantidad: '1' } });
  const contacto = await invitado.pedir('POST', '/contacto', { form: { nombre: 'Visita', email: 'visita@ecoflora.test', telefono: '', asunto: 'Prueba', mensaje: 'Mensaje de prueba de seguridad' } });
  assert(contacto.status === 200 && /Mensaje enviado/.test(contacto.texto), 'el formulario de contacto funciona con su token');
  const admin = crearCliente(app.base);
  await admin.pedir('POST', '/login', { form: { usuario: 'admin', password: CLAVE_ADMIN }, ip: '10.9.2.1' });
  const lista = await admin.pedir('GET', '/admin/usuarios');
  const idCliente = (lista.texto.split('</tr>').find((f) => f.includes('carrito_user')) || '').match(/\/admin\/usuarios\/(\d+)\/editar/);

  const paginas = [
    [invitado, '/'], [invitado, '/catalogo'], [invitado, '/planta/1'], [invitado, '/login'], [invitado, '/registro'],
    [invitado, '/contacto'], [invitado, '/carrito'], [invitado, '/nosotros'], [invitado, '/privacidad'],
    [cliente, '/usuario'], [cliente, '/usuario/perfil'], [cliente, '/usuario/domicilios'], [cliente, '/usuario/historial'],
    [cliente, '/carrito'], [cliente, '/confirmar-pedido'], [cliente, '/rostro'],
    [admin, '/admin'], [admin, '/admin/usuarios'], [admin, `/admin/usuarios/${idCliente ? idCliente[1] : 1}/editar`],
    [admin, '/admin/pedidos'], [admin, '/admin/mensajes'], [admin, '/admin/inventario']
  ];
  let totalFormularios = 0;
  const problemas = [];
  for (const [quien, ruta] of paginas) {
    const r = await quien.pedir('GET', ruta);
    if (r.status !== 200) { problemas.push(`${ruta}: estado ${r.status}`); continue; }
    formulariosPost(r.texto).forEach((f) => {
      totalFormularios += 1;
      if (!/name="_csrf"\s+value="[^"]+"/.test(f.cuerpo)) problemas.push(`${ruta}: formulario POST sin _csrf (${f.etiqueta.trim().slice(0, 80)})`);
    });
    if (/\son[a-z]+\s*=\s*["']/i.test(r.texto.replace(/<script[\s\S]*?<\/script>/gi, ''))) problemas.push(`${ruta}: tiene un manejador en línea (onclick, onsubmit, onerror...)`);
    if (/(href|src|action)\s*=\s*["']\s*javascript:/i.test(r.texto)) problemas.push(`${ruta}: tiene un enlace javascript:`);
    const csp = r.cabeceras.get('content-security-policy') || '';
    const nonce = (csp.match(/'nonce-([^']+)'/) || [])[1];
    (r.texto.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) || []).forEach((etiqueta) => {
      if (!nonce || !etiqueta.includes(`nonce="${nonce}"`)) problemas.push(`${ruta}: script en línea sin el nonce de la CSP`);
    });
    if (ruta === '/rostro' && !/data-csrf="[^"]+"/.test(r.texto)) problemas.push('/rostro: la cámara no recibe el token (data-csrf)');
  }
  assert(problemas.length === 0, `${paginas.length} páginas revisadas: todos los formularios POST llevan _csrf, ninguna usa JavaScript en línea (${problemas.join(' | ') || 'sin problemas'})`);
  assert(totalFormularios >= 20, `se revisaron ${totalFormularios} formularios POST (no es una revisión vacía)`);

  const login = await invitado.pedir('GET', '/login');
  const h = login.cabeceras;
  const csp = h.get('content-security-policy') || '';
  assert(/default-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /form-action 'self'/.test(csp) && /base-uri 'self'/.test(csp), 'la CSP limita todo al propio sitio y prohíbe objetos y marcos');
  const scriptSrc = (csp.match(/script-src ([^;]+)/) || [])[1] || '';
  assert(/'nonce-/.test(scriptSrc) && !/unsafe-inline|unsafe-eval/.test(scriptSrc), 'script-src usa nonce y no permite unsafe-inline ni unsafe-eval');
  assert(/script-src-attr 'none'/.test(csp), 'script-src-attr está en none (sin onclick="" ni similares)');
  assert(/connect-src 'self'/.test(csp) && /img-src 'self' data:/.test(csp), 'fetch e imágenes solo al propio sitio');
  assert(!/upgrade-insecure-requests/.test(csp) && !h.get('strict-transport-security'), 'en desarrollo (http) NO se fuerza https ni HSTS');
  assert(h.get('x-content-type-options') === 'nosniff' && !h.get('x-powered-by') && /strict-origin/.test(h.get('referrer-policy') || ''), 'nosniff, sin X-Powered-By y Referrer-Policy estricta');
  assert(/camera=\(self\)/.test(h.get('permissions-policy') || ''), 'la cámara solo se permite al propio sitio (Permissions-Policy)');
}

async function pruebaContrasenas(app) {
  titulo('Parte 5: contraseñas');

  const corta = await registrar(app, 'clave_corta', '1234567');
  assert(corta.r.status === 200 && /al menos 8/i.test(corta.r.texto), 'el registro rechaza 7 caracteres y lo explica');
  const intento = await entrar(app, 'clave_corta', '1234567', '10.10.0.1');
  assert(intento.r.status === 401, 'la cuenta con clave corta no se creó');
  const justa = await registrar(app, 'clave_justa', '12345678');
  assert(justa.r.status === 302, 'el registro acepta exactamente 8 caracteres');

  const admin = crearCliente(app.base);
  await admin.pedir('POST', '/login', { form: { usuario: 'admin', password: CLAVE_ADMIN }, ip: '10.10.1.1' });
  const lista = await admin.pedir('GET', '/admin/usuarios');
  const id = ((lista.texto.split('</tr>').find((f) => f.includes('clave_justa')) || '').match(/\/admin\/usuarios\/(\d+)\/editar/) || [])[1];
  assert(Boolean(id), 'se encuentra la cuenta "clave_justa" en el panel');
  const datos = { nombre: 'Prueba clave_justa', usuario: 'clave_justa', email: 'clave_justa@ecoflora.test', telefono: '3000000000', direccion: 'Calle 1', ciudad: 'Bogotá', rol: 'cliente' };
  const edicionCorta = await admin.pedir('POST', `/admin/usuarios/${id}`, { form: { ...datos, password: '1234567' } });
  assert(edicionCorta.status === 302 && /error=/.test(edicionCorta.location) && /8/.test(decodeURIComponent(edicionCorta.location)), 'el admin no puede poner una contraseña de 7 caracteres');
  assert((await entrar(app, 'clave_justa', '12345678', '10.10.2.1')).r.status === 302, 'y la contraseña anterior sigue funcionando');
  const edicionBuena = await admin.pedir('POST', `/admin/usuarios/${id}`, { form: { ...datos, password: 'nueva-clave-9' } });
  assert(edicionBuena.status === 302 && /actualizado=1/.test(edicionBuena.location), 'con 8 o más caracteres la edición del admin se guarda');
  assert((await entrar(app, 'clave_justa', 'nueva-clave-9', '10.10.3.1')).r.status === 302 && (await entrar(app, 'clave_justa', '12345678', '10.10.3.2')).r.status === 401, 'la contraseña nueva entra y la vieja ya no');
  const sinCambio = await admin.pedir('POST', `/admin/usuarios/${id}`, { form: { ...datos, ciudad: 'Cali', password: '' } });
  assert(sinCambio.status === 302 && /actualizado=1/.test(sinCambio.location) && (await entrar(app, 'clave_justa', 'nueva-clave-9', '10.10.4.1')).r.status === 302, 'dejar la contraseña vacía en la edición la mantiene');

  const readme = fs.readFileSync(path.join(raiz, 'README.txt'), 'utf8');
  assert(!/Admin123/.test(readme) && /ADMIN_INITIAL_PASSWORD/.test(readme), 'el README ya no trae la contraseña del admin y explica ADMIN_INITIAL_PASSWORD');
  const ejemplo = fs.readFileSync(path.join(raiz, '.env.example'), 'utf8');
  assert(/ADMIN_INITIAL_PASSWORD/.test(ejemplo) && !/Admin123/.test(ejemplo), '.env.example documenta ADMIN_INITIAL_PASSWORD sin contraseñas reales');
  const render = fs.readFileSync(path.join(raiz, 'render.yaml'), 'utf8');
  assert(/ADMIN_INITIAL_PASSWORD[\s\S]{0,40}sync:\s*false/.test(render) && !/Admin123/.test(render), 'render.yaml pide ADMIN_INITIAL_PASSWORD sin incluir el valor (sync: false)');
  let rastreados = '';
  try { rastreados = execFileSync('git', ['ls-files'], { cwd: raiz, encoding: 'utf8' }); } catch (error) { rastreados = ''; }
  assert(!/(^|\/)\.env$/m.test(rastreados), 'ningún archivo .env está en el repositorio');
}

async function pruebaLimites(app) {
  titulo('Parte 6: tamaño de lo que se recibe');

  const c = crearCliente(app.base);
  const grande = await c.pedir('POST', '/contacto', { form: { nombre: 'x', email: 'x@y.co', mensaje: 'a'.repeat(30 * 1024) } });
  assert(grande.status === 413, 'un formulario de más de 20 KB se rechaza con 413');
  assert((await c.pedir('GET', '/health')).status === 200, 'la app sigue sana después');
  const json = await c.pedir('POST', '/login/rostro/comprobar', { json: { usuario: 'a'.repeat(40 * 1024) } });
  assert(json.status === 400 || json.status === 413, `un JSON del rostro de más de 32 KB se rechaza (estado ${json.status})`);
  assert(json.datos && json.datos.ok === false, 'y la respuesta es un JSON ordenado');
  const muchos = await c.pedir('POST', '/contacto', { form: Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['campo' + i, 'x'])) });
  assert(muchos.status === 413 || muchos.status === 400, `más de 200 campos en un formulario se rechaza (estado ${muchos.status})`);
}

async function pruebaProduccion() {
  titulo('Partes 2, 4 y 5 en producción (NODE_ENV=production)');

  // Sin SESSION_SECRET (o con un valor de ejemplo) el servidor NO arranca.
  const casos = [['sin SESSION_SECRET', ''], ['con el valor de desarrollo', 'ecoflora-dev-secret'], ['con el valor de .env.example', 'cambia-esto-en-produccion']];
  for (const [nombre, secreto] of casos) {
    const app = lanzar({ puerto: PUERTO + 1, uri: nuevaBase('sinsecreto'), env: { NODE_ENV: 'production', SESSION_SECRET: secreto } });
    const salida = await esperarSalida(app);
    await app.detener();
    assert(typeof salida === 'number' && salida !== 0 && /SESSION_SECRET/.test(app.log()), `en producción ${nombre} el servidor no arranca y explica por qué`);
  }

  // Base nueva en producción, sin ADMIN_INITIAL_PASSWORD: contraseña aleatoria, mostrada una sola vez.
  const uri = nuevaBase('prod');
  const entornoProd = { NODE_ENV: 'production', SESSION_SECRET: SECRETO };
  let app = lanzar({ puerto: PUERTO + 1, uri, env: entornoProd });
  await app.listo();
  const banner = app.log().match(/ALEATORIA:\s*\n\s*\n\s+(\S+)/);
  assert(Boolean(banner) && banner[1].length >= 12, 'sin ADMIN_INITIAL_PASSWORD se crea el admin con una contraseña aleatoria y se muestra en el log');
  const claveAleatoria = banner[1];
  assert(!/ATENCIÓN DE SEGURIDAD/.test(app.log()), 'y no sale la advertencia de contraseña de fábrica');
  const https = { 'X-Forwarded-Proto': 'https' }; // Render entrega el tráfico por https y avisa con este encabezado
  const web = crearCliente(app.base, https);
  const pagina = await web.pedir('GET', '/login');
  const h = pagina.cabeceras;
  assert(/max-age=15552000/.test(h.get('strict-transport-security') || ''), 'en producción se envía HSTS (max-age de 180 días)');
  assert(/upgrade-insecure-requests/.test(h.get('content-security-policy') || ''), 'en producción la CSP pide subir las peticiones a https');
  assert(pagina.setCookie.some((s) => s.startsWith('ecoflora.sid=') && /;\s*Secure/i.test(s) && /HttpOnly/i.test(s)), 'en producción la cookie de sesión es Secure y HttpOnly');
  const mala = await crearCliente(app.base, https).pedir('POST', '/login', { form: { usuario: 'admin', password: 'Admin123' }, ip: '10.20.0.1' });
  assert(mala.status === 401, 'Admin123 no entra en la base nueva de producción');
  const buena = await crearCliente(app.base, https).pedir('POST', '/login', { form: { usuario: 'admin', password: claveAleatoria }, ip: '10.20.0.2' });
  assert(buena.status === 302 && buena.location === '/admin', 'la contraseña aleatoria del log sí entra al panel');
  await app.detener();

  // Al reiniciar, no se vuelve a mostrar la contraseña.
  app = lanzar({ puerto: PUERTO + 1, uri, env: entornoProd });
  await app.listo();
  assert(!app.log().includes(claveAleatoria) && !/ALEATORIA/.test(app.log()), 'al reiniciar la contraseña NO se vuelve a mostrar');
  await app.detener();

  // ADMIN_INITIAL_PASSWORD manda sobre la aleatoria.
  const uriVariable = nuevaBase('prodvar');
  app = lanzar({ puerto: PUERTO + 1, uri: uriVariable, env: { ...entornoProd, ADMIN_INITIAL_PASSWORD: 'MiClaveDeProd-77' } });
  await app.listo();
  assert(!/ALEATORIA/.test(app.log()), 'con ADMIN_INITIAL_PASSWORD no se genera ninguna contraseña aleatoria');
  assert((await crearCliente(app.base, https).pedir('POST', '/login', { form: { usuario: 'admin', password: 'MiClaveDeProd-77' }, ip: '10.20.1.1' })).status === 302, 'el admin entra con la contraseña de ADMIN_INITIAL_PASSWORD');
  await app.detener();

  // Una base que ya tiene al admin con Admin123 (como la de producción actual): advertencia clara al arrancar.
  const uriVieja = nuevaBase('vieja');
  let dev = lanzar({ puerto: PUERTO + 1, uri: uriVieja, env: { NODE_ENV: 'development', SESSION_SECRET: SECRETO } });
  await dev.listo();
  const loginViejo = await crearCliente(dev.base).pedir('POST', '/login', { form: { usuario: 'admin', password: 'Admin123' } });
  assert(loginViejo.status === 302, 'en tu computador (desarrollo) el admin nace con la contraseña de fábrica Admin123');
  await dev.detener();
  app = lanzar({ puerto: PUERTO + 1, uri: uriVieja, env: entornoProd });
  await app.listo();
  assert(/ATENCIÓN DE SEGURIDAD/.test(app.log()) && /Admin123/.test(app.log()), 'en producción, si el admin sigue con Admin123, el log lo advierte con claridad');
  const admin = crearCliente(app.base, https);
  assert((await admin.pedir('POST', '/login', { form: { usuario: 'admin', password: 'Admin123' }, ip: '10.20.2.1' })).status === 302, 'sigue entrando con Admin123 (hasta que la cambies)');
  const lista = await admin.pedir('GET', '/admin/usuarios');
  const idAdmin = ((lista.texto.split('</tr>').find((f) => f.includes('>admin<')) || '').match(/\/admin\/usuarios\/(\d+)\/editar/) || [])[1];
  assert(Boolean(idAdmin), 'se encuentra al admin en Gestionar Usuarios');
  const cambio = await admin.pedir('POST', `/admin/usuarios/${idAdmin}`, { form: { nombre: 'Administrador EcoFlora', usuario: 'admin', email: 'admin@ecoflora.com', telefono: '3000000000', direccion: 'Calle Principal 123', ciudad: 'Bogotá', rol: 'admin', password: 'ClaveNuevaSegura-2026' } });
  assert(cambio.status === 302 && /actualizado=1/.test(cambio.location), 'se cambia la contraseña del admin desde Gestionar Usuarios > Editar');
  await app.detener();
  app = lanzar({ puerto: PUERTO + 1, uri: uriVieja, env: entornoProd });
  await app.listo();
  assert(!/ATENCIÓN DE SEGURIDAD/.test(app.log()), 'tras cambiarla, la advertencia desaparece al reiniciar');
  assert((await crearCliente(app.base, https).pedir('POST', '/login', { form: { usuario: 'admin', password: 'Admin123' }, ip: '10.20.3.1' })).status === 401, 'y Admin123 ya no entra');
  assert((await crearCliente(app.base, https).pedir('POST', '/login', { form: { usuario: 'admin', password: 'ClaveNuevaSegura-2026' }, ip: '10.20.3.2' })).status === 302, 'la nueva contraseña sí entra');
  await app.detener();
}

// ---------- Programa principal ----------

async function limpiar() {
  for (const proceso of procesos) { try { proceso.kill('SIGKILL'); } catch (error) { /* ya cerrado */ } }
  if (!basesCreadas.length) return;
  try {
    const mongoose = require('mongoose');
    for (const nombre of basesCreadas) {
      const conexion = await mongoose.createConnection(uriDeBase(nombre)).asPromise();
      await conexion.dropDatabase();
      await conexion.close();
    }
  } catch (error) {
    console.warn('No se pudieron borrar las bases temporales:', basesCreadas.join(', '), error.message);
  }
}

async function main() {
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(uriBase)) {
    console.error('Por seguridad este script solo corre contra MongoDB local (MONGODB_URI=mongodb://127.0.0.1:...).');
    process.exitCode = 1;
    return;
  }
  let app = null;
  try {
    app = lanzar({
      puerto: PUERTO,
      uri: nuevaBase('dev'),
      env: { NODE_ENV: 'development', SESSION_SECRET: SECRETO, ADMIN_INITIAL_PASSWORD: CLAVE_ADMIN, FACE_ENCRYPTION_KEY: 'clave-local-de-prueba-0123456789abcdef' }
    });
    await app.listo();
    await pruebaLogin(app);
    await pruebaSesion(app);
    await pruebaCsrf(app);
    await pruebaPaginas(app);
    await pruebaContrasenas(app);
    await pruebaLimites(app);
    await app.detener();
    await pruebaProduccion();
    console.log(`\nTodo bien: ${comprobaciones} comprobaciones de seguridad pasaron.`);
  } catch (error) {
    console.error('\nFALLO:', error.message);
    process.exitCode = 1;
  } finally {
    await limpiar();
  }
}

main();
