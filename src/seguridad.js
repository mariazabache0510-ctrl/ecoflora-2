// Encabezados de seguridad (helmet) y limpieza de las entradas.
//
// Política de contenido (CSP): solo se permite lo que el sitio usa de verdad.
//  - Scripts: los propios (/js/...), el paquete de Bootstrap desde jsDelivr (con la ruta exacta) y los
//    scripts en línea que lleven el "nonce" de cada respuesta. No se permiten onclick="", onsubmit="" ni "javascript:".
//  - Estilos: propios, Bootstrap y Bootstrap Icons (jsDelivr), Google Fonts y estilos en línea (style="...").
//  - Tipografías: Google Fonts y los iconos de Bootstrap Icons.
//  - Imágenes: propias (fotos de plantas) y data: (iconos pequeños). La cámara no pasa por CSP.
//  - Conexiones (fetch): solo al propio sitio, que también sirve la librería y los modelos del rostro.
//  - Nadie puede meter el sitio dentro de otra página (frame-ancestors 'none') ni enviar formularios a otro sitio.
// Si algún día cambias la versión de Bootstrap en views/partials, actualiza también las rutas de abajo.

const crypto = require('crypto');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const { esProduccion } = require('./entorno');

const JSDELIVR = 'https://cdn.jsdelivr.net';
const BOOTSTRAP_JS = `${JSDELIVR}/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js`;
const BOOTSTRAP_CSS = `${JSDELIVR}/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css`;
const ICONOS_RUTA = `${JSDELIVR}/npm/bootstrap-icons@1.11.3/font/`;

// Un valor al azar por respuesta: solo los <script nonce="..."> de nuestras vistas lo conocen.
function nonceDeCsp(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
}

function permisos(req, res, next) {
  // La cámara solo para este sitio (inicio con rostro); el resto de funciones del navegador, apagadas.
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
  next();
}

function encabezadosDeSeguridad() {
  const produccion = esProduccion();
  return [
    nonceDeCsp,
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          scriptSrc: ["'self'", BOOTSTRAP_JS, (req, res) => `'nonce-${res.locals.cspNonce}'`],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'", BOOTSTRAP_CSS, `${ICONOS_RUTA}bootstrap-icons.min.css`, 'https://fonts.googleapis.com/css2'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', `${ICONOS_RUTA}fonts/`],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          // Solo en producción (https). En tu computador, con http, forzarlo rompería la carga de todo.
          ...(produccion ? { upgradeInsecureRequests: [] } : {})
        }
      },
      // HSTS: el navegador no vuelve a abrir el sitio por http. Solo en producción.
      strictTransportSecurity: produccion ? { maxAge: 15552000 } : false,
      xFrameOptions: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    }),
    permisos
  ];
}

// Quita de lo que llega (cuerpo, URL) las claves que empiezan con "$" o llevan "." : así nadie puede
// colar operadores de MongoDB ({ "$ne": ... }) en una consulta. Es una capa extra: el código ya convierte todo a texto.
function limpiarEntradas() {
  return mongoSanitize({
    onSanitize: ({ req, key }) => {
      console.warn(`Entrada sanitizada en ${req.method} ${req.path}: se quitó la clave "${key}"`);
    }
  });
}

module.exports = { encabezadosDeSeguridad, limpiarEntradas };
