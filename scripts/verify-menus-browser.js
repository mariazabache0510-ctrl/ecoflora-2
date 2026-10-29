// Prueba en un navegador real (Chrome sin ventana) los menús desplegables propios de EcoFlora:
// abrir con mouse y teclado, elegir, enviar el formulario, abrir hacia arriba, móvil y errores de consola.
//
//   (con la app y MongoDB de pruebas ya encendidos)
//   BASE_URL=http://127.0.0.1:3000 node scripts/verify-menus-browser.js
//
// Variables opcionales: CHROME_PATH (ruta de Chrome), SHOTS_DIR (dónde guardar las capturas).
// Crea un cliente de prueba con pedidos, así que úsala solo con una base de datos de pruebas.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const salida = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ecoflora-menus');
const puertoDebug = 9344;
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

async function ir(ruta, espera = 2000) {
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
  await dormir(700);
  return evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
}

const mover = (x, y) => enviar('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
async function clic(x, y) {
  await mover(x, y);
  await enviar('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await enviar('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function tecla(key, code, vk, text) {
  const comun = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await enviar('Input.dispatchKeyEvent', { type: 'keyDown', ...comun, ...(text ? { text } : {}) });
  await enviar('Input.dispatchKeyEvent', { type: 'keyUp', ...comun });
  await dormir(180);
}
const abajo = () => tecla('ArrowDown', 'ArrowDown', 40);
const enter = () => tecla('Enter', 'Enter', 13, '\r');
const esc = () => tecla('Escape', 'Escape', 27);

const estadoMenu = async () => JSON.parse(await evaluar(`(() => {
  const p = document.getElementById('selector-panel');
  const ab = document.querySelector('.selector-eco.abierto .selector-boton');
  const r = p && p.getBoundingClientRect();
  return JSON.stringify({
    abierto: !!(p && p.classList.contains('abierto')),
    lado: p && p.getAttribute('data-lado'),
    opciones: p ? p.querySelectorAll('.selector-opcion').length : 0,
    activa: p && (p.querySelector('.selector-opcion.activa .selector-nombre') || {}).textContent,
    expandido: ab && ab.getAttribute('aria-expanded'),
    rect: r && { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
  });
})()`));

function verifica(condicion, mensaje) {
  console.log((condicion ? 'ok    ' : 'FALLO ') + mensaje);
  if (!condicion) fallos += 1;
}

// Cliente de prueba con 4 pedidos, para que la tabla del admin tenga filas.
async function preparar() {
  const jar = new Map();
  const pedir = async (metodo, ruta, cuerpo) => {
    const headers = { Accept: 'text/html' };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (cuerpo) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(cuerpo).toString(); }
    const r = await fetch(base + ruta, { method: metodo, headers, body: payload, redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      const valor = par.slice(i + 1).trim();
      if (valor) jar.set(par.slice(0, i).trim(), valor); else jar.delete(par.slice(0, i).trim());
    });
    return r.status;
  };
  await pedir('POST', '/registro', { nombre: 'Cliente Menus', usuario: 'clientemenus', email: 'menus@ecoflora.com', telefono: '3010000000', direccion: 'Carrera 10', ciudad: 'Villavicencio', password: 'clave123', confirmar: 'clave123' });
  await pedir('POST', '/login', { usuario: 'clientemenus', password: 'clave123' });
  for (let i = 0; i < 4; i += 1) {
    await pedir('POST', '/carrito', { accion: 'agregar', id_planta: String(i + 1), cantidad: '1' });
    await pedir('POST', '/confirmar-pedido', { direccion: 'Calle 45 #12-30', ciudad: 'Villavicencio', telefono: '3010000000', notas: '' });
  }
}

async function main() {
  fs.mkdirSync(salida, { recursive: true });
  contexto = 'preparar datos';
  await preparar();

  proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${puertoDebug}`,
    '--user-data-dir=' + path.join(os.tmpdir(), 'ecoflora-chrome-' + Date.now()), '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  ws = new WebSocket(await urlWs());
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', alMensaje);
  await enviar('Page.enable'); await enviar('Runtime.enable'); await enviar('Network.enable');
  await vista(1440, 900, false);

  await ir('/login', 800);
  await evaluar(`fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'usuario=admin&password=Admin123', redirect: 'manual' }).then((r) => r.status)`);

  // ---------- Pedidos: menú pequeño dentro de una tabla ----------
  await ir('/admin/pedidos', 2200);
  const conteo = await evaluar(`document.querySelectorAll('.selector-boton').length + '/' + document.querySelectorAll('select').length`);
  const [botones, selects] = conteo.split('/').map(Number);
  verifica(botones === selects && botones >= 4, `cada <select> de pedidos se convirtió en menú propio (${conteo})`);
  verifica(await evaluar(`[...document.querySelectorAll('select')].every((s) => s.classList.contains('selector-nativo') && s.tabIndex === -1)`), 'los <select> originales quedan ocultos');
  await foto('d-pedidos-cerrado');

  const primero = await centro('.selector-boton');
  await clic(primero.x, primero.y); await dormir(700);
  let m = await estadoMenu();
  verifica(m.abierto && m.opciones === 5 && m.expandido === 'true', 'al hacer clic se abre el panel con las 5 opciones');
  verifica(m.activa === 'Pendiente', `queda resaltado el estado actual (${m.activa})`);
  await foto('d-pedidos-abierto');

  await abajo(); await abajo();
  m = await estadoMenu();
  verifica(m.activa === 'En camino', `las flechas mueven el resaltado (${m.activa})`);
  await evaluar(`window.__cambios = 0; document.querySelector('select[name=estado]').addEventListener('change', () => { window.__cambios += 1; })`);
  await foto('d-pedidos-teclado');
  await enter(); await dormir(400);
  m = await estadoMenu();
  const r1 = JSON.parse(await evaluar(`JSON.stringify({ valor: document.querySelector('select[name=estado]').value, texto: document.querySelector('.selector-valor').textContent, cambios: window.__cambios })`));
  verifica(!m.abierto && r1.valor === 'en_camino' && r1.texto === 'En camino' && r1.cambios === 1, `Enter elige, cierra y avisa un solo "change" (${JSON.stringify(r1)})`);

  await tecla('ArrowDown', 'ArrowDown', 40); await dormir(500);
  verifica((await estadoMenu()).abierto, 'con el foco en el botón, la flecha abajo abre el menú');
  await esc(); await dormir(450);
  verifica(!(await estadoMenu()).abierto, 'Escape cierra el menú');

  // Elegir con el mouse y enviar el formulario de verdad
  const b0 = await centro('.selector-boton');
  await clic(b0.x, b0.y); await dormir(700);
  const entregado = await evaluar(`(() => { const o = [...document.querySelectorAll('#selector-panel .selector-opcion')].find((x) => x.textContent.includes('Entregado')); const r = o.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await mover(entregado.x, entregado.y); await dormir(400);
  await foto('d-pedidos-hover');
  await clic(entregado.x, entregado.y); await dormir(500);
  verifica(await evaluar(`document.querySelector('select[name=estado]').value`) === 'entregado', 'elegir con el mouse cambia el valor del <select>');
  verifica(!(await estadoMenu()).abierto, 'el menú se cierra tras elegir con el mouse');

  const b1 = await centro('.selector-boton');
  await clic(b1.x, b1.y); await dormir(500);
  await clic(20, 300); await dormir(450);
  verifica(!(await estadoMenu()).abierto, 'un clic fuera cierra el menú');

  const idPrimero = await evaluar(`document.querySelector('input[name=id_pedido]').value`);
  const envio = await evaluar(`JSON.stringify([...new FormData(document.querySelector('select[name=estado]').form).entries()])`);
  verifica(envio.includes('entregado'), `el formulario envía el estado elegido (${envio})`);
  const enviarBtn = await centro('form[action="/admin/pedidos"] button[type=submit]');
  await clic(enviarBtn.x, enviarBtn.y); await dormir(2500);
  const fila = await evaluar(`(() => { const tr = [...document.querySelectorAll('tbody tr.fila-pedido')].find((t) => t.querySelector('input[name=id_pedido]').value === '${idPrimero}'); return tr ? tr.querySelector('.estado').textContent.trim() : 'sin fila'; })()`);
  verifica(/entregado/i.test(fila), `el servidor guardó el estado nuevo (${fila})`);

  // Último menú de la tabla: debe abrir hacia arriba si abajo no cabe
  const ultimo = await evaluar(`(() => { const b = [...document.querySelectorAll('.selector-boton')].pop(); b.scrollIntoView({ block: 'end' }); return true; })()`);
  await dormir(700);
  const u = await evaluar(`(() => { const b = [...document.querySelectorAll('.selector-boton')].pop(); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, abajo: window.innerHeight - r.bottom }; })()`);
  await clic(u.x, u.y); await dormir(750);
  m = await estadoMenu();
  console.log(`      (último menú: espacio abajo ${Math.round(u.abajo)}px, lado ${m.lado}, ${JSON.stringify(m.rect)})`);
  verifica(ultimo && m.abierto && m.rect.top >= 0 && m.rect.top + m.rect.height <= 900, 'el panel cabe siempre dentro de la pantalla');
  await foto('d-pedidos-ultimo');
  await evaluar('window.scrollBy(0, -60)'); await dormir(500);
  const m2 = await estadoMenu();
  verifica(m2.abierto && m2.rect.top !== m.rect.top, 'al hacer scroll el panel acompaña al botón');
  await esc(); await dormir(400);

  // ---------- Editar usuario: menú con iconos y detalle ----------
  await ir('/admin/usuarios', 1800);
  const href = await evaluar(`[...document.querySelectorAll('a[href*="/editar"]')].map((a) => a.getAttribute('href')).pop()`);
  await ir(href, 2200);
  await foto('d-editar-cerrado');
  await evaluar('window.scrollBy(0, 120)'); await dormir(500);
  const rol = await centro('.selector-boton');
  await clic(rol.x, rol.y); await dormir(800);
  m = await estadoMenu();
  verifica(m.abierto && m.opciones === 2, 'el menú de rol abre con sus 2 opciones');
  await foto('d-editar-abierto');
  await abajo(); await enter(); await dormir(500);
  verifica(await evaluar(`document.querySelector('#rol').value`) === 'admin', 'se puede elegir Administrador con el teclado');
  await foto('d-editar-elegido');
  await evaluar(`document.querySelector('label[for=rol]').click()`); await dormir(300);
  verifica(await evaluar(`document.activeElement === document.querySelector('.selector-boton')`), 'pulsar la etiqueta lleva el foco al menú');

  // ---------- Móvil ----------
  await vista(390, 844, true);
  await ir(href, 2200);
  const mb = await centro('.selector-boton');
  await clic(mb.x, mb.y); await dormir(800);
  m = await estadoMenu();
  verifica(m.abierto && m.rect.left >= 0 && m.rect.left + m.rect.width <= 390, `en móvil el panel queda dentro del ancho (${JSON.stringify(m.rect)})`);
  await foto('m-editar-abierto');
  await esc();
  await ir('/admin/pedidos', 2200);
  const mp = await centro('.selector-boton');
  await clic(mp.x, mp.y); await dormir(800);
  m = await estadoMenu();
  verifica(m.abierto && m.rect.left >= 0 && m.rect.left + m.rect.width <= 390, `en móvil el menú de la tabla queda dentro del ancho (${JSON.stringify(m.rect)})`);
  await foto('m-pedidos-abierto');

  console.log(`\nErrores de consola o de red: ${problemas.length}`);
  problemas.forEach((p) => console.log(' -', p));
  console.log(`Capturas en ${salida}`);
  cerrarTodo(fallos || problemas.length ? 1 : 0);
}

main().catch((error) => { console.error('ERROR', error.message); cerrarTodo(1); });
