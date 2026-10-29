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
// La app debe haberse encendido con las MISMAS variables FACE_ENCRYPTION_KEY y MONGODB_URI.

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

async function activarRostro(cliente, persona, semilla) {
  const aut = await cliente.pedir('POST', '/rostro/autorizar', { json: { clave: 'clave12345', consentimiento: true } });
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

async function main() {
  const uri = process.env.MONGODB_URI || '';
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(uri)) {
    console.error('Por seguridad este script solo corre contra una base local (MONGODB_URI=mongodb://127.0.0.1:...).');
    process.exit(1);
  }
  await connect(uri);
  await Usuario.deleteMany({ usuario: /^rostro_/ });
  await RostroUsuario.deleteMany({});

  await parte2();

  console.log('\nTodo bien: el servidor del rostro funciona como se espera.');
  await disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
