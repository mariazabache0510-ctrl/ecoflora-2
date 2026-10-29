// Prueba el inicio con rostro en un Chrome real (sin ventana) con una CÁMARA SIMULADA.
//
// La cámara simulada reproduce una foto fija de una persona (se recorta de las imágenes de ejemplo
// que trae la librería face-api en node_modules; nada de eso se guarda en el proyecto).
// Con eso se prueba de verdad: carga de modelos, detección del rostro, malla de puntos, captura
// de descriptores, envío al servidor, mensajes de error y diseño (escritorio y celular).
//
// Lo que NO se puede probar aquí: que TU cara sea reconocida ni que parpadear/girar funcione con
// una persona real. Una foto fija no parpadea, así que en el escenario "foto fija" la prueba de
// vida debe FALLAR (eso es lo correcto). En el escenario del registro exitoso se reemplaza
// la prueba de vida por una que se cumple sola, solo para poder seguir el flujo completo.
//
// Uso (con la app y MongoDB LOCALES de prueba encendidos, con FACE_ENCRYPTION_KEY puesta):
//   node scripts/verify-rostro-browser.js
// Variables opcionales: BASE_URL, CHROME_PATH, SHOTS_DIR, ESCENARIOS (ej. "exito,bloqueada").

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const salida = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ecoflora-rostro');
const trabajo = path.join(os.tmpdir(), 'ecoflora-rostro-camara');
const muestras = path.join(__dirname, '..', 'node_modules', '@vladmandic', 'face-api', 'demo', 'sample1.jpg');
const quieren = (process.env.ESCENARIOS || 'exito,foto_fija,bloqueada,sin_rostro,login_ok,login_otra_persona,login_sin_rostro').split(',');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
let navegadores = [];
const compartido = { usuarioConRostro: null };

function verifica(condicion, mensaje) {
  console.log((condicion ? 'ok    ' : 'FALLO ') + mensaje);
  if (!condicion) fallos += 1;
}

function cerrarTodo(codigo) {
  navegadores.forEach((n) => n.cerrar());
  process.exit(codigo);
}
setTimeout(() => { console.error('TIEMPO AGOTADO'); cerrarTodo(2); }, 420000);

// ---------- Cámara simulada: recorta una cara y la repite como video ----------

// recorte en la imagen original (1920x1280): lado, desplazamiento vertical y horizontal.
const PERSONAS = {
  a: { lado: 560, y: 48, x: 1295 },
  b: { lado: 560, y: 179, x: 226 }
};

function prepararCamara(persona) {
  fs.mkdirSync(trabajo, { recursive: true });
  const jpg = path.join(trabajo, `persona_${persona}.jpg`);
  const mjpeg = path.join(trabajo, `persona_${persona}.mjpeg`);
  if (!fs.existsSync(mjpeg)) {
    const c = PERSONAS[persona];
    execFileSync('sips', ['-c', String(c.lado), String(c.lado), '--cropOffset', String(c.y), String(c.x), muestras, '--out', jpg], { stdio: 'ignore' });
    const cuadro = fs.readFileSync(jpg);
    fs.writeFileSync(mjpeg, Buffer.concat(Array.from({ length: 30 }, () => cuadro)));
  }
  return mjpeg;
}

// ---------- Un Chrome controlado por el protocolo DevTools ----------

