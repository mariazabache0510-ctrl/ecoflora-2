// Prueba en un navegador real (Chrome sin ventana) la página Admin > Inventario:
// vista previa en vivo, menú de operaciones, botones +/-, guardado, aviso, buscador, filtros y móvil.
//
//   (con la app y MongoDB de pruebas ya encendidos, base recién importada)
//   BASE_URL=http://127.0.0.1:3000 node scripts/verify-inventario-browser.js
//
// Variables opcionales: CHROME_PATH (ruta de Chrome), SHOTS_DIR (dónde guardar las capturas).
// Cambia el stock de la Monstera, así que úsala solo con una base de datos de pruebas.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const salida = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ecoflora-inventario');
const puertoDebug = 9345;
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

// Seguro contra cuelgues: si algo se queda esperando, se cierra Chrome y se avisa.
setTimeout(() => { console.error('TIEMPO AGOTADO en: ' + contexto); cerrarTodo(2); }, 150000);

function enviar(metodo, params = {}) {
  return new Promise((res, rej) => {
    const i = ++contadorId;
    const espera = setTimeout(() => { pendientes.delete(i); rej(new Error('sin respuesta de Chrome: ' + metodo)); }, 20000);
    pendientes.set(i, { res: (v) => { clearTimeout(espera); res(v); }, rej: (e) => { clearTimeout(espera); rej(e); } });
    ws.send(JSON.stringify({ id: i, method: metodo, params }));
  });
}

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
    problemas.push(`[${contexto}] console.${m.params.type}: ${m.params.args.map((a) => a.value || a.description).join(' ')}`);
  } else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
    problemas.push(`[${contexto}] HTTP ${m.params.response.status} ${m.params.response.url}`);
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

