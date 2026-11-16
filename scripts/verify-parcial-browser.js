// Prueba en un Chrome real (sin ventana) las pantallas nuevas del parcial: sitios de interés, base federada,
// recuperar contraseña, nuevo usuario y el botón de Google. Guarda capturas de pantalla.
//
//   (con la app y MongoDB de pruebas encendidos; la app con COCKROACH_URL de práctica, y para ver la base federada,
//    con PG_URL y MYSQL_URL; la prueba de la federada se salta si está apagada)
//   BASE_URL=http://127.0.0.1:3000 node scripts/verify-parcial-browser.js
//
// Variables opcionales: CHROME_PATH, SHOTS_DIR, ADMIN_PASSWORD (por defecto Admin123).
// Crea y borra un sitio de prueba en la base de sitios. Úsala solo con bases de prueba.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLAVE = process.env.ADMIN_PASSWORD || 'Admin123';
const salida = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ecoflora-parcial');
const puertoDebug = 9351;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const problemas = [];
let contexto = 'inicio';
let fallos = 0;
let proc = null;
let ws = null;
let contadorId = 0;
const pendientes = new Map();

function cerrarTodo(codigo) {
  try { if (ws) ws.close(); } catch (error) { /* ya cerrado */ }
  try { if (proc) proc.kill(); } catch (error) { /* ya cerrado */ }
  process.exit(codigo);
}
setTimeout(() => { console.error('TIEMPO AGOTADO en: ' + contexto); cerrarTodo(2); }, 120000);

function enviar(metodo, params = {}) {
  return new Promise((res, rej) => {
    const i = ++contadorId;
    const espera = setTimeout(() => { pendientes.delete(i); rej(new Error('sin respuesta de Chrome: ' + metodo)); }, 20000);
    pendientes.set(i, { res: (v) => { clearTimeout(espera); res(v); }, rej: (e) => { clearTimeout(espera); rej(e); } });
    ws.send(JSON.stringify({ id: i, method: metodo, params }));
  });
}

// Lo que viene de los servidores de Google (si no hay internet o la llave es de prueba) no cuenta como problema nuestro.
const AJENO = /google|gstatic|googleapis/i;
// Errores HTTP que la prueba provoca a propósito (un enlace falso y una latitud fuera de rango).
let esperado400 = /\/recuperar\/a{43}$/;
function alMensaje(ev) {
  const m = JSON.parse(ev.data);
  if (m.id && pendientes.has(m.id)) {
    const { res, rej } = pendientes.get(m.id);
    pendientes.delete(m.id);
    if (m.error) rej(new Error(m.error.message)); else res(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    problemas.push(`[${contexto}] excepción JS: ${(d.exception && d.exception.description) || d.text}`);
  } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    const texto = m.params.args.map((a) => a.value || a.description).join(' ');
    if (!AJENO.test(texto)) problemas.push(`[${contexto}] console.${m.params.type}: ${texto}`);
  } else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && !AJENO.test(m.params.response.url) && !(m.params.response.status === 400 && esperado400.test(m.params.response.url))) {
    problemas.push(`[${contexto}] HTTP ${m.params.response.status} ${m.params.response.url}`);
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && /Content Security Policy|Refused to/i.test(m.params.entry.text) && !AJENO.test(m.params.entry.text + (m.params.entry.url || ''))) {
    problemas.push(`[${contexto}] CSP: ${m.params.entry.text}`);
  }
}

