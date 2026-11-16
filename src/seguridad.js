// Encabezados de seguridad (helmet) y limpieza de las entradas.
//
// Política de contenido (CSP): solo se permite lo que el sitio usa de verdad.
//  - Scripts: los propios (/js/...), el paquete de Bootstrap desde jsDelivr (con la ruta exacta) y los
//    scripts en línea que lleven el "nonce" de cada respuesta. No se permiten onclick="", onsubmit="" ni "javascript:".
//    Se permite compilar WebAssembly ('wasm-unsafe-eval') para el motor de cálculo del rostro; eval() sigue prohibido.
//  - Estilos: propios, Bootstrap y Bootstrap Icons (jsDelivr), Google Fonts y estilos en línea (style="...").
//  - Tipografías: Google Fonts y los iconos de Bootstrap Icons.
//  - Imágenes: propias (fotos de plantas) y data: (iconos pequeños). La cámara no pasa por CSP.
//  - Conexiones (fetch): al propio sitio (que también sirve la librería y los modelos del rostro) y a las APIs de Google
//    que usa el mapa de /sitios.
//  - Google (solo botón de acceso y mapa): accounts.google.com/gsi y maps.googleapis.com / maps.gstatic.com.
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
// Google: el botón "Continuar con Google" (Identity Services) y Google Maps (página /sitios). Solo estos dominios,
// y solo para lo que cada uno necesita (guías oficiales de CSP de Google).
const GOOGLE_GSI = 'https://accounts.google.com/gsi/';
const GOOGLE_MAPS_SCRIPTS = ['https://maps.googleapis.com', 'https://maps.gstatic.com'];

// Un valor al azar por respuesta: solo los <script nonce="..."> de nuestras vistas lo conocen.
function nonceDeCsp(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
}

function permisos(req, res, next) {
  // La cámara solo para este sitio (inicio con rostro); el resto de funciones del navegador, apagadas.
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=()');
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
          // 'wasm-unsafe-eval' solo permite compilar WebAssembly (el motor de cálculo del rostro); NO permite eval().
          scriptSrc: ["'self'", "'wasm-unsafe-eval'", BOOTSTRAP_JS, `${GOOGLE_GSI}client`, ...GOOGLE_MAPS_SCRIPTS, (req, res) => `'nonce-${res.locals.cspNonce}'`],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'", BOOTSTRAP_CSS, `${ICONOS_RUTA}bootstrap-icons.min.css`, 'https://fonts.googleapis.com/css2', 'https://fonts.googleapis.com/css', `${GOOGLE_GSI}style`],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', `${ICONOS_RUTA}fonts/`],
          imgSrc: ["'self'", 'data:', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.googleusercontent.com'],
          connectSrc: ["'self'", 'https://*.googleapis.com', GOOGLE_GSI],
          frameSrc: [GOOGLE_GSI],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          // Solo en producción (https). En tu computador, con http, forzarlo rompería la carga de todo.
          ...(produccion ? { upgradeInsecureRequests: [] } : {})
        }
      },
      // HSTS: el navegador no vuelve a abrir el sitio por http (180 días). Solo en producción.
      // Sin includeSubDomains: así no afecta a otros subdominios que algún día uses con tu dominio propio.
      strictTransportSecurity: produccion ? { maxAge: 15552000, includeSubDomains: false } : false,
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
