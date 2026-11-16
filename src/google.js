// "Continuar con Google" (Google Identity Services).
//
// El botón de Google le entrega al navegador una credencial: un JWT firmado por Google. Aquí NUNCA se confía en lo
// que diga el navegador: el servidor comprueba la firma con los certificados de Google, que el token sea para ESTE
// sitio (GOOGLE_CLIENT_ID), que no haya vencido y que venga de Google. Solo entonces se usa el correo que trae.
//
// Sin GOOGLE_CLIENT_ID la función queda apagada (el botón no aparece y la ruta responde 503).

const { OAuth2Client } = require('google-auth-library');

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// Un solo cliente para todo el proceso: guarda en memoria los certificados de Google y los renueva solos.
const cliente = new OAuth2Client();

function clientId() {
  return String(process.env.GOOGLE_CLIENT_ID || '').trim();
}

function disponible() {
  return Boolean(clientId());
}

// Devuelve los datos que importan del token ya verificado, o lanza un error si algo no cuadra.
async function verificarCredencial(credencial) {
  const texto = String(credencial || '');
  // Un JWT son 3 partes en base64url; un tope de tamaño evita gastar tiempo con basura.
  if (!disponible()) throw crearError('no_disponible', 'El inicio con Google no está configurado en este sitio.');
  if (texto.length < 20 || texto.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(texto)) {
    throw crearError('credencial_invalida', 'La credencial de Google no es válida.');
  }
  let ticket;
  try {
    ticket = await cliente.verifyIdToken({ idToken: texto, audience: clientId() });
  } catch (error) {
    throw crearError('credencial_invalida', 'La credencial de Google no es válida o venció. Inténtalo de nuevo.', error);
  }
  const datos = ticket.getPayload() || {};
  if (!ISSUERS.includes(datos.iss)) throw crearError('credencial_invalida', 'La credencial no viene de Google.');
  if (!datos.sub) throw crearError('credencial_invalida', 'La credencial de Google no trae identificador.');
  if (!datos.email || datos.email_verified !== true) {
    throw crearError('correo_no_verificado', 'Tu correo de Google no está verificado, así que no podemos usarlo.');
  }
  return {
    sub: String(datos.sub),
    email: String(datos.email).trim(),
    nombre: String(datos.name || datos.given_name || '').trim(),
    foto: String(datos.picture || '')
  };
}

function crearError(codigo, mensaje, causa) {
  const error = new Error(mensaje);
  error.codigo = codigo;
  if (causa) error.causa = causa;
  return error;
}

module.exports = { disponible, clientId, verificarCredencial, cliente };
