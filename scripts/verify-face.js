// Comprueba el servidor del inicio de sesión con rostro usando descriptores SINTÉTICOS
// (números inventados): no necesita cámara ni caras reales.
//
// Qué NO puede comprobar: que la cámara reconozca tu cara de verdad ni que la prueba de vida
// (parpadeo o giro) funcione con una persona. Eso solo se valida abriendo el sitio con tu cámara.
//
// Uso (solo con una base LOCAL de pruebas, nunca con la de producción), con la app encendida:
//   FACE_ENCRYPTION_KEY="clave-de-prueba-local-0123456789abcdef" \
//   MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora_rostro \
//   BASE_URL=http://127.0.0.1:3000 node scripts/verify-face.js
// La app debe haberse encendido con las MISMAS variables FACE_ENCRYPTION_KEY y MONGODB_URI, y con
// FACE_MATCH_THRESHOLD=0.5 (o sin definir) y sin FACE_MATCH_THRESHOLD_ADMIN, porque las pruebas
// del umbral dan por hecho 0.5 para clientes y 0.45 para el admin.
// Los límites de intentos viven en la memoria de la app: para repetir el script apaga y enciende la app.

const { connect, disconnect } = require('../src/db');
const { RostroUsuario, Usuario } = require('../src/models');
const rostro = require('../src/rostro');

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';

function assert(condition, message) {
  if (!condition) {
    console.error('FALLO:', message);
    process.exit(1);
  }
  console.log('ok', message);
}

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// ---------- Cliente HTTP con cookies ----------

