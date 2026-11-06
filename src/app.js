const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const { Historial, nextId } = require('./models');
const { cartCount } = require('./cart');
const { registerRoutes } = require('./routes');
const { contacto, whatsappDe } = require('./contacto');
const { fechaColombia } = require('./mailer');
const rostro = require('./rostro');
const { NOMBRE_COOKIE, secretoDeSesion, opcionesCookie } = require('./entorno');
const { protegerCsrf } = require('./csrf');
const { encabezadosDeSeguridad, limpiarEntradas } = require('./seguridad');
const {
  formatPrice,
  nl2br,
  excerpt,
  ucfirst,
  formatDate,
  plantImage,
  plantImg,
  pageName,
  ESTADOS,
  COLORES_ESTADO
} = require('./helpers');

const viewsDir = path.join(__dirname, '..', 'views');

// Modelos de @vladmandic/face-api que usa el inicio de sesión con rostro (detector pequeño,
// 68 puntos de la cara y reconocimiento). Los demás modelos de la librería no se publican.
const MODELOS_ROSTRO = new Set([
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin'
]);

function shouldRecord(req) {
  if (req.method !== 'GET') return false;
  if (req.get('x-requested-with')) return false;
  if (req.path === '/health' || req.path === '/logout') return false;
  if (path.extname(req.path)) return false;
  const accept = req.get('accept') || '';
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return false;
  return true;
}

async function recordHistory(req) {
  const id = await nextId('historial');
  await Historial.create({
    id_historial: id,
    id_usuario: req.session && req.session.id_usuario ? req.session.id_usuario : null,
    ip_address: req.ip || '',
    pagina: pageName(req),
    url: req.originalUrl || req.url,
    fecha_visita: new Date()
  });
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', viewsDir);
  app.disable('x-powered-by');

  // Encabezados de seguridad (CSP, HSTS en producción, anti-iframe...) en todas las respuestas.
  app.use(encabezadosDeSeguridad());

  app.locals.formatPrice = formatPrice;
  app.locals.nl2br = nl2br;
  app.locals.excerpt = excerpt;
  app.locals.ucfirst = ucfirst;
  app.locals.formatDate = formatDate;
  app.locals.plantImage = plantImage;
  app.locals.plantImg = plantImg;
  app.locals.ESTADOS = ESTADOS;
  app.locals.COLORES_ESTADO = COLORES_ESTADO;
  app.locals.contacto = contacto;
  app.locals.whatsappDe = whatsappDe;
  app.locals.fechaColombia = fechaColombia;
  app.locals.partial = (name) => path.join(viewsDir, 'partials', `${name}.ejs`);

  app.get('/health', async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) throw new Error('sin conexión');
      await mongoose.connection.db.admin().ping();
      res.status(200).type('text/plain').send('ok');
    } catch (error) {
      res.status(503).type('text/plain').send('no disponible');
    }
  });

  // Los formularios del sitio son pequeños: 20 KB y 200 campos de sobra. (El JSON del rostro tiene su propio
  // tope en src/rutas-rostro.js: 32 KB, y 5 descriptores de 128 números pesan menos de 10 KB.)
  app.use(express.urlencoded({ extended: true, limit: '20kb', parameterLimit: 200 }));
  app.use(limpiarEntradas());

  // Reconocimiento facial: la librería y sus 3 modelos salen de node_modules (no hay que descargar
  // nada a mano). Solo se sirven los archivos necesarios y quedan en la caché del navegador.
  const carpetaFaceApi = path.dirname(require.resolve('@vladmandic/face-api/package.json'));
  const CACHE_LARGA = 'public, max-age=2592000';
  app.get('/vendor/face-api/face-api.js', (req, res) => {
    res.setHeader('Cache-Control', CACHE_LARGA);
    res.sendFile(path.join(carpetaFaceApi, 'dist', 'face-api.js'));
  });
  app.get('/modelos/rostro/:archivo', (req, res, next) => {
    if (!MODELOS_ROSTRO.has(req.params.archivo)) return next();
    res.setHeader('Cache-Control', CACHE_LARGA);
    return res.sendFile(path.join(carpetaFaceApi, 'model', req.params.archivo));
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}img${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    }
  }));
  app.use(session({
    name: NOMBRE_COOKIE,
    secret: secretoDeSesion(),
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      client: mongoose.connection.getClient()
    }),
    cookie: {
      ...opcionesCookie(),
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  }));

  app.use(async (req, res, next) => {
    try {
      res.locals.year = new Date().getFullYear();
      res.locals.sesion = req.session.id_usuario ? req.session : null;
      res.locals.items_carrito = await cartCount(req);
      res.locals.currentPath = req.path;
      // El inicio con rostro solo se ofrece si el sitio tiene su clave de cifrado configurada.
      res.locals.rostroDisponible = rostro.disponible();
      res.locals.queryError = typeof req.query.error === 'string' ? req.query.error : '';
      next();
    } catch (error) {
      next(error);
    }
  });

  // CSRF: reparte el token a las vistas y exige el token correcto en todo POST (va después de las
  // variables de las vistas porque la página de rechazo también las usa).
  app.use(protegerCsrf);

  app.use(async (req, res, next) => {
    if (!shouldRecord(req, res)) return next();
    try {
      await recordHistory(req);
      return next();
    } catch (error) {
      console.error('No se pudo guardar el historial:', error.message);
      return next();
    }
  });

  registerRoutes(app);

  app.use((req, res) => {
    res.status(404).render('404');
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    // Cuerpo demasiado grande o formulario mal formado: no es un fallo del servidor.
    if (error && (error.type === 'entity.too.large' || error.type === 'parameters.too.many')) {
      return res.status(413).send('Los datos enviados son demasiado grandes.');
    }
    if (error && error.type === 'entity.parse.failed') {
      return res.status(400).send('La solicitud no es válida.');
    }
    console.error(error);
    return res.status(500).send('Error interno del servidor.');
  });

  return app;
}

module.exports = { createApp };