let siguientePuerto = 9420;
async function crearNavegador(nombre, { camara, bloquear } = {}) {
  const puerto = siguientePuerto++;
  const args = ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--remote-debugging-port=${puerto}`,
    '--user-data-dir=' + path.join(os.tmpdir(), `ecoflora-chrome-${nombre}-${Date.now()}`)];
  if (bloquear) {
    args.push('--deny-permission-prompts');
  } else {
    args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream');
    if (camara) args.push('--use-file-for-fake-video-capture=' + camara);
  }
  args.push('about:blank');
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  let ws = null;
  let contador = 0;
  const pendientes = new Map();
  const problemas = [];
  const n = { nombre, problemas, contexto: 'inicio' };

  n.cerrar = () => {
    try { if (ws) ws.close(); } catch (error) { /* ya cerrado */ }
    try { proc.kill(); } catch (error) { /* ya cerrado */ }
  };
  n.enviar = (metodo, params = {}) => new Promise((res, rej) => {
    const i = ++contador;
    const espera = setTimeout(() => { pendientes.delete(i); rej(new Error('sin respuesta de Chrome: ' + metodo)); }, 30000);
    pendientes.set(i, { res: (v) => { clearTimeout(espera); res(v); }, rej: (e) => { clearTimeout(espera); rej(e); } });
    ws.send(JSON.stringify({ id: i, method: metodo, params }));
  });

  let url = null;
  for (let i = 0; i < 80 && !url; i += 1) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
      const pagina = lista.find((x) => x.type === 'page');
      if (pagina) url = pagina.webSocketDebuggerUrl;
    } catch (error) { /* Chrome aún arranca */ }
    if (!url) await dormir(250);
  }
  if (!url) throw new Error('Chrome no arrancó');
  ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pendientes.has(m.id)) {
      const { res, rej } = pendientes.get(m.id);
      pendientes.delete(m.id);
      if (m.error) rej(new Error(m.error.message)); else res(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      problemas.push(`[${n.contexto}] excepción JS: ${(d.exception && d.exception.description) || d.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problemas.push(`[${n.contexto}] console.error: ${m.params.args.map((a) => a.value || a.description).join(' ')}`);
    } else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && !n.esperados.some((e) => m.params.response.url.includes(e))) {
      problemas.push(`[${n.contexto}] HTTP ${m.params.response.status} ${m.params.response.url}`);
    }
  });
  n.esperados = [];
  await n.enviar('Page.enable');
  await n.enviar('Runtime.enable');
  await n.enviar('Network.enable');

  n.evaluar = async (expresion) => {
    const r = await n.enviar('Runtime.evaluate', { expression: expresion, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result && r.result.value;
  };
  n.vista = async (w, h, movil) => {
    await n.enviar('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!movil });
    await n.enviar('Emulation.setTouchEmulationEnabled', { enabled: !!movil });
  };
  n.ir = async (ruta, espera = 1200) => {
    n.contexto = ruta;
    await n.enviar('Page.navigate', { url: base + ruta });
    for (let i = 0; i < 40; i += 1) {
      await dormir(150);
      if ((await n.evaluar('document.readyState').catch(() => '')) === 'complete') break;
    }
    await dormir(espera);
  };
  n.foto = async (nombreArchivo) => {
    fs.mkdirSync(salida, { recursive: true });
    const r = await n.enviar('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    fs.writeFileSync(path.join(salida, nombreArchivo + '.jpg'), Buffer.from(r.data, 'base64'));
  };
  n.punto = (selector) => n.evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  n.clic = async (selector) => {
    const p = await n.punto(selector);
    if (!p) throw new Error('no existe ' + selector);
    await dormir(250);
    const q = await n.punto(selector);
    await n.enviar('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y });
    await n.enviar('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'left', clickCount: 1 });
    await n.enviar('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', clickCount: 1 });
    await dormir(250);
  };
  n.escribir = async (selector, texto) => {
    await n.clic(selector);
    await n.enviar('Input.insertText', { text: texto });
    await dormir(200);
  };
  n.esperar = async (expresion, ms, que) => {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      const v = await n.evaluar(expresion).catch(() => null);
      if (v) return v;
      await dormir(300);
    }
    throw new Error('tiempo agotado esperando: ' + que);
  };
  navegadores.push(n);
  return n;
}

// ---------- Ayudas de la app ----------

async function crearUsuario(nombreUsuario) {
  await fetch(base + '/registro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
    body: new URLSearchParams({ nombre: 'Prueba Navegador', usuario: nombreUsuario, email: `${nombreUsuario}@ecoflora.test`, telefono: '3000000000', direccion: 'Calle 1', ciudad: 'Bogotá', password: 'clave12345', confirmar: 'clave12345' }).toString()
  });
}

async function entrar(n, nombreUsuario) {
  await n.ir('/login', 300);
  await n.evaluar(`fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'usuario=${nombreUsuario}&password=clave12345', redirect: 'manual' }).then((r) => r.type)`);
}

const texto = (n, selector) => n.evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.textContent.trim().replace(/\\s+/g, ' ') : null; })()`);
const estado = (n) => n.evaluar(`document.querySelector('[data-rostro-camara]').getAttribute('data-estado')`);

// Acepta la autorización y confirma la contraseña; deja la cámara lista para encender.
async function pasarAutorizacion(n) {
  verifica((await n.evaluar(`document.querySelector('[data-rostro-continuar]').disabled`)) === true, 'el botón Continuar empieza deshabilitado');
  await n.clic('[data-rostro-consentimiento]');
  await n.escribir('[data-rostro-clave]', 'clave12345');
  verifica((await n.evaluar(`document.querySelector('[data-rostro-continuar]').disabled`)) === false, 'con el consentimiento y la contraseña se habilita Continuar');
  await n.clic('[data-rostro-continuar]');
  await n.esperar(`!document.querySelector('[data-rostro-paso-camara]').hidden`, 8000, 'el paso de la cámara');
  verifica(true, 'el servidor aceptó la autorización y aparece la cámara');
}

// Cuenta los cambios de estado de la cámara para entender qué ocurrió.
async function vigilarEstados(n) {
  await n.evaluar(`(() => {
    window.__estados = []; window.__pistas = [];
    const c = document.querySelector('[data-rostro-camara]');
    new MutationObserver(() => window.__estados.push(c.getAttribute('data-estado'))).observe(c, { attributes: true, attributeFilter: ['data-estado'] });
    const i = c.querySelector('[data-rostro-instruccion]');
    new MutationObserver(() => { const t = i.textContent; if (!window.__pistas.includes(t)) window.__pistas.push(t); }).observe(i, { childList: true, characterData: true, subtree: true });
  })()`);
}
const pistas = (n) => n.evaluar('window.__pistas.join(" | ")');
const estados = (n) => n.evaluar('window.__estados.join(" > ")');

// ---------- Escenarios ----------

async function escenarioExito() {
  console.log('\n== Registro con cámara simulada (prueba de vida reemplazada) ==');
  const n = await crearNavegador('exito', { camara: prepararCamara('a') });
  const u = `nav_a_${Date.now() % 1000000}`;
  await crearUsuario(u);
  compartido.usuarioConRostro = u;
  await n.vista(1280, 900, false);
  await entrar(n, u);
  await n.ir('/rostro');
  verifica((await n.evaluar('Boolean(window.EcoRostro)')) === true, 'rostro.js se carga');
  verifica((await texto(n, '.rostro-texto-legal')).includes('Ley 1581'), 'la autorización cita la Ley 1581');
  await n.foto('1-autorizacion-escritorio');
  await pasarAutorizacion(n);
  await n.foto('2-camara-reposo-escritorio');

  // Una foto no parpadea: se sustituye solo esta parte para poder seguir el flujo completo.
  await n.evaluar(`window.RostroVida.crearReto = (accion) => { let c = 0; return { accion, procesar: () => { c += 1; return { fase: 'prueba', progreso: Math.min(1, c / 25), completado: c >= 25 }; } }; }`);
  await vigilarEstados(n);
  await n.clic('[data-rostro-iniciar]');
  await n.esperar(`['cargando', 'camara', 'alineando'].includes(document.querySelector('[data-rostro-camara]').getAttribute('data-estado'))`, 5000, 'estado cargando');
  await n.foto('3-cargando-escritorio');
  await n.esperar(`['alineando', 'reto'].includes(document.querySelector('[data-rostro-camara]').getAttribute('data-estado'))`, 90000, 'la cámara y los modelos');
  verifica(true, 'los modelos de reconocimiento cargan y la cámara se enciende');
  await dormir(1500);
  await n.foto('4-alineando-escritorio');
  await n.esperar(`document.querySelector('[data-rostro-camara]').getAttribute('data-estado') === 'reto'`, 60000, 'que el rostro quede alineado');
  verifica(true, 'se detecta el rostro, pasa los controles de calidad y se pide el reto');
  await dormir(500);
  await n.foto('5-reto-escritorio');
  verifica((await texto(n, '[data-rostro-instruccion]')).length > 5, 'se muestra la instrucción del reto');
  await n.esperar(`['capturando', 'verificando', 'exito', 'error'].includes(document.querySelector('[data-rostro-camara]').getAttribute('data-estado'))`, 30000, 'la captura');
  await n.esperar(`['exito', 'error'].includes(document.querySelector('[data-rostro-camara]').getAttribute('data-estado'))`, 90000, 'el resultado');
  if ((await estado(n)) !== 'exito') {
    await n.foto('6-fallo-inesperado');
    console.log('      estados: ' + (await estados(n)));
    console.log('      mensaje: ' + (await texto(n, '[data-rostro-mensaje]')));
    console.log('      instrucción: ' + (await texto(n, '[data-rostro-instruccion]')));
  }
  verifica((await estado(n)) === 'exito', 'el registro termina en éxito');
  await n.foto('6-exito-escritorio');
  verifica(true, 'se capturan los descriptores y el servidor los guarda');
  console.log('      estados: ' + (await estados(n)));
  verifica((await n.evaluar(`document.querySelectorAll('[data-rostro-pasos] span.hecho').length`)) === 4, 'los 4 puntos de captura quedan completos');
  await n.esperar(`location.pathname === '/rostro' && location.search.includes('activado=1')`, 10000, 'la redirección');
  await dormir(800);
  verifica((await n.evaluar(`document.body.innerText.includes('Activado desde')`)) === true, 'después queda activado en /rostro');
  await n.foto('7-activado-escritorio');
  verifica((await n.evaluar(`document.querySelector('[data-rostro-video]') ? !document.querySelector('[data-rostro-video]').srcObject : true`)), 'la cámara queda apagada al terminar');

  await n.vista(390, 844, true);
  await n.ir('/rostro');
  await n.foto('8-activado-celular');
  await n.clic('[data-rostro-reiniciar]');
  await dormir(500);
  await n.foto('9-autorizacion-celular');
  verifica((await n.evaluar('document.documentElement.scrollWidth <= window.innerWidth + 1')) === true, 'en celular no hay desbordamiento horizontal');
  n.cerrar();
  return n;
}

async function escenarioFotoFija() {
  console.log('\n== Una foto fija frente a la cámara NO debe pasar la prueba de vida ==');
  const n = await crearNavegador('foto', { camara: prepararCamara('a') });
  const u = `nav_f_${Date.now() % 1000000}`;
  await crearUsuario(u);
  await n.vista(1280, 900, false);
  await entrar(n, u);
  await n.ir('/rostro');
  await pasarAutorizacion(n);
  await vigilarEstados(n);
  await n.clic('[data-rostro-iniciar]');
  await n.esperar(`document.querySelector('[data-rostro-camara]').getAttribute('data-estado') === 'reto'`, 120000, 'llegar al reto');
  await dormir(2000);
  await n.foto('10-foto-fija-reto');
  await n.esperar(`document.querySelector('[data-rostro-camara]').getAttribute('data-estado') === 'error'`, 60000, 'el error por tiempo');
  const mensaje = await texto(n, '[data-rostro-mensaje]');
  console.log('      estados: ' + (await estados(n)));
  verifica(/se acabó el tiempo/i.test(mensaje), 'una foto fija termina con "Se acabó el tiempo" (no pasa la prueba de vida)');
  verifica((await estado(n)) === 'error', 'el estado final es de error');
  await n.foto('11-foto-fija-error');
  verifica((await n.evaluar(`!document.querySelector('[data-rostro-video]').srcObject`)) === true, 'tras el error la cámara se apaga');
  const me = await n.evaluar(`fetch('/rostro').then((r) => r.text()).then((t) => t.includes('Activado desde'))`);
  verifica(me === false, 'nada se guardó: el rostro NO quedó activado');
  verifica((await n.evaluar(`document.querySelector('[data-rostro-iniciar]').textContent.includes('Intentar de nuevo')`)) === true, 'el botón cambia a "Intentar de nuevo"');
  n.cerrar();
  return n;
}

async function escenarioBloqueada() {
  console.log('\n== Cámara bloqueada ==');
  const n = await crearNavegador('bloqueada', { bloquear: true });
  const u = `nav_b_${Date.now() % 1000000}`;
  await crearUsuario(u);
  await n.vista(1280, 900, false);
  await entrar(n, u);
  await n.ir('/rostro');
  await pasarAutorizacion(n);
  await n.clic('[data-rostro-iniciar]');
  await n.esperar(`document.querySelector('[data-rostro-camara]').getAttribute('data-estado') === 'error'`, 90000, 'el error de cámara');
  const mensaje = await texto(n, '[data-rostro-mensaje]');
  verifica(/cámara está bloqueada/i.test(mensaje) && /Permitir/.test(mensaje), 'se explica cómo desbloquear la cámara');
  await n.foto('12-camara-bloqueada');
  n.cerrar();
  return n;
}

async function escenarioSinRostro() {
  console.log('\n== Cámara sin ningún rostro a la vista ==');
  const n = await crearNavegador('sinrostro', {});
  const u = `nav_s_${Date.now() % 1000000}`;
  await crearUsuario(u);
  await n.vista(1280, 900, false);
  await entrar(n, u);
  await n.ir('/rostro');
  await pasarAutorizacion(n);
  await n.clic('[data-rostro-iniciar]');
  await n.esperar(`document.querySelector('[data-rostro-camara]').getAttribute('data-estado') === 'alineando'`, 90000, 'la cámara');
  await n.esperar(`document.querySelector('[data-rostro-instruccion]').textContent.includes('No vemos tu rostro')`, 20000, 'el mensaje de que no hay rostro');
  verifica(true, 'sin rostro a la vista se pide ponerse frente a la cámara');
  await n.foto('13-sin-rostro');
  await n.clic('[data-rostro-cancelar]');
  await dormir(600);
  verifica((await n.evaluar(`!document.querySelector('[data-rostro-video]').srcObject`)) === true, 'Cancelar apaga la cámara');
  n.cerrar();
  return n;
}

// Sustituye la prueba de vida por una que se cumple sola (una foto no parpadea).
const reemplazarReto = (n) => n.evaluar(`window.RostroVida.crearReto = (accion) => { let c = 0; return { accion, procesar: () => { c += 1; return { fase: 'prueba', progreso: Math.min(1, c / 25), completado: c >= 25 }; } }; }`);
const esperarEstado = (n, lista, ms, que) => n.esperar(`${JSON.stringify(lista)}.includes(document.querySelector('[data-rostro-camara]').getAttribute('data-estado'))`, ms, que);

async function escenarioLoginOk() {
  console.log('\n== Iniciar sesión con rostro (cámara simulada con la misma persona) ==');
  const u = compartido.usuarioConRostro;
  if (!u) { verifica(false, 'hace falta correr antes el escenario "exito"'); return { problemas: [] }; }
  const n = await crearNavegador('login_ok', { camara: prepararCamara('a') });
  await n.vista(1280, 900, false);
  await n.ir('/login');
  verifica((await n.evaluar(`!document.querySelector('[data-login-modos]').hidden`)) === true, 'aparece el selector Contraseña | Rostro');
  verifica((await n.evaluar(`!document.querySelector('[data-login-panel="clave"]').hidden && document.querySelector('[data-login-panel="rostro"]').hidden`)) === true, 'sin rostro recordado se empieza por la contraseña');
  await n.foto('20-login-clave-escritorio');
  await n.clic('[data-login-tab="rostro"]');
  await dormir(700);
  verifica((await n.evaluar(`document.querySelector('[data-login-panel="clave"]').hidden && !document.querySelector('[data-login-panel="rostro"]').hidden`)) === true, 'la pestaña Rostro cambia el panel');
  await n.foto('21-login-rostro-escritorio');
  await n.clic('[data-login-rostro-iniciar]');
  verifica((await n.evaluar(`document.querySelector('[data-rostro-usuario]').classList.contains('is-invalid')`)) === true, 'sin usuario se marca el campo y no se enciende la cámara');
  await n.escribir('[data-rostro-usuario]', u);
  await reemplazarReto(n);
  await vigilarEstados(n);
  await n.clic('[data-login-rostro-iniciar]');
  await esperarEstado(n, ['reto', 'exito', 'error'], 120000, 'llegar al reto');
  await dormir(500);
  await n.foto('22-login-reto-escritorio');
  await esperarEstado(n, ['exito', 'error'], 90000, 'el resultado');
  console.log('      estados: ' + (await estados(n)));
  if ((await estado(n)) !== 'exito') console.log('      mensaje: ' + (await texto(n, '[data-rostro-mensaje]')));
  verifica((await estado(n)) === 'exito', 'la misma persona entra con su rostro');
  await n.foto('23-login-exito-escritorio');
  await n.esperar(`location.pathname === '/'`, 10000, 'la redirección al inicio');
  const sesion = await n.evaluar(`fetch('/usuario/perfil', { redirect: 'manual' }).then((r) => r.type)`);
  verifica(sesion === 'basic', 'la sesión quedó abierta (se puede ver el perfil)');
  verifica((await n.evaluar(`localStorage.getItem('ecoflora_rostro_usuario')`)) === u, 'el navegador recuerda solo el nombre de usuario');
  await n.ir('/logout');
  await n.ir('/login');
  verifica((await n.evaluar(`!document.querySelector('[data-login-panel="rostro"]').hidden`)) === true, 'con usuario recordado se empieza por el rostro');
  verifica((await texto(n, '[data-rostro-recordado]')).includes(u), 'se muestra "Entrar como" con el usuario recordado');
  await n.foto('24-login-recordado-escritorio');
  await n.clic('[data-rostro-no-soy]');
  await dormir(300);
  verifica((await n.evaluar(`!document.querySelector('[data-rostro-bloque-usuario]').hidden && document.querySelector('[data-rostro-recordado]').hidden && localStorage.getItem('ecoflora_rostro_usuario') === null`)) === true, '"No soy yo" olvida al usuario y vuelve a pedirlo');

  await n.vista(390, 844, true);
  await n.ir('/login');
  await n.clic('[data-login-tab="rostro"]');
  await dormir(600);
  await n.foto('25-login-rostro-celular');
  verifica((await n.evaluar('document.documentElement.scrollWidth <= window.innerWidth + 1')) === true, 'en celular el login no se desborda');
  n.cerrar();
  return n;
}

async function escenarioLoginOtraPersona() {
  console.log('\n== Otra persona frente a la cámara NO debe entrar ==');
  const u = compartido.usuarioConRostro;
  if (!u) { verifica(false, 'hace falta correr antes el escenario "exito"'); return { problemas: [] }; }
  const n = await crearNavegador('login_otra', { camara: prepararCamara('b') });
  n.esperados = ['/login/rostro'];
  await n.vista(1280, 900, false);
  await n.ir('/login');
  await n.clic('[data-login-tab="rostro"]');
  await n.escribir('[data-rostro-usuario]', u);
  await reemplazarReto(n);
  await vigilarEstados(n);
  await n.clic('[data-login-rostro-iniciar]');
  await esperarEstado(n, ['exito', 'error'], 150000, 'el resultado');
  const mensaje = await texto(n, '[data-rostro-mensaje]');
  if (!/no te reconocimos/i.test(mensaje)) console.log('      pistas vistas: ' + (await pistas(n)));
  verifica((await estado(n)) === 'error' && /no te reconocimos/i.test(mensaje), 'una persona distinta recibe "No te reconocimos"');
  await n.foto('26-login-otra-persona');
  const sesion = await n.evaluar(`fetch('/usuario/perfil', { redirect: 'manual' }).then((r) => r.type)`);
  verifica(sesion === 'opaqueredirect', 'y NO queda ninguna sesión abierta');
  verifica((await n.evaluar(`localStorage.getItem('ecoflora_rostro_usuario')`)) === null, 'tampoco se recuerda el usuario');
  verifica((await n.evaluar(`!document.querySelector('[data-rostro-video]').srcObject`)) === true, 'la cámara se apaga');
  n.cerrar();
  return n;
}

async function escenarioLoginSinRostro() {
  console.log('\n== Cuenta sin rostro activado ==');
  const n = await crearNavegador('login_sin', { camara: prepararCamara('a') });
  n.esperados = ['/login/rostro'];
  const u = `nav_n_${Date.now() % 1000000}`;
  await crearUsuario(u);
  await n.vista(1280, 900, false);
  await n.ir('/login');
  await n.clic('[data-login-tab="rostro"]');
  await n.escribir('[data-rostro-usuario]', u);
  await n.clic('[data-login-rostro-iniciar]');
  await esperarEstado(n, ['error'], 15000, 'el aviso rápido');
  const mensaje = await texto(n, '[data-rostro-mensaje]');
  verifica(/no tiene el rostro activado/i.test(mensaje) && /contraseña/i.test(mensaje), 'se avisa que la cuenta no tiene rostro y se sugiere la contraseña');
  verifica((await n.evaluar('Boolean(window.faceapi)')) === false, 'se avisa ANTES de descargar los modelos');
  await n.foto('27-login-sin-rostro');
  n.cerrar();
  return n;
}

async function main() {
  fs.mkdirSync(salida, { recursive: true });
  const escenarios = { exito: escenarioExito, foto_fija: escenarioFotoFija, bloqueada: escenarioBloqueada, sin_rostro: escenarioSinRostro, login_ok: escenarioLoginOk, login_otra_persona: escenarioLoginOtraPersona, login_sin_rostro: escenarioLoginSinRostro };
  for (const nombre of quieren) {
    if (!escenarios[nombre]) continue;
    const n = await escenarios[nombre]();
    // Solo cuentan los problemas que no sean esperados en el escenario.
    const reales = n.problemas.filter((p) => !/getUserMedia|NotAllowed|Permission denied|status of 4\d\d/i.test(p));
    verifica(reales.length === 0, `sin errores de consola ni de red en "${nombre}"`);
    reales.slice(0, 6).forEach((p) => console.log('      ' + p));
  }
  console.log(`\nCapturas guardadas en: ${salida}`);
  console.log(fallos ? `\n${fallos} comprobación(es) fallaron.` : '\nTodo bien en el navegador.');
  cerrarTodo(fallos ? 1 : 0);
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  cerrarTodo(1);
});