async function vista(w, h, movil) {
  await enviar('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!movil });
  await enviar('Emulation.setTouchEmulationEnabled', { enabled: !!movil });
}

async function ir(ruta, espera = 2200) {
  contexto = ruta;
  await enviar('Page.navigate', { url: base + ruta });
  await dormir(espera);
}

async function foto(nombre) {
  const r = await enviar('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
  fs.writeFileSync(path.join(salida, nombre + '.jpg'), Buffer.from(r.data, 'base64'));
}

async function centro(selector, alinear = 'center') {
  await evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (e) e.scrollIntoView({ block: ${JSON.stringify(alinear)} }); })()`);
  await dormir(600);
  return evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
}

const mover = (x, y) => enviar('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
async function clic(x, y) {
  await mover(x, y);
  await enviar('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await enviar('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function clicEn(selector) {
  const p = await centro(selector);
  if (!p) throw new Error('no existe ' + selector);
  await clic(p.x, p.y);
  await dormir(350);
}
// Escribe en un campo como lo haría una persona: lo enfoca, selecciona todo y teclea.
async function escribir(selector, texto) {
  await clicEn(selector);
  await evaluar(`document.querySelector(${JSON.stringify(selector)}).select()`);
  if (texto === '') {
    await enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  } else {
    await enviar('Input.insertText', { text: texto });
  }
  await dormir(250);
}

function verifica(condicion, mensaje) {
  console.log((condicion ? 'ok    ' : 'FALLO ') + mensaje);
  if (!condicion) fallos += 1;
}

const leer = (expresion) => evaluar(expresion);
const estadoTarjeta = async (id) => JSON.parse(await leer(`(() => {
  const t = document.getElementById('planta-${id}');
  const f = t.querySelector('[data-inv-form]');
  const b = t.querySelector('.inv-enviar');
  return JSON.stringify({
    actual: Number(t.querySelector('[data-inv-actual]').textContent),
    cantidad: t.querySelector('input[name=cantidad]').value,
    accion: t.querySelector('select[name=accion]').value,
    previa: t.querySelector('[data-inv-previa]').textContent.trim().replace(/\\s+/g, ' '),
    claseprevia: t.querySelector('[data-inv-previa]').className,
    deshabilitado: b.disabled,
    stockForm: Number(f.getAttribute('data-stock'))
  });
})()`));
const visibles = () => leer(`[...document.querySelectorAll('[data-inv-tarjeta]')].filter((c) => !c.hidden).length`);

async function elegirOperacion(id, texto) {
  await clicEn(`#planta-${id} .selector-boton`);
  await dormir(500);
  const p = await evaluar(`(() => { const o = [...document.querySelectorAll('#selector-panel .selector-opcion')].find((x) => x.textContent.includes(${JSON.stringify(texto)})); if (!o) return null; const r = o.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!p) throw new Error('no hay opción ' + texto);
  await clic(p.x, p.y);
  await dormir(450);
}

async function main() {
  fs.mkdirSync(salida, { recursive: true });
  proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${puertoDebug}`,
    '--user-data-dir=' + path.join(os.tmpdir(), 'ecoflora-chrome-inv-' + Date.now()), '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  ws = new WebSocket(await urlWs());
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', alMensaje);
  await enviar('Page.enable'); await enviar('Runtime.enable'); await enviar('Network.enable');
  await vista(1440, 900, false);

  await ir('/login', 800);
  await evaluar(`fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'usuario=admin&password=Admin123', redirect: 'manual' }).then((r) => r.status)`);

  // ---------- Panel: el acceso al inventario ----------
  await ir('/admin', 2200);
  verifica(await leer(`!!document.querySelector('a.accion[href="/admin/inventario"]')`), 'el panel de admin tiene el acceso a Inventario');
  await foto('d-panel');

  // ---------- Inventario en escritorio ----------
  await ir('/admin/inventario', 2600);
  const resumen = JSON.parse(await leer(`JSON.stringify({
    tarjetas: document.querySelectorAll('[data-inv-tarjeta]').length,
    menus: document.querySelectorAll('.inv-form .selector-boton').length,
    selects: document.querySelectorAll('.inv-form select').length,
    chips: [...document.querySelectorAll('[data-inv-filtro]')].map((c) => Number(c.querySelector('.chip-cuenta').textContent))
  })`));
  verifica(resumen.tarjetas === 22, `se listan las 22 plantas (${resumen.tarjetas})`);
  verifica(resumen.menus === resumen.selects && resumen.menus === 22, 'el menú de operaciones es el desplegable propio de la app, no el del sistema');
  await foto('d-inventario');

  const antes = await estadoTarjeta(1);
  verifica(antes.accion === 'agregar' && antes.cantidad === '1' && antes.previa.includes(`${antes.actual + 1}`), `al abrir, la vista previa ya calcula (${antes.previa})`);
  verifica(!antes.deshabilitado, 'el botón Actualizar está activo con datos válidos');

  // Escribir la cantidad
  await escribir('#planta-1 input[name=cantidad]', '5');
  let e = await estadoTarjeta(1);
  verifica(e.previa.includes(`de ${antes.actual} a ${antes.actual + 5}`), `escribir 5 actualiza la vista previa (${e.previa})`);
  // Botón +
  await clicEn('#planta-1 [data-paso="1"]');
  e = await estadoTarjeta(1);
  verifica(e.cantidad === '6' && e.previa.includes(`a ${antes.actual + 6}`), `el botón + suma uno y recalcula (${e.previa})`);
  await clicEn('#planta-1 [data-paso="-1"]');
  e = await estadoTarjeta(1);
  verifica(e.cantidad === '5', 'el botón − resta uno');

  // Quitar más de lo que hay
  await elegirOperacion(1, 'Quitar del stock');
  e = await estadoTarjeta(1);
  verifica(e.accion === 'quitar', 'el menú propio cambia la operación a Quitar');
  await escribir('#planta-1 input[name=cantidad]', '999');
  e = await estadoTarjeta(1);
  verifica(e.deshabilitado && e.claseprevia.includes('error') && e.previa.includes('Solo hay'), `quitar de más bloquea el botón y avisa (${e.previa})`);
  await foto('d-inventario-error');
  await escribir('#planta-1 input[name=cantidad]', '2');
  e = await estadoTarjeta(1);
  verifica(!e.deshabilitado && e.previa.includes(`a ${antes.actual - 2}`), `quitar una cantidad válida muestra el resultado (${e.previa})`);
  await escribir('#planta-1 input[name=cantidad]', '');
  e = await estadoTarjeta(1);
  verifica(e.deshabilitado && e.previa.includes('número entero'), `un campo vacío bloquea el botón (${e.previa})`);

  // Fijar
  await elegirOperacion(1, 'Dejar en una cantidad');
  await escribir('#planta-1 input[name=cantidad]', String(antes.actual));
  e = await estadoTarjeta(1);
  verifica(e.previa.includes('no cambia nada'), `fijar el mismo número avisa que no cambia nada (${e.previa})`);

  // Añadir 5 de verdad (el ejemplo de Mariana: llegaron 5 más)
  await elegirOperacion(1, 'Añadir al stock');
  await escribir('#planta-1 input[name=cantidad]', '5');
  await foto('d-inventario-previa');
  await clicEn('#planta-1 .inv-enviar');
  await dormir(2800);
  contexto = 'tras guardar';
  const alerta = await leer(`(document.querySelector('#planta-1 .inv-resultado-ok') || {}).textContent || ''`);
  verifica(alerta.includes('Se añadieron 5 unidades a Monstera deliciosa') && alerta.includes(`de ${antes.actual} a ${antes.actual + 5}`), `el aviso de éxito aparece dentro de la tarjeta (${alerta.trim()})`);
  const visibleAviso = await leer(`(() => { const r = document.querySelector('#planta-1 .inv-resultado-ok').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })()`);
  verifica(visibleAviso, 'el aviso queda a la vista, sin tener que buscarlo');
  const despues = await estadoTarjeta(1);
  verifica(despues.actual === antes.actual + 5 && despues.stockForm === antes.actual + 5, `la tarjeta muestra ${antes.actual + 5} unidades`);
  verifica(await leer(`document.getElementById('planta-1').classList.contains('recien')`), 'la planta actualizada queda resaltada');
  verifica((await leer('location.hash')) === '#planta-1', 'la página vuelve a la planta que se tocó (#planta-1)');
  await foto('d-inventario-guardado');
  // La ficha pública refleja el cambio
  await ir('/planta/1', 1500);
  verifica((await leer('document.body.textContent')).includes(`Stock: ${antes.actual + 5} unidades`), 'la ficha pública muestra el stock nuevo');

  // ---------- Buscador y filtros ----------
  await ir('/admin/inventario', 2200);
  await escribir('[data-inv-buscar]', 'deliciosa');
  verifica((await visibles()) === 1, `buscar "deliciosa" deja una sola planta (${await visibles()})`);
  await escribir('[data-inv-buscar]', 'DELICIÓSA');
  verifica((await visibles()) === 1, 'el buscador ignora mayúsculas y tildes');
  await escribir('[data-inv-buscar]', 'monstera');
  verifica((await visibles()) === 2, 'el buscador también encuentra por nombre científico (Monstera adansonii)');
  await escribir('[data-inv-buscar]', 'zzzz');
  verifica((await visibles()) === 0 && await leer(`!document.querySelector('[data-inv-vacio]').hidden`), 'sin coincidencias se muestra el mensaje de vacío');
  await foto('d-inventario-vacio');
  await escribir('[data-inv-buscar]', '');
  verifica((await visibles()) === 22, 'borrar la búsqueda devuelve las 22 plantas');
  await clicEn('[data-inv-filtro="poco"]');
  verifica((await visibles()) === resumen.chips[1], `el filtro "Poco stock" muestra ${resumen.chips[1]} plantas (${await visibles()})`);
  await foto('d-inventario-poco');
  await clicEn('[data-inv-filtro="agotada"]');
  verifica((await visibles()) === resumen.chips[2], `el filtro "Agotadas" muestra ${resumen.chips[2]} plantas (${await visibles()})`);
  await clicEn('[data-inv-filtro="todas"]');
  verifica((await visibles()) === 22 && await leer(`document.querySelector('[data-inv-filtro="todas"]').classList.contains('activo')`), 'el filtro "Todas" vuelve a mostrar todo');

  // ---------- Móvil ----------
  await vista(390, 844, true);
  await ir('/admin/inventario', 2600);
  verifica(await leer(`document.documentElement.scrollWidth <= 391`), 'en móvil no hay scroll horizontal');
  await foto('m-inventario');
  await evaluar(`document.getElementById('planta-1').scrollIntoView({ block: 'center' })`); await dormir(600);
  await foto('m-inventario-tarjeta');
  await elegirOperacion(1, 'Quitar del stock');
  const mm = JSON.parse(await leer(`(() => { const r = document.getElementById('selector-panel').getBoundingClientRect(); return JSON.stringify({ left: Math.round(r.left), right: Math.round(r.right) }); })()`));
  verifica(mm.left >= 0 && mm.right <= 390, `en móvil el menú de operaciones cabe en pantalla (${JSON.stringify(mm)})`);

  console.log(`\nErrores de consola o de red: ${problemas.length}`);
  problemas.forEach((p) => console.log(' -', p));
  console.log(`Capturas en ${salida}`);
  cerrarTodo(fallos || problemas.length ? 1 : 0);
}

main().catch((error) => { console.error('ERROR', error.message); cerrarTodo(1); });
