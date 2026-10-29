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

    // 5) Domicilio: cuando un cliente pide un domicilio, te llega un correo con todos sus datos.
    const esperarLlamadas = async (cantidad) => {
      for (let i = 0; i < 40 && recibidos.length < cantidad; i += 1) await new Promise((listo) => setTimeout(listo, 100));
    };
    const usuarioPrueba = 'cli' + Date.now().toString(36);
    const correoCliente = `${usuarioPrueba}@correo.com`;
    const comprador = cliente();
    await comprador('POST', '/registro', {
      nombre: 'Sofía <i>Ramírez</i>', usuario: usuarioPrueba, email: correoCliente, telefono: '3010000000',
      direccion: 'Carrera 1', ciudad: 'Villavicencio', password: 'clave123', confirmar: 'clave123'
    });
    const entrada = await comprador('POST', '/login', { usuario: usuarioPrueba, password: 'clave123' });
    assert(entrada.status === 302, 'el cliente de prueba inicia sesión');

    responder = () => ({ status: 200, cuerpo: '{}' });
    const antes = recibidos.length;
    await comprador('POST', '/carrito', { accion: 'agregar', id_planta: '1', cantidad: '2' });
    const pedido = await comprador('POST', '/confirmar-pedido', {
      direccion: 'Calle 10 <b>#5-20</b>', ciudad: 'Villavicencio', telefono: '312 400 1111', notas: 'Dejar con el portero\nTimbre dañado ' + marca
    });
    assert(pedido.status === 302 && /exito=1/.test(pedido.location || ''), 'el cliente ve su pedido confirmado sin esperar el correo');
    await esperarLlamadas(antes + 1);
    assert(recibidos.length === antes + 1, 'al pedir un domicilio se envía un correo de aviso');
    const aviso = recibidos[recibidos.length - 1];
    const dom = aviso.json;
    assert(aviso.auth === 'Bearer llave-de-prueba', 'el aviso usa la llave de Resend');
    assert(dom.to.length === 1 && dom.to[0] === 'mariazabache0510@gmail.com', 'el aviso del domicilio llega a mariazabache0510@gmail.com');
    assert(dom.reply_to === correoCliente, 'al responder el aviso le escribes al cliente');
    const idPedido = (dom.subject.match(/domicilio #(\d+)/) || [])[1];
    assert(idPedido && dom.subject.includes('Sofía') && dom.subject.includes('$170.000') && !/[\r\n]/.test(dom.subject), 'el asunto trae número de pedido, cliente y total');
    for (const dato of ['Calle 10 <b>#5-20</b>', 'Villavicencio', '312 400 1111', 'Dejar con el portero', 'Timbre dañado', 'Monstera deliciosa', '2 x', correoCliente, usuarioPrueba, 'TOTAL: $170.000']) {
      assert(dom.text.includes(dato), `el texto del aviso incluye "${dato}"`);
    }
    assert(dom.html.includes('&lt;b&gt;#5-20&lt;/b&gt;') && !dom.html.includes('<b>#5-20'), 'el HTML del aviso escapa la dirección');
    assert(dom.html.includes('&lt;i&gt;Ram') && !dom.html.includes('<i>Ram'), 'el HTML del aviso escapa el nombre');
    assert(dom.html.includes('https://wa.me/573124001111'), 'el aviso incluye el botón de WhatsApp al teléfono del pedido');
    assert(dom.html.includes('$170.000') && dom.html.includes('Monstera deliciosa'), 'el aviso lista las plantas y el total');

    // El panel de pedidos muestra el aviso como enviado y los datos de entrega.
    let panelPedidos = '';
    for (let i = 0; i < 30; i += 1) {
      panelPedidos = (await admin('GET', '/admin/pedidos')).text;
      if (panelPedidos.includes('Aviso enviado')) break;
      await new Promise((listo) => setTimeout(listo, 100));
    }
    const filaDetalle = panelPedidos.split('<tr class="fila-pedido"').find((t) => t.includes(`name="id_pedido" value="${idPedido}"`)) || '';
    assert(filaDetalle.includes('Aviso enviado'), 'el panel marca el aviso del domicilio como enviado');
    assert(filaDetalle.includes('Calle 10 &lt;b&gt;#5-20&lt;/b&gt;') && filaDetalle.includes('Dejar con el portero') && filaDetalle.includes('2 × Monstera deliciosa'), 'el panel muestra dirección, notas y plantas');
    assert(filaDetalle.includes('https://wa.me/573124001111'), 'el panel permite escribirle al cliente por WhatsApp');

    // Si Resend falla, el pedido igual se hace y el panel avisa que el correo no salió.
    responder = () => ({ status: 500, cuerpo: '{"message":"boom"}' });
    await comprador('POST', '/carrito', { accion: 'agregar', id_planta: '1', cantidad: '1' });
    const fallido = await comprador('POST', '/confirmar-pedido', { direccion: 'Calle 99', ciudad: 'Acacías', telefono: '3125550000', notas: '' });
    assert(fallido.status === 302 && /exito=1/.test(fallido.location || ''), 'si falla el correo, el cliente igual ve su pedido confirmado');
    await esperarLlamadas(antes + 2);
    let panel2 = '';
    for (let i = 0; i < 30; i += 1) {
      panel2 = (await admin('GET', '/admin/pedidos')).text;
      if (panel2.includes('Aviso no enviado')) break;
      await new Promise((listo) => setTimeout(listo, 100));
    }
    assert(panel2.includes('Aviso no enviado') && panel2.includes('Resend respondió 500'), 'el panel marca "Aviso no enviado" con el motivo');
    assert(panel2.includes('Calle 99'), 'el pedido con aviso fallido sigue visible con su dirección');
    responder = () => ({ status: 200, cuerpo: '{}' });

    // 6) Limpieza: borra los mensajes de prueba de la base.
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
