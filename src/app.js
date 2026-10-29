const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const { Historial, nextId } = require('./models');
const { cartCount } = require('./cart');
const { registerRoutes } = require('./routes');
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

  app.locals.formatPrice = formatPrice;
  app.locals.nl2br = nl2br;
  app.locals.excerpt = excerpt;
  app.locals.ucfirst = ucfirst;
  app.locals.formatDate = formatDate;
  app.locals.plantImage = plantImage;
  app.locals.plantImg = plantImg;
  app.locals.ESTADOS = ESTADOS;
  app.locals.COLORES_ESTADO = COLORES_ESTADO;
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

  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}img${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    }
  }));
  app.use(session({
    secret: process.env.SESSION_SECRET || 'ecoflora-dev-secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      client: mongoose.connection.getClient()
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  }));

  app.use(async (req, res, next) => {
    try {
      res.locals.year = new Date().getFullYear();
      res.locals.sesion = req.session.id_usuario ? req.session : null;
      res.locals.items_carrito = await cartCount(req);
      res.locals.currentPath = req.path;
      res.locals.queryError = typeof req.query.error === 'string' ? req.query.error : '';
      next();
    } catch (error) {
      next(error);
    }
  });

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
    console.error(error);
    if (res.headersSent) return next(error);
    res.status(500).send('Error interno del servidor.');
  });

  return app;
}

module.exports = { createApp };
