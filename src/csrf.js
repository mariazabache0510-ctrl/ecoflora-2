// Protección CSRF propia (sin librerías): evita que otra página haga, a nombre de quien tiene la sesión
// abierta, una acción que cambia datos (borrar un usuario, vaciar el carrito, hacer un pedido...).
//
//  - Cada sesión tiene un token aleatorio (crypto.randomBytes) guardado en el servidor, en req.session.csrf.
//  - Las vistas lo reciben en res.locals.csrfToken y lo ponen en un <input type="hidden" name="_csrf">.
//    El JS del rostro lo manda en el encabezado X-CSRF-Token.
//  - Todo POST/PUT/PATCH/DELETE debe traerlo, y se compara con crypto.timingSafeEqual.
//
// El token se crea solo cuando una página lo imprime (así los visitantes que no ven ningún formulario
// no generan una sesión en la base de datos).

const crypto = require('crypto');

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MENSAJE = 'La página estaba desactualizada o tu sesión venció. Recárgala e inténtalo de nuevo.';

function tokenDe(req) {
  if (!req.session) return '';
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('base64url');
  return req.session.csrf;
}

// Compara en tiempo constante (se pasan a un hash para que ambos midan lo mismo).
function iguales(esperado, recibido) {
  const a = crypto.createHash('sha256').update(String(esperado)).digest();
  const b = crypto.createHash('sha256').update(String(recibido)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Lo que reciben las vistas: un objeto que se convierte en el token solo al imprimirlo (<%= csrfToken %>).
function tokenPerezoso(req) {
  const valor = () => tokenDe(req);
  return { toString: valor, toJSON: valor, valueOf: valor };
}

function quiereJson(req) {
  const tipo = String(req.get('content-type') || '');
  const acepta = String(req.get('accept') || '');
  return /json/i.test(tipo) || (/json/i.test(acepta) && !/html/i.test(acepta)) || Boolean(req.xhr);
}

// Vuelve a la página de donde vino la persona (solo si es de este mismo sitio).
function paginaAnterior(req) {
  try {
    const url = new URL(req.get('referer') || '');
    const destino = url.pathname + url.search;
    // Solo rutas de este sitio (nada de "//otro-sitio.com" ni "/\otro-sitio.com").
    if (url.host === req.get('host') && /^\/(?![/\\])/.test(destino)) return destino;
  } catch (error) {
    // sin referer válido: se vuelve al inicio
  }
  return '/';
}

function rechazar(req, res) {
  console.warn(`CSRF: se rechazó ${req.method} ${req.path} (token ausente o inválido)`);
  if (quiereJson(req)) {
    return res.status(403).json({ ok: false, codigo: 'csrf', error: MENSAJE });
  }
  return res.status(403).render('403', { mensaje: MENSAJE, volver: paginaAnterior(req) });
}

function protegerCsrf(req, res, next) {
  res.locals.csrfToken = tokenPerezoso(req);
  if (METODOS_SEGUROS.has(req.method)) return next();
  const esperado = req.session && req.session.csrf;
  const delCuerpo = req.body && typeof req.body._csrf === 'string' ? req.body._csrf : '';
  const recibido = String(req.get('x-csrf-token') || delCuerpo || '');
  if (esperado && recibido && iguales(esperado, recibido)) return next();
  return rechazar(req, res);
}

module.exports = { protegerCsrf, tokenDe, iguales };