function crearCliente() {
  const jar = new Map();
  async function pedir(metodo, ruta, { json, form, ip, crudo } = {}) {
    const headers = { Accept: json !== undefined || crudo !== undefined ? 'application/json' : 'text/html' };
    const cookie = [...jar.entries()].map(([nombre, valor]) => `${nombre}=${valor}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    if (ip) headers['X-Forwarded-For'] = ip;
    let cuerpo;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(json);
    } else if (crudo !== undefined) {
      headers['Content-Type'] = 'application/json';
      cuerpo = crudo;
    } else if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      cuerpo = new URLSearchParams(form).toString();
    }
    const respuesta = await fetch(base + ruta, { method: metodo, headers, body: cuerpo, redirect: 'manual' });
    (respuesta.headers.getSetCookie ? respuesta.headers.getSetCookie() : []).forEach((entrada) => {
      const [par] = entrada.split(';');
      const i = par.indexOf('=');
      const nombre = par.slice(0, i).trim();
      const valor = par.slice(i + 1).trim();
      if (!valor) jar.delete(nombre);
      else jar.set(nombre, valor);
    });
    const texto = await respuesta.text();
    let datos = null;
    try { datos = JSON.parse(texto); } catch (error) { datos = null; }
    return { status: respuesta.status, texto, datos, location: respuesta.headers.get('location') };
  }
  return { pedir };
}

// ---------- Descriptores sintéticos ----------

// Generador pseudoaleatorio con semilla: cada "persona" siempre tiene el mismo rostro inventado.
function aleatorio(semilla) {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(azar) {
  return Math.sqrt(-2 * Math.log(azar() || 1e-9)) * Math.cos(2 * Math.PI * azar());
}

// Un "rostro base" con norma 1.2, parecida a la de face-api.
function personaSintetica(semilla) {
  const azar = aleatorio(semilla);
  const v = Array.from({ length: 128 }, () => gauss(azar));
  const norma = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => (x / norma) * 1.2);
}

// Una captura de esa persona: el rostro base más un poco de ruido; "ruido" es la distancia aproximada.
function captura(persona, semilla, ruido = 0.12) {
  const azar = aleatorio(semilla);
  const r = Array.from({ length: 128 }, () => gauss(azar));
  const norma = Math.sqrt(r.reduce((s, x) => s + x * x, 0));
  return persona.map((x, i) => Number((x + (r[i] / norma) * ruido).toFixed(6)));
}

// ---------- Pasos de ayuda ----------

async function crearCuenta(nombreUsuario) {
  const cliente = crearCliente();
  const registro = await cliente.pedir('POST', '/registro', {
    form: {
      nombre: `Prueba ${nombreUsuario}`,
      usuario: nombreUsuario,
      email: `${nombreUsuario}@ecoflora.test`,
      telefono: '3000000000',
      direccion: 'Calle 1',
      ciudad: 'Bogotá',
      password: 'clave12345',
      confirmar: 'clave12345'
    }
  });
  return { cliente, registro };
}

async function activarRostro(cliente, persona, semilla, clave = 'clave12345') {
  const aut = await cliente.pedir('POST', '/rostro/autorizar', { json: { clave, consentimiento: true } });
  if (!aut.datos || !aut.datos.ok) return aut;
  const desafio = await cliente.pedir('POST', '/rostro/desafio', { json: {} });
  await dormir(1150);
  return cliente.pedir('POST', '/rostro/registro', {
    json: {
      desafio: desafio.datos.desafio.nonce,
      descriptores: [captura(persona, semilla), captura(persona, semilla + 1), captura(persona, semilla + 2), captura(persona, semilla + 3)]
    }
  });
}

async function parte2() {
  console.log('\n== Parte 2: registro del rostro ==');
  assert(rostro.disponible(), 'FACE_ENCRYPTION_KEY está configurada en este script');

  const anonimo = crearCliente();
  const sinSesion = await anonimo.pedir('GET', '/rostro');
  assert(sinSesion.status === 302 && sinSesion.location.endsWith('/login'), '/rostro pide iniciar sesión');
  const sinSesionApi = await anonimo.pedir('POST', '/rostro/autorizar', { json: { clave: 'x', consentimiento: true } });
  assert(sinSesionApi.status === 401, 'autorizar sin sesión responde 401');
  const privacidad = await anonimo.pedir('GET', '/privacidad');
  assert(privacidad.status === 200 && privacidad.texto.includes('Ley 1581'), 'la política de datos es pública');

  // Cuenta nueva: queda dentro y va directo a activar el rostro.
  const { cliente, registro } = await crearCuenta('rostro_uno');
  assert(registro.status === 302 && registro.location === '/rostro?bienvenida=1', 'crear cuenta lleva a activar el rostro');
  const pagina = await cliente.pedir('GET', '/rostro?bienvenida=1');
  assert(pagina.status === 200 && pagina.texto.includes('Omitir por ahora'), 'la bienvenida permite omitir el paso');
  assert(pagina.texto.includes('Ley 1581') && pagina.texto.includes('data-rostro-consentimiento'), 'se muestra la autorización de la Ley 1581');

  // Sin autorización no se puede nada.
  const sinAut = await cliente.pedir('POST', '/rostro/desafio', { json: {} });
  assert(sinAut.status === 403 && sinAut.datos.codigo === 'sin_autorizacion', 'sin autorización no se entrega el reto');
  const sinAutRegistro = await cliente.pedir('POST', '/rostro/registro', { json: { desafio: 'x', descriptores: [] } });
  assert(sinAutRegistro.status === 403, 'sin autorización no se guarda nada');

  const sinConsentimiento = await cliente.pedir('POST', '/rostro/autorizar', { json: { clave: 'clave12345', consentimiento: false } });
  assert(sinConsentimiento.status === 400 && sinConsentimiento.datos.codigo === 'sin_consentimiento', 'el consentimiento es obligatorio');
  const claveMala = await cliente.pedir('POST', '/rostro/autorizar', { json: { clave: 'incorrecta', consentimiento: true } });
  assert(claveMala.status === 403 && claveMala.datos.codigo === 'clave_incorrecta', 'se exige la contraseña correcta');
  const jsonRoto = await cliente.pedir('POST', '/rostro/autorizar', { crudo: '{esto no es json' });
  assert(jsonRoto.status === 400 && jsonRoto.datos && jsonRoto.datos.ok === false, 'un JSON dañado se responde con un error claro');
  const bien = await cliente.pedir('POST', '/rostro/autorizar', { json: { clave: 'clave12345', consentimiento: true } });
  assert(bien.status === 200 && bien.datos.ok, 'con consentimiento y contraseña se autoriza');

  const persona = personaSintetica(101);

  // Reto de un solo uso.
  const d1 = await cliente.pedir('POST', '/rostro/desafio', { json: {} });
  assert(d1.status === 200 && rostro.ACCIONES.includes(d1.datos.desafio.accion) && d1.datos.desafio.nonce.length === 32, 'el servidor entrega un reto aleatorio');
  const rapido = await cliente.pedir('POST', '/rostro/registro', { json: { desafio: d1.datos.desafio.nonce, descriptores: [captura(persona, 1), captura(persona, 2), captura(persona, 3)] } });
  assert(rapido.status === 400 && rapido.datos.codigo === 'desafio_muy_rapido', 'un reto resuelto al instante se rechaza');
  const reuso = await cliente.pedir('POST', '/rostro/registro', { json: { desafio: d1.datos.desafio.nonce, descriptores: [captura(persona, 1), captura(persona, 2), captura(persona, 3)] } });
  assert(reuso.status === 400 && reuso.datos.codigo === 'desafio_sin_desafio', 'el reto se gasta aunque falle (no se reutiliza)');

  const d2 = await cliente.pedir('POST', '/rostro/desafio', { json: {} });
  await dormir(1150);
  const pocos = await cliente.pedir('POST', '/rostro/registro', { json: { desafio: d2.datos.desafio.nonce, descriptores: [captura(persona, 1), captura(persona, 2)] } });
  assert(pocos.status === 400 && pocos.datos.codigo === 'descriptor_invalido', 'se exigen al menos 3 capturas');

  const d3 = await cliente.pedir('POST', '/rostro/desafio', { json: {} });
  await dormir(1150);
  const malos = await cliente.pedir('POST', '/rostro/registro', { json: { desafio: d3.datos.desafio.nonce, descriptores: [new Array(128).fill(0), captura(persona, 2), captura(persona, 3)] } });
  assert(malos.status === 400 && malos.datos.codigo === 'descriptor_invalido', 'un descriptor de ceros se rechaza');

  const d4 = await cliente.pedir('POST', '/rostro/desafio', { json: {} });
  await dormir(1150);
  const distintas = await cliente.pedir('POST', '/rostro/registro', { json: { desafio: d4.datos.desafio.nonce, descriptores: [captura(persona, 1), captura(personaSintetica(999), 2), captura(persona, 3)] } });
  assert(distintas.status === 422 && distintas.datos.codigo === 'captura_inestable', 'capturas de personas distintas se rechazan');
  assert((await RostroUsuario.countDocuments({ id_usuario: (await Usuario.findOne({ usuario: 'rostro_uno' })).id_usuario })) === 0, 'nada se guardó con capturas inválidas');

  const d5 = await cliente.pedir('POST', '/rostro/desafio', { json: {} });
  await dormir(1150);
  const capturas = [captura(persona, 11), captura(persona, 12), captura(persona, 13), captura(persona, 14)];
  const guardado = await cliente.pedir('POST', '/rostro/registro', { json: { desafio: d5.datos.desafio.nonce, descriptores: capturas } });
  assert(guardado.status === 200 && guardado.datos.ok, 'el rostro válido se guarda');

  // Lo guardado está cifrado y no hay fotos.
  const usuario = await Usuario.findOne({ usuario: 'rostro_uno' });
  const doc = await RostroUsuario.findOne({ id_usuario: usuario.id_usuario }).lean();
  assert(doc && doc.descriptores.length === 4, 'se guardaron 4 descriptores');
  assert(doc.descriptores.every((texto) => texto.startsWith('v1.')), 'cada descriptor se guarda cifrado (AES-256-GCM)');
  const crudo = JSON.stringify(doc);
  assert(!crudo.includes(String(capturas[0][0])) && !crudo.includes(String(capturas[0][1])), 'en la base no aparecen los números del rostro en claro');
  assert(doc.consentimiento_version === rostro.VERSION_CONSENTIMIENTO && doc.consentimiento_fecha, 'queda registrada la fecha y versión de la autorización');
  const claves = Object.keys(doc).filter((k) => !['_id', '__v'].includes(k)).sort();
  assert(!claves.some((k) => /foto|imagen|image|photo/i.test(k)), 'el documento no tiene ningún campo de foto o imagen');
  const abierto = rostro.descifrar(doc.descriptores[0]);
  assert(abierto && rostro.distancia(abierto, capturas[0]) < 1e-5, 'descifrar devuelve el mismo descriptor');
  const manipulado = doc.descriptores[0].slice(0, -4) + 'AAAA';
  assert(rostro.descifrar(manipulado) === null, 'un descriptor manipulado no se puede descifrar');

  const despues = await cliente.pedir('GET', '/rostro');
  assert(despues.status === 200 && despues.texto.includes('Activado desde'), 'la página muestra que el rostro está activado');
  const perfil = await cliente.pedir('GET', '/usuario/perfil');
  assert(perfil.texto.includes('Inicio de sesión con rostro') && perfil.texto.includes('Activado. Tu contraseña'), 'el perfil muestra el estado');

  // Autorización de un solo uso: no se puede registrar de nuevo sin volver a confirmar.
  const d6 = await cliente.pedir('POST', '/rostro/desafio', { json: {} });
  assert(d6.status === 403, 'tras guardar hay que volver a autorizar para cambiar el rostro');

  return { persona, cliente, usuario };
}

// Intenta entrar con un descriptor. Pide el reto, espera lo mínimo y envía.
async function loginRostro(usuario, descriptor, { ip, cliente = crearCliente(), esperar = 1150 } = {}) {
  const d = await cliente.pedir('POST', '/login/rostro/desafio', { json: { usuario }, ip });
  if (!d.datos || !d.datos.ok) return { cliente, desafio: d, respuesta: d };
  await dormir(esperar);
  const respuesta = await cliente.pedir('POST', '/login/rostro', { json: { usuario, desafio: d.datos.desafio.nonce, descriptor }, ip });
  return { cliente, desafio: d, respuesta };
}

// Busca una captura que quede a la distancia pedida de lo guardado (para probar el umbral con precisión).
function capturaADistancia(persona, guardados, objetivo, semilla0 = 5000) {
  for (let i = 0; i < 200; i += 1) {
    const candidata = captura(persona, semilla0 + i, objetivo);
    const d = rostro.mejorDistancia(candidata, guardados);
    if (Math.abs(d - objetivo) < 0.006) return { candidata, d };
  }
  throw new Error('no se encontró una captura a la distancia pedida');
}

async function guardadosDe(idUsuario) {
  const doc = await RostroUsuario.findOne({ id_usuario: idUsuario }).lean();
  return doc.descriptores.map(rostro.descifrar);
}

async function parte3({ persona, usuario }) {
  console.log('\n== Parte 3: iniciar sesión con rostro ==');

  // --- Cuentas de prueba ---
  await crearCuenta('rostro_dos');
  const tres = await crearCuenta('rostro_tres');
  const personaTres = personaSintetica(303);
  assert((await activarRostro(tres.cliente, personaTres, 31)).status === 200, 'segunda cuenta con rostro distinto lista');

  // --- Reto de login ---
  const ok = await loginRostro('rostro_uno', captura(persona, 71));
  assert(ok.desafio.status === 200 && ok.desafio.datos.desafio.nonce.length === 32, 'se entrega un reto sin necesidad de sesión');
  assert(ok.respuesta.status === 200 && ok.respuesta.datos.ok && ok.respuesta.datos.destino === '/', 'la misma persona entra con su rostro');
  const perfil = await ok.cliente.pedir('GET', '/usuario/perfil');
  assert(perfil.status === 200 && perfil.texto.includes('rostro_uno@ecoflora.test'), 'la sesión queda abierta igual que con la contraseña');
  const doc = await RostroUsuario.findOne({ id_usuario: usuario.id_usuario }).lean();
  assert(doc.ultimo_uso instanceof Date, 'se anota la fecha del último uso');

  const porCorreo = await loginRostro('ROSTRO_UNO@ecoflora.test', captura(persona, 72));
  assert(porCorreo.respuesta.status === 200, 'también sirve el correo, sin importar mayúsculas');

  // --- Otra persona ---
  const intruso = await loginRostro('rostro_uno', captura(personaSintetica(202), 73));
  assert(intruso.respuesta.status === 401 && intruso.respuesta.datos.codigo === 'no_coincide', 'otra persona NO entra');
  assert((await intruso.cliente.pedir('GET', '/usuario/perfil')).status === 302, 'y no queda ninguna sesión abierta');
  assert(!JSON.stringify(intruso.respuesta.datos).match(/\d\.\d{3}/), 'la respuesta de rechazo no revela la distancia');

  // --- Cuentas que no existen o no tienen rostro: mismo mensaje ---
  const noExiste = await loginRostro('no_existe_para_nada', captura(persona, 74));
  const noTiene = await loginRostro('rostro_dos', captura(persona, 75));
  assert(noExiste.desafio.status === 404 && noTiene.desafio.status === 404, 'sin cuenta o sin rostro activo no hay reto');
  assert(JSON.stringify(noExiste.desafio.datos) === JSON.stringify(noTiene.desafio.datos), 'el mensaje es el mismo (no revela si la cuenta existe)');
  assert(/entra con tu contraseña/i.test(noTiene.desafio.datos.error), 'el mensaje invita a entrar con la contraseña');
  const compruebaSi = await crearCliente().pedir('POST', '/login/rostro/comprobar', { json: { usuario: 'rostro_uno' }, ip: '10.2.2.2' });
  const compruebaNo = await crearCliente().pedir('POST', '/login/rostro/comprobar', { json: { usuario: 'rostro_dos' }, ip: '10.2.2.2' });
  assert(compruebaSi.status === 200 && compruebaSi.datos.ok, 'comprobar confirma que la cuenta tiene rostro (antes de abrir la cámara)');
  assert(compruebaNo.status === 404 && JSON.stringify(compruebaNo.datos) === JSON.stringify(noTiene.desafio.datos), 'comprobar responde igual para cuentas sin rostro o inexistentes');
  const inyeccion = await crearCliente().pedir('POST', '/login/rostro/desafio', { json: { usuario: { $ne: '' } } });
  assert(inyeccion.status === 404, 'un usuario con forma de objeto (inyección) no funciona');
  const sinUsuario = await crearCliente().pedir('POST', '/login/rostro/desafio', { json: {} });
  assert(sinUsuario.status === 404, 'sin usuario no hay reto');

  // --- Retos ---
  const c1 = crearCliente();
  const d1 = await c1.pedir('POST', '/login/rostro/desafio', { json: { usuario: 'rostro_uno' } });
  const rapido = await c1.pedir('POST', '/login/rostro', { json: { usuario: 'rostro_uno', desafio: d1.datos.desafio.nonce, descriptor: captura(persona, 76) } });
  assert(rapido.status === 400 && rapido.datos.codigo === 'desafio_muy_rapido', 'resolver el reto al instante se rechaza');
  const reuso = await c1.pedir('POST', '/login/rostro', { json: { usuario: 'rostro_uno', desafio: d1.datos.desafio.nonce, descriptor: captura(persona, 77) } });
  assert(reuso.status === 400 && reuso.datos.codigo === 'desafio_sin_desafio', 'el reto se gasta aunque falle');
  const sinReto = await crearCliente().pedir('POST', '/login/rostro', { json: { usuario: 'rostro_uno', desafio: 'a'.repeat(32), descriptor: captura(persona, 78) } });
  assert(sinReto.status === 400 && sinReto.datos.codigo === 'desafio_sin_desafio', 'sin pedir reto no se puede entrar');
  const c2 = crearCliente();
  const d2 = await c2.pedir('POST', '/login/rostro/desafio', { json: { usuario: 'rostro_uno' } });
  await dormir(1150);
  const mal = await c2.pedir('POST', '/login/rostro', { json: { usuario: 'rostro_uno', desafio: d2.datos.desafio.nonce.replace(/./, (x) => (x === 'a' ? 'b' : 'a')), descriptor: captura(persona, 79) } });
  assert(mal.status === 400 && mal.datos.codigo === 'desafio_sin_desafio', 'un código de reto alterado se rechaza');
  const c3 = crearCliente();
  const d3 = await c3.pedir('POST', '/login/rostro/desafio', { json: { usuario: 'rostro_uno' } });
  await dormir(1150);
  const otraCuenta = await c3.pedir('POST', '/login/rostro', { json: { usuario: 'rostro_tres', desafio: d3.datos.desafio.nonce, descriptor: captura(personaTres, 80) } });
  assert(otraCuenta.status === 404, 'un reto pedido para una cuenta no sirve para otra');
  // (los intentos de aquí en adelante salen de otra IP para no chocar con el límite por IP)
  const basura = await loginRostro('rostro_uno', new Array(128).fill(0), { ip: '10.1.1.1' });
  assert(basura.respuesta.status === 400 && basura.respuesta.datos.codigo === 'descriptor_invalido', 'un descriptor inválido se rechaza');
  const corto = await loginRostro('rostro_uno', [0.1, 0.2], { ip: '10.1.1.1' });
  assert(corto.respuesta.status === 400, 'un descriptor de tamaño incorrecto se rechaza');

  // --- Umbral configurable y más estricto para el admin ---
  const guardadosUno = await guardadosDe(usuario.id_usuario);
  const cerca = capturaADistancia(persona, guardadosUno, 0.4);
  const lejos = capturaADistancia(persona, guardadosUno, 0.56, 6000);
  assert((await loginRostro('rostro_uno', cerca.candidata, { ip: '10.1.1.1' })).respuesta.status === 200, `a distancia ${cerca.d.toFixed(2)} (bajo el umbral 0.5) entra`);
  assert((await loginRostro('rostro_uno', lejos.candidata, { ip: '10.1.1.1' })).respuesta.status === 401, `a distancia ${lejos.d.toFixed(2)} (sobre el umbral 0.5) no entra`);

  // Admin: misma captura que a un cliente le sirve (0.48) pero al admin no (umbral 0.45).
  const admin = crearCliente();
  const entrarAdmin = await admin.pedir('POST', '/login', { form: { usuario: 'admin', password: 'Admin123' } });
  assert(entrarAdmin.status === 302, 'el admin entra con su contraseña');
  const personaAdmin = personaSintetica(404);
  const adminActivo = await activarRostro(admin, personaAdmin, 41, 'Admin123');
  assert(adminActivo.status === 200, 'el admin también puede activar su rostro');
  await admin.pedir('GET', '/logout');
  const idAdmin = (await Usuario.findOne({ usuario: 'admin' })).id_usuario;
  const guardadosAdmin = await guardadosDe(idAdmin);
  const casiAdmin = capturaADistancia(personaAdmin, guardadosAdmin, 0.48, 7000);
  assert(rostro.umbral('admin') < rostro.umbral('cliente'), 'el umbral del admin es más estricto que el de clientes');
  const adminRechazado = await loginRostro('admin', casiAdmin.candidata);
  assert(adminRechazado.respuesta.status === 401, `el admin NO entra con distancia ${casiAdmin.d.toFixed(2)} (que a un cliente sí le serviría)`);
  const adminEntra = await loginRostro('admin', captura(personaAdmin, 81));
  assert(adminEntra.respuesta.status === 200 && adminEntra.respuesta.datos.destino === '/admin', 'el admin entra con su rostro y va al panel');
  assert((await adminEntra.cliente.pedir('GET', '/admin')).status === 200, 'la sesión del admin da acceso al panel');
  // Con la distancia que al admin no le sirve, otra cuenta de cliente sí entra.
  const cuatro = await crearCuenta('rostro_cuatro');
  await activarRostro(cuatro.cliente, personaAdmin, 41);
  const guardadosCuatro = await guardadosDe((await Usuario.findOne({ usuario: 'rostro_cuatro' })).id_usuario);
  const casiCliente = capturaADistancia(personaAdmin, guardadosCuatro, 0.48, 8000);
  assert((await loginRostro('rostro_cuatro', casiCliente.candidata)).respuesta.status === 200, 'la misma distancia 0.48 sí sirve para un cliente');

  // --- Carrito de invitado ---
  const invitado = crearCliente();
  await invitado.pedir('POST', '/carrito', { form: { accion: 'agregar', id_planta: '1', cantidad: '2' } });
  const conCarrito = await loginRostro('rostro_uno', captura(persona, 82), { cliente: invitado, ip: '10.1.1.1' });
  assert(conCarrito.respuesta.status === 200, 'un invitado con carrito entra con rostro');
  assert((await invitado.pedir('GET', '/carrito')).texto.includes('Monstera deliciosa'), 'el carrito de invitado pasa a su cuenta');

  // --- Rostro guardado que no se puede leer (por ejemplo, cambió la clave) ---
  const cinco = await crearCuenta('rostro_cinco');
  await activarRostro(cinco.cliente, personaSintetica(505), 51);
  const idCinco = (await Usuario.findOne({ usuario: 'rostro_cinco' })).id_usuario;
  await RostroUsuario.updateOne({ id_usuario: idCinco }, { $set: { descriptores: ['v1.aaaa.bbbb.cccc'] } });
  const ilegible = await loginRostro('rostro_cinco', captura(personaSintetica(505), 83));
  assert(ilegible.respuesta.status === 409 && ilegible.respuesta.datos.codigo === 'rostro_ilegible', 'si el rostro guardado no se puede leer se explica qué hacer');

  // --- Límite de intentos (la contraseña sigue funcionando) ---
  const seis = await crearCuenta('rostro_limite');
  await activarRostro(seis.cliente, personaSintetica(606), 61);
  const otraPersona = personaSintetica(707);
  const codigos = [];
  for (let i = 0; i < 7; i += 1) {
    codigos.push((await loginRostro('rostro_limite', captura(otraPersona, 90 + i), { ip: '10.0.0.1' })).respuesta.status);
  }
  assert(codigos.slice(0, 6).every((c) => c === 401) && codigos[6] === 429, `a los 6 intentos fallidos desde una IP se frena (códigos: ${codigos.join(', ')})`);
  const otraIp = [];
  for (let i = 0; i < 6; i += 1) {
    otraIp.push((await loginRostro('rostro_limite', captura(otraPersona, 100 + i), { ip: '10.0.0.2' })).respuesta.status);
  }
  assert(otraIp.every((c) => c === 401), `desde otra IP se puede intentar de nuevo (códigos: ${otraIp.join(', ')})`);
  const tercera = (await loginRostro('rostro_limite', captura(otraPersona, 120), { ip: '10.0.0.3' })).respuesta.status;
  assert(tercera === 429, `el tope por usuario (12) frena aunque la IP sea nueva (código: ${tercera})`);
  const contrasena = await crearCliente().pedir('POST', '/login', { form: { usuario: 'rostro_limite', password: 'clave12345' } });
  assert(contrasena.status === 302, 'con el rostro frenado, la contraseña SIGUE funcionando');
  const otroUsuario = await loginRostro('rostro_tres', captura(personaTres, 110), { ip: '10.0.0.1' });
  assert(otroUsuario.respuesta.status === 200, 'el freno de un usuario no afecta a otros desde la misma IP');

  // --- Borrar el rostro ---
  const borrar = await tres.cliente.pedir('POST', '/rostro/eliminar', {});
  assert(borrar.status === 302 && borrar.location === '/rostro?eliminado=1', 'desactivar borra el rostro');
  assert((await RostroUsuario.countDocuments({ id_usuario: (await Usuario.findOne({ usuario: 'rostro_tres' })).id_usuario })) === 0, 'ya no queda nada guardado de esa persona');
  const trasBorrar = await loginRostro('rostro_tres', captura(personaTres, 111));
  assert(trasBorrar.desafio.status === 404, 'tras borrarlo ya no se puede entrar con rostro');

  // --- El admin elimina una cuenta: se borra también su rostro ---
  const idCuatro = (await Usuario.findOne({ usuario: 'rostro_cuatro' })).id_usuario;
  const admin2 = crearCliente();
  await admin2.pedir('POST', '/login', { form: { usuario: 'admin', password: 'Admin123' } });
  await admin2.pedir('GET', `/admin/usuarios/${idCuatro}/eliminar`);
  assert((await Usuario.countDocuments({ id_usuario: idCuatro })) === 0, 'el admin eliminó la cuenta');
  assert((await RostroUsuario.countDocuments({ id_usuario: idCuatro })) === 0, 'y su rostro se borró con ella');

  // --- Configuración: umbral y clave ---
  const guardado = { clave: process.env.FACE_ENCRYPTION_KEY, umbral: process.env.FACE_MATCH_THRESHOLD, admin: process.env.FACE_MATCH_THRESHOLD_ADMIN };
  delete process.env.FACE_MATCH_THRESHOLD;
  delete process.env.FACE_MATCH_THRESHOLD_ADMIN;
  assert(rostro.umbral('cliente') === 0.5 && Math.abs(rostro.umbral('admin') - 0.45) < 1e-9, 'sin configurar: 0.5 para clientes y 0.45 para admin');
  process.env.FACE_MATCH_THRESHOLD = '0,42';
  assert(rostro.umbral('cliente') === 0.42, 'FACE_MATCH_THRESHOLD acepta coma decimal');
  process.env.FACE_MATCH_THRESHOLD = '0.95';
  assert(rostro.umbral('cliente') === 0.7, 'un umbral demasiado permisivo se limita a 0.7');
  process.env.FACE_MATCH_THRESHOLD = '0.05';
  assert(rostro.umbral('cliente') === 0.2, 'un umbral demasiado estricto se limita a 0.2');
  process.env.FACE_MATCH_THRESHOLD = 'abc';
  assert(rostro.umbral('cliente') === 0.5, 'un valor que no es número vuelve al 0.5');
  process.env.FACE_MATCH_THRESHOLD_ADMIN = '0.3';
  assert(rostro.umbral('admin') === 0.3, 'FACE_MATCH_THRESHOLD_ADMIN manda para el admin');
  process.env.FACE_ENCRYPTION_KEY = 'corta';
  assert(rostro.disponible() === false, 'una clave de menos de 16 caracteres deja la función apagada');
  let lanzo = false;
  try { rostro.cifrar(persona); } catch (error) { lanzo = true; }
  assert(lanzo, 'sin una clave válida NUNCA se guarda un rostro sin cifrar');
  delete process.env.FACE_ENCRYPTION_KEY;
  assert(rostro.disponible() === false, 'sin FACE_ENCRYPTION_KEY la función queda apagada');
  Object.entries({ FACE_ENCRYPTION_KEY: guardado.clave, FACE_MATCH_THRESHOLD: guardado.umbral, FACE_MATCH_THRESHOLD_ADMIN: guardado.admin })
    .forEach(([nombre, valor]) => { if (valor === undefined) delete process.env[nombre]; else process.env[nombre] = valor; });

  // El admin no debe quedar con rostro de prueba guardado.
  await RostroUsuario.deleteOne({ id_usuario: idAdmin });
  assert((await RostroUsuario.countDocuments({ id_usuario: idAdmin })) === 0, 'se limpió el rostro de prueba del admin');
}

async function main() {
  const uri = process.env.MONGODB_URI || '';
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(uri)) {
    console.error('Por seguridad este script solo corre contra una base local (MONGODB_URI=mongodb://127.0.0.1:...).');
    process.exit(1);
  }
  await connect(uri);
  await Usuario.deleteMany({ usuario: /^rostro_/ });
  await RostroUsuario.deleteMany({});

  const idAdminInicio = (await Usuario.findOne({ usuario: 'admin' }));
  if (idAdminInicio) await RostroUsuario.deleteOne({ id_usuario: idAdminInicio.id_usuario });
  const resultado = await parte2();
  await parte3(resultado);

  console.log('\nTodo bien: el servidor del rostro funciona como se espera.');
  await disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
