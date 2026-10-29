// Prueba el envío del correo de contacto SIN usar tu llave real de Resend:
// levanta un servidor falso que hace de Resend, arranca la app apuntándole y envía mensajes de prueba.
//
//   MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora node scripts/verify-contact-mail.js
//
// Necesita una base de MongoDB de pruebas (la misma que usas para verify-flow).

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PUERTO_APP = Number(process.env.TEST_APP_PORT) || 3101;
const base = `http://127.0.0.1:${PUERTO_APP}`;

function assert(condicion, mensaje) {
  if (!condicion) {
    console.error('FALLO:', mensaje);
    process.exitCode = 1;
    throw new Error(mensaje);
  }
  console.log('ok', mensaje);
}

function cliente() {
  const jar = new Map();
  return async function pedir(metodo, ruta, cuerpo) {
    const headers = { Accept: 'text/html' };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (cuerpo) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(cuerpo).toString();
    }
    const respuesta = await fetch(base + ruta, { method: metodo, headers, body: payload, redirect: 'manual' });
    (typeof respuesta.headers.getSetCookie === 'function' ? respuesta.headers.getSetCookie() : []).forEach((entrada) => {
      const [par] = entrada.split(';');
      const i = par.indexOf('=');
      const valor = par.slice(i + 1).trim();
      if (valor) jar.set(par.slice(0, i).trim(), valor);
      else jar.delete(par.slice(0, i).trim());
    });
    return { status: respuesta.status, text: await respuesta.text(), location: respuesta.headers.get('location') };
  };
}