async function urlWs() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${puertoDebug}/json/list`)).json();
      const pagina = lista.find((x) => x.type === 'page');
      if (pagina) return pagina.webSocketDebuggerUrl;
    } catch (error) { /* Chrome aún arranca */ }
    await dormir(250);
  }
  throw new Error('Chrome no arrancó');
}

const evaluar = async (expresion) => {
  const r = await enviar('Runtime.evaluate', { expression: expresion, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result && r.result.value;
};

async function ir(ruta, espera = 1500) {
  contexto = ruta;
  await enviar('Page.navigate', { url: base + ruta });
  await dormir(espera);
}

async function foto(nombre) {
  const r = await enviar('Page.captureScreenshot', { format: 'jpeg', quality: 80, captureBeyondViewport: true });
  fs.writeFileSync(path.join(salida, nombre + '.jpg'), Buffer.from(r.data, 'base64'));
}

async function esperarHasta(expresion, ms = 6000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await evaluar(expresion)) return true;
    await dormir(150);
  }
  return false;
}

function verifica(condicion, mensaje) {
  console.log((condicion ? 'ok    ' : 'FALLO ') + mensaje);
  if (!condicion) fallos += 1;
}

const sinDesborde = () => evaluar('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1');
const poner = (selector, valor) => evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

async function main() {
  fs.mkdirSync(salida, { recursive: true });
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'ecoflora-chrome-'));
  proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${puertoDebug}`, `--user-data-dir=${perfil}`, '--no-first-run', '--disable-gpu', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  ws = new WebSocket(await urlWs());
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = alMensaje;
  for (const metodo of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) await enviar(metodo);
  await enviar('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log('\n== Pantallas públicas ==');
  await ir('/login');
  verifica(await evaluar("!!document.querySelector('[data-google]')"), 'el login muestra el bloque de Google (la app tiene GOOGLE_CLIENT_ID)');
  verifica(await evaluar("!!document.querySelector('a[href=\"/recuperar\"]')"), 'el login tiene "¿Olvidaste tu contraseña?"');
  await foto('login');
  await ir('/registro');
  verifica(await evaluar("!!document.querySelector('[data-google]')"), 'el registro muestra el bloque de Google');
  await ir('/recuperar');
  verifica(await evaluar("!!document.querySelector('form[action=\"/recuperar\"] input[name=\"dato\"]')"), '/recuperar muestra el formulario');
  await foto('recuperar');
  await ir('/recuperar/' + 'a'.repeat(43));
  verifica(await evaluar("/no es válido|venció|inválido|expir/i.test(document.body.innerText)"), 'un enlace de recuperación falso muestra un aviso claro');
  await ir('/sitios');
  verifica(await evaluar("location.pathname === '/login'"), '/sitios sin sesión lleva a ingresar');

  console.log('\n== Con el administrador ==');
  await ir('/login');
  await poner('input[name="usuario"]', 'admin');
  await poner('input[name="password"]', CLAVE);
  await evaluar("document.querySelector('input[name=\"password\"]').form.requestSubmit()");
  verifica(await esperarHasta("location.pathname === '/admin'", 8000), 'el admin entra por el formulario');
  await foto('panel');
  verifica(await evaluar("!!document.querySelector('a[href=\"/sitios\"]') && !!document.querySelector('a[href=\"/admin/federada\"]')"), 'el panel tiene las tarjetas de Sitios de interés y Base federada');

  await ir('/admin/usuarios/nuevo');
  verifica(await evaluar("!!document.querySelector('form[action=\"/admin/usuarios/nuevo\"]')"), '/admin/usuarios/nuevo muestra el formulario');
  await foto('usuario-nuevo');

  await ir('/admin/federada');
  const federada = await evaluar("!/apagada/i.test(document.body.innerText)");
  if (federada) {
    verifica(await evaluar("/PostgreSQL/.test(document.body.innerText) && /MySQL/.test(document.body.innerText)"), '/admin/federada muestra los dos servidores');
    verifica(await evaluar("!!document.querySelector('form[action=\"/admin/federada/sincronizar\"]')"), '/admin/federada tiene el botón "Sincronizar ahora"');
  } else {
    console.log('      (la base federada está apagada en esta app: se prueba solo el aviso)');
    verifica(await evaluar("/docker compose/i.test(document.body.innerText)"), '/admin/federada explica cómo encenderla');
  }
  await foto('federada');

  console.log('\n== Sitios de interés ==');
  await ir('/sitios', 2500);
  const disponible = await evaluar("!!document.querySelector('[data-sitios]')");
  if (!disponible) {
    console.log('      (COCKROACH_URL no está definida en esta app: se salta la prueba de sitios)');
  } else {
    verifica(await evaluar("!!document.querySelector('[data-sitios-form]') && !!document.querySelector('[data-sitios-lista]')"), '/sitios muestra el formulario y la lista');
    verifica(await esperarHasta("document.querySelector('[data-sitios-estado]').hidden || /Aún no|Todavía/.test(document.querySelector('[data-sitios-estado]').textContent)"), 'la lista termina de cargar');
    await poner('#sitio-nombre', 'Vivero <b>de prueba</b>');
    await poner('#sitio-descripcion', 'Creado por la prueba del navegador');
    await poner('#sitio-categoria', 'jardin');
    await poner('#sitio-lat', '4.15');
    await poner('#sitio-lng', '-73.64');
    await evaluar("document.querySelector('[data-sitios-form]').requestSubmit()");
    verifica(await esperarHasta("document.querySelectorAll('.sitio-item').length >= 1"), 'al guardar, el sitio aparece en la lista');
    verifica(await evaluar("document.querySelector('.sitio-item h3').textContent.indexOf('<b>de prueba</b>') !== -1 && !document.querySelector('.sitio-item h3 b')"), 'el nombre con HTML se muestra como texto (no se interpreta)');
    verifica(await evaluar("document.querySelector('#sitio-nombre').value === ''"), 'el formulario se limpia tras guardar');
    await foto('sitios');
    esperado400 = /\/recuperar\/a{43}$|\/api\/sitios$/;
    await poner('#sitio-lat', '95');
    await poner('#sitio-nombre', 'Fuera de rango');
    await poner('#sitio-lng', '10');
    await evaluar("document.querySelector('[data-sitios-form]').requestSubmit()");
    verifica(await esperarHasta("!document.querySelector('[data-sitios-error]').hidden && /latitud/i.test(document.querySelector('[data-sitios-error]').textContent)"), 'una latitud fuera de rango muestra el error del servidor');
    await evaluar('window.confirm = () => true');
    const antes = await evaluar("document.querySelectorAll('.sitio-item').length");
    await evaluar("document.querySelector('.sitio-item .btn-outline-danger').click()");
    verifica(await esperarHasta(`document.querySelectorAll('.sitio-item').length === ${antes - 1}`), 'borrar quita el sitio de la lista');
    await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
    await ir('/sitios', 1800);
    verifica(await sinDesborde(), 'en celular, /sitios no se desborda');
    await foto('sitios-movil');
    await enviar('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }

  console.log(`\nProblemas de consola/CSP/red: ${problemas.length}`);
  problemas.forEach((p) => console.log('  ' + p));
  verifica(problemas.length === 0, 'sin errores de consola, CSP ni red');
  console.log(`Capturas en ${salida}`);
  console.log(fallos ? `\n${fallos} fallo(s).` : '\nTodo bien en el navegador (parcial).');
  cerrarTodo(fallos ? 1 : 0);
}

main().catch((error) => { console.error('ERROR:', error.message); cerrarTodo(1); });
