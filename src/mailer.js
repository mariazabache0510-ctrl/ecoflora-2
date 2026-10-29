// Envío de los mensajes del formulario de contacto a tu correo.
// Render gratis bloquea SMTP, así que se usa la API web de Resend (HTTPS, puerto 443).

const { destinoCorreo, whatsappDe } = require('./contacto');
const { escapeHtml, nl2br, formatPrice } = require('./helpers');

const TIEMPO_MAXIMO_MS = 8000;
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function urlApi() {
  return process.env.RESEND_API_URL || 'https://api.resend.com/emails';
}

function remitente() {
  return process.env.CONTACT_FROM_EMAIL || 'EcoFlora <onboarding@resend.dev>';
}

function fechaColombia(fecha) {
  return new Date(fecha || Date.now()).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function limpiarLinea(texto, largo) {
  return String(texto || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, largo);
}

function armarCorreo(mensaje) {
  const nombre = limpiarLinea(mensaje.nombre, 100);
  const asunto = limpiarLinea(mensaje.asunto, 120);
  const telefono = limpiarLinea(mensaje.telefono, 30);
  const fecha = fechaColombia(mensaje.fecha);
  const whatsapp = whatsappDe(telefono, `Hola ${nombre}, te escribimos de EcoFlora.`);

  const subject = `[EcoFlora] ${asunto || 'Nuevo mensaje de contacto'} - ${nombre}`.slice(0, 200);

  const texto = [
    'Nuevo mensaje desde el formulario de contacto de EcoFlora',
    '',
    `Nombre:   ${nombre}`,
    `Correo:   ${mensaje.email}`,
    `Teléfono: ${telefono || 'No indicado'}`,
    `Asunto:   ${asunto || 'Sin asunto'}`,
    `Fecha:    ${fecha}`,
    '',
    'Mensaje:',
    String(mensaje.mensaje || ''),
    '',
    `Para responder, usa "Responder" en este correo: le escribirás directo a ${nombre} (${mensaje.email}).`,
    whatsapp ? `WhatsApp: ${whatsapp}` : ''
  ].filter((linea, indice, lista) => linea !== '' || lista[indice - 1] !== '').join('\n');

  const fila = (etiqueta, valor) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#52705f;font-weight:600;white-space:nowrap;vertical-align:top">${etiqueta}</td><td style="padding:6px 0;color:#1b4332">${valor}</td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;background:#eef7f0;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:linear-gradient(135deg,#1b4332,#2d6a4f);color:#fff;padding:20px 24px;border-radius:16px 16px 0 0">
    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.8">EcoFlora Vivero</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px">Nuevo mensaje de contacto</div>
  </div>
  <div style="background:#fff;padding:22px 24px;border-radius:0 0 16px 16px;box-shadow:0 8px 24px rgba(27,67,50,.12)">
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      ${fila('Nombre', escapeHtml(nombre))}
      ${fila('Correo', `<a href="mailto:${escapeHtml(mensaje.email)}" style="color:#2d6a4f">${escapeHtml(mensaje.email)}</a>`)}
      ${fila('Teléfono', telefono ? escapeHtml(telefono) : 'No indicado')}
      ${fila('Asunto', asunto ? escapeHtml(asunto) : 'Sin asunto')}
      ${fila('Fecha', escapeHtml(fecha))}
    </table>
    <div style="margin:18px 0 6px;color:#52705f;font-weight:600;font-size:14px">Mensaje</div>
    <div style="background:#f3faf5;border-left:4px solid #52b788;padding:14px 16px;border-radius:8px;color:#1b4332;font-size:15px;line-height:1.55">${nl2br(mensaje.mensaje)}</div>
    <p style="margin:18px 0 0;font-size:13px;color:#52705f">Pulsa <strong>Responder</strong> en tu correo para escribirle directo a ${escapeHtml(nombre)}.</p>
    ${whatsapp ? `<p style="margin:12px 0 0"><a href="${escapeHtml(whatsapp)}" style="display:inline-block;background:#25d366;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:999px;font-size:14px">Responder por WhatsApp</a></p>` : ''}
  </div>
</div></body></html>`;

  return {
    from: remitente(),
    to: [destinoCorreo()],
    reply_to: String(mensaje.email),
    subject,
    text: texto,
    html
  };
}

// Dirección pública del sitio (Render la define sola en RENDER_EXTERNAL_URL) para los enlaces del correo.
function urlPublica() {
  const url = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(url) ? url : '';
}

function dinero(valor) {
  return '$' + formatPrice(valor);
}

// Correo para ti cuando un cliente solicita un domicilio: quién es, a dónde llevarlo y qué pidió.
function armarCorreoDomicilio(pedido, cliente) {
  const datosCliente = cliente || {};
  const id = pedido.id_pedido;
  const nombre = limpiarLinea(datosCliente.nombre, 100) || 'Cliente';
  const usuario = limpiarLinea(datosCliente.usuario, 60);
  const emailCliente = limpiarLinea(datosCliente.email, 150);
  const telefonoCuenta = limpiarLinea(datosCliente.telefono, 30);
  const telefono = limpiarLinea(pedido.telefono_contacto, 30);
  const direccion = limpiarLinea(pedido.direccion_envio, 200);
  const ciudad = limpiarLinea(pedido.ciudad_envio, 100);
  const notas = String(pedido.notas || '').trim();
  const fecha = fechaColombia(pedido.fecha_pedido);
  const total = dinero(pedido.total);
  const lineas = Array.isArray(pedido.detalle) ? pedido.detalle : [];
  const whatsapp = whatsappDe(telefono, `Hola ${nombre}, recibimos tu pedido #${id} en EcoFlora.`);
  const panel = urlPublica() ? `${urlPublica()}/admin/pedidos` : '';
  const lugar = [direccion, ciudad].filter(Boolean).join(', ');

  const subject = `[EcoFlora] Nuevo domicilio #${id} - ${nombre} (${total})`.slice(0, 200);

  const texto = [
    `Nuevo domicilio solicitado en EcoFlora (pedido #${id})`,
    '',
    `Cliente:   ${nombre}${usuario ? ` (usuario: ${usuario})` : ''}`,
    `Correo:    ${emailCliente || 'No indicado'}`,
    `Teléfono de la cuenta: ${telefonoCuenta || 'No indicado'}`,
    `Fecha:     ${fecha}`,
    '',
    'Datos de entrega',
    `Dirección: ${lugar || 'No indicada'}`,
    `Teléfono de contacto: ${telefono || 'No indicado'}`,
    `Notas:     ${notas || 'Sin notas'}`,
    '',
    'Plantas pedidas',
    ...lineas.map((linea) => `- ${linea.cantidad} x ${linea.nombre}  ${dinero(linea.precio_unitario)} c/u = ${dinero(linea.precio_unitario * linea.cantidad)}`),
    '',
    `TOTAL: ${total}`,
    '',
    whatsapp ? `Escribirle por WhatsApp: ${whatsapp}` : '',
    panel ? `Ver y actualizar el pedido: ${panel}` : ''
  ].filter((linea, indice, lista) => linea !== '' || lista[indice - 1] !== '').join('\n');

  const fila = (etiqueta, valor) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#52705f;font-weight:600;white-space:nowrap;vertical-align:top">${etiqueta}</td><td style="padding:6px 0;color:#1b4332">${valor}</td></tr>`;
  const celda = (contenido, extra = '') => `<td style="padding:8px 6px;border-bottom:1px solid #e3efe7;color:#1b4332;font-size:14px;${extra}">${contenido}</td>`;

  const filasPlantas = lineas.map((linea) =>
    `<tr>${celda(escapeHtml(linea.nombre))}${celda(escapeHtml(linea.cantidad), 'text-align:center')}${celda(dinero(linea.precio_unitario), 'text-align:right;white-space:nowrap')}${celda(`<strong>${dinero(linea.precio_unitario * linea.cantidad)}</strong>`, 'text-align:right;white-space:nowrap')}</tr>`
  ).join('');

  const boton = (enlace, etiquetaBoton, color) =>
    `<a href="${escapeHtml(enlace)}" style="display:inline-block;margin:0 8px 8px 0;background:${color};color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:999px;font-size:14px">${etiquetaBoton}</a>`;

  const html = `<!doctype html><html><body style="margin:0;background:#eef7f0;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <div style="background:linear-gradient(135deg,#bc6c25,#e9a23b);color:#fff;padding:20px 24px;border-radius:16px 16px 0 0">
    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.9">EcoFlora Vivero</div>
    <div style="font-size:22px;font-weight:700;margin-top:4px">Nuevo domicilio #${escapeHtml(id)}</div>
    <div style="font-size:14px;margin-top:2px;opacity:.95">${escapeHtml(nombre)} pidió por ${escapeHtml(total)}</div>
  </div>
  <div style="background:#fff;padding:22px 24px;border-radius:0 0 16px 16px;box-shadow:0 8px 24px rgba(27,67,50,.12)">
    <div style="color:#bc6c25;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Cliente</div>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      ${fila('Nombre', escapeHtml(nombre) + (usuario ? ` <span style="color:#52705f">(${escapeHtml(usuario)})</span>` : ''))}
      ${fila('Correo', emailCliente ? `<a href="mailto:${escapeHtml(emailCliente)}" style="color:#2d6a4f">${escapeHtml(emailCliente)}</a>` : 'No indicado')}
      ${fila('Tel. de la cuenta', telefonoCuenta ? escapeHtml(telefonoCuenta) : 'No indicado')}
      ${fila('Fecha', escapeHtml(fecha))}
    </table>
    <div style="color:#bc6c25;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin:18px 0 6px">Datos de entrega</div>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      ${fila('Dirección', lugar ? escapeHtml(lugar) : 'No indicada')}
      ${fila('Teléfono', telefono ? `<a href="tel:${escapeHtml(telefono.replace(/[^\d+]/g, ''))}" style="color:#2d6a4f">${escapeHtml(telefono)}</a>` : 'No indicado')}
      ${fila('Notas', notas ? nl2br(notas) : 'Sin notas')}
    </table>
    <div style="color:#bc6c25;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin:18px 0 6px">Plantas pedidas</div>
    <table style="border-collapse:collapse;width:100%">
      <tr>${celda('<strong>Planta</strong>')}${celda('<strong>Cant.</strong>', 'text-align:center')}${celda('<strong>Precio</strong>', 'text-align:right')}${celda('<strong>Subtotal</strong>', 'text-align:right')}</tr>
      ${filasPlantas}
      <tr><td colspan="3" style="padding:12px 6px 4px;text-align:right;color:#52705f;font-weight:600">Total</td><td style="padding:12px 6px 4px;text-align:right;color:#1b4332;font-size:18px;font-weight:800;white-space:nowrap">${escapeHtml(total)}</td></tr>
    </table>
    <div style="margin-top:20px">
      ${whatsapp ? boton(whatsapp, 'Escribirle por WhatsApp', '#25d366') : ''}
      ${panel ? boton(panel, 'Ver y actualizar el pedido', '#2d6a4f') : ''}
    </div>
    <p style="margin:6px 0 0;font-size:13px;color:#52705f">Pulsa <strong>Responder</strong> en tu correo para escribirle al cliente a ${emailCliente ? escapeHtml(emailCliente) : 'su correo'}.</p>
  </div>
</div></body></html>`;

  const correo = { from: remitente(), to: [destinoCorreo()], subject, text: texto, html };
  if (CORREO_VALIDO.test(emailCliente)) correo.reply_to = emailCliente;
  return correo;
}

// Envía el correo por Resend. Devuelve { enviado: true } o { enviado: false, motivo }. Nunca lanza.
async function enviarPorResend(correo) {
  const clave = process.env.RESEND_API_KEY;
  if (!clave) return { enviado: false, motivo: 'RESEND_API_KEY no está configurada' };

  try {
    const respuesta = await fetch(urlApi(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(correo),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS)
    });
    if (!respuesta.ok) {
      const detalle = (await respuesta.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      return { enviado: false, motivo: `Resend respondió ${respuesta.status}: ${detalle}` };
    }
    return { enviado: true };
  } catch (error) {
    const motivo = error && error.name === 'TimeoutError' ? 'tiempo de espera agotado' : (error && error.message) || 'error desconocido';
    return { enviado: false, motivo };
  }
}

function armarYEnviar(armar) {
  let correo;
  try {
    correo = armar();
  } catch (error) {
    return Promise.resolve({ enviado: false, motivo: (error && error.message) || 'no se pudo armar el correo' });
  }
  return enviarPorResend(correo);
}

// Si el correo falla, el mensaje o el pedido ya quedaron guardados en la base y se ven en el panel de administrador.
function enviarMensajeContacto(mensaje) {
  return armarYEnviar(() => armarCorreo(mensaje));
}

function enviarAvisoDomicilio(pedido, cliente) {
  return armarYEnviar(() => armarCorreoDomicilio(pedido, cliente));
}

module.exports = { enviarMensajeContacto, enviarAvisoDomicilio, armarCorreo, armarCorreoDomicilio, fechaColombia };