async function esperarApp() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(base + '/health');
      if (r.status === 200) return;
    } catch (error) { /* aún arrancando */ }
    await new Promise((listo) => setTimeout(listo, 500));
  }
  throw new Error('La app de prueba no arrancó');
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Define MONGODB_URI con una base de pruebas.');

  const recibidos = [];
  let responder = () => ({ status: 200, cuerpo: '{"id":"stub"}' });
  const stub = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (trozo) => { datos += trozo; });
    req.on('end', () => {
      recibidos.push({ metodo: req.method, url: req.url, auth: req.headers.authorization, json: JSON.parse(datos || '{}') });
      const { status, cuerpo } = responder();
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(cuerpo);
    });
  });
  await new Promise((listo) => stub.listen(0, '127.0.0.1', listo));
  const urlStub = `http://127.0.0.1:${stub.address().port}/emails`;

  const app = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PUERTO_APP),
      SESSION_SECRET: 'prueba-correo',
      RESEND_API_KEY: 'llave-de-prueba',
      RESEND_API_URL: urlStub,
      CONTACT_TO_EMAIL: '',
      CONTACT_FROM_EMAIL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logApp = '';
  app.stdout.on('data', (d) => { logApp += d; });
  app.stderr.on('data', (d) => { logApp += d; });

  const marca = 'correo-' + Date.now();
  try {
    await esperarApp();
    const pedir = cliente();

    // 1) Mensaje normal: llega a Resend con todos los datos.
    const ok = await pedir('POST', '/contacto', {
      nombre: 'Laura <b>Gómez</b>',
      email: 'laura@correo.com',
      telefono: '312 400 0000',
      asunto: 'Pedido\r\nBcc: espia@malo.com',
      mensaje: `Hola, quiero <script>alert(1)</script> flores.\nSegunda línea ${marca}`
    });
    assert(ok.status === 200 && ok.text.includes('Mensaje enviado correctamente'), 'el formulario confirma el envío');
    assert(recibidos.length === 1, 'se hizo una llamada a la API de correo');
    const llamada = recibidos[0];
    assert(llamada.metodo === 'POST' && llamada.auth === 'Bearer llave-de-prueba', 'la llamada usa POST y la llave en Authorization');
    const correo = llamada.json;
    assert(Array.isArray(correo.to) && correo.to.length === 1 && correo.to[0] === 'mariazabache0510@gmail.com', 'el correo se envía a mariazabache0510@gmail.com');
    assert(correo.reply_to === 'laura@correo.com', 'reply_to es el correo de quien escribe');
    assert(correo.from.includes('onboarding@resend.dev'), 'el remitente por defecto es el de pruebas de Resend');
    assert(/Pedido/.test(correo.subject) && correo.subject.includes('Laura') && !/[\r\n]/.test(correo.subject), 'el asunto trae el tema y el nombre, sin saltos de línea');
    assert(correo.text.includes('laura@correo.com') && correo.text.includes('312 400 0000') && correo.text.includes(marca), 'el texto trae correo, teléfono y mensaje');
    assert(correo.html.includes('laura@correo.com') && correo.html.includes('312 400 0000') && correo.html.includes(marca), 'el HTML trae correo, teléfono y mensaje');
    assert(!correo.html.includes('<script>') && correo.html.includes('&lt;script&gt;'), 'el HTML escapa etiquetas peligrosas');
    assert(!correo.html.includes('<b>Gómez') && correo.html.includes('&lt;b&gt;'), 'el nombre se escapa en el HTML');
    assert(correo.html.includes('https://wa.me/573124000000'), 'el correo incluye el botón para responder por WhatsApp');
    assert(correo.html.includes('<br') && correo.text.includes('Segunda línea'), 'se conservan los saltos de línea del mensaje');

    // 2) Resend falla: el mensaje igual queda guardado y el visitante no ve el error.
    responder = () => ({ status: 500, cuerpo: '{"message":"boom"}' });
    const falla = await pedir('POST', '/contacto', {
      nombre: 'Pedro', email: 'pedro@correo.com', mensaje: 'Mensaje cuando falla el correo ' + marca
    });
    assert(falla.status === 200 && falla.text.includes('Mensaje enviado correctamente'), 'si el correo falla, el visitante igual ve el éxito');
    assert(recibidos.length === 2, 'se intentó enviar el segundo correo');

    // 3) La bandeja del admin muestra ambos y marca cuál no salió.
    const admin = cliente();
    const login = await admin('POST', '/login', { usuario: 'admin', password: 'Admin123' });
    assert(login.status === 302 || login.status === 200, 'el admin inicia sesión en la app de prueba');
    const bandeja = await admin('GET', '/admin/mensajes');
    const trozos = bandeja.text.split('<article').filter((t) => t.includes(marca));
    assert(trozos.length === 2, 'la bandeja guarda los dos mensajes');
    const delOk = trozos.find((t) => t.includes('laura@correo.com'));
    const delFallo = trozos.find((t) => t.includes('pedro@correo.com'));
    assert(delOk.includes('Correo enviado'), 'el mensaje que salió se marca como "Correo enviado"');
    assert(delFallo.includes('Correo no enviado') && delFallo.includes('Resend respondió 500'), 'el mensaje que falló se marca como "Correo no enviado" con el motivo');

    // 4) Límite por IP: 5 mensajes y el sexto se frena.
    responder = () => ({ status: 200, cuerpo: '{}' });
    for (let i = 3; i <= 5; i += 1) {
      const r = await pedir('POST', '/contacto', { nombre: 'Tester ' + i, email: `t${i}@correo.com`, mensaje: `Mensaje ${i} ${marca}` });
      assert(r.status === 200 && r.text.includes('Mensaje enviado correctamente'), `mensaje ${i} de 5 aceptado`);
    }
    const sexto = await pedir('POST', '/contacto', { nombre: 'Tester 6', email: 't6@correo.com', mensaje: 'Mensaje 6 ' + marca });
    assert(sexto.status === 429 && sexto.text.includes('varios mensajes seguidos'), 'el sexto mensaje seguido se frena con 429');
    assert(recibidos.length === 5, 'el mensaje frenado no llegó a la API de correo');

    // 5) Limpieza: borra los mensajes de prueba de la base.
    const lista = await admin('GET', '/admin/mensajes');
    const ids = lista.text.split('<article').filter((t) => t.includes(marca)).map((t) => (t.match(/\/admin\/mensajes\/(\d+)\/eliminar/) || [])[1]).filter(Boolean);
    for (const id of ids) await admin('POST', `/admin/mensajes/${id}/eliminar`);
    const final = await admin('GET', '/admin/mensajes');
    assert(!final.text.includes(marca), 'los mensajes de prueba se eliminaron');

    console.log('Envío de correo verificado con el servidor falso.');
  } catch (error) {
    process.exitCode = 1;
    console.error(error.message);
    if (logApp) console.error('--- log de la app ---\n' + logApp.slice(-1500));
  } finally {
    app.kill();
    stub.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
