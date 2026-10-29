// Envío de los mensajes del formulario de contacto a tu correo.
// Render gratis bloquea SMTP, así que se usa la API web de Resend (HTTPS, puerto 443).

const { destinoCorreo, whatsappDe } = require('./contacto');
const { escapeHtml, nl2br } = require('./helpers');

const TIEMPO_MAXIMO_MS = 8000;

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

// Devuelve { enviado: true } o { enviado: false, motivo }. Nunca lanza: si el correo falla, el
// mensaje ya quedó guardado en la base y se puede leer desde el panel de administrador.
async function enviarMensajeContacto(mensaje) {
  const clave = process.env.RESEND_API_KEY;
  if (!clave) return { enviado: false, motivo: 'RESEND_API_KEY no está configurada' };

  try {
    const respuesta = await fetch(urlApi(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(armarCorreo(mensaje)),
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

module.exports = { enviarMensajeContacto, armarCorreo, fechaColombia };
