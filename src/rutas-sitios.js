// Rutas de "Sitios de interés" (Parte 3): la página con el mapa y la API que guarda en CockroachDB.

const express = require('express');
const { Usuario } = require('./models');
const { crearLimitador } = require('./limite');
const sitios = require('./sitios');

const DIEZ_MINUTOS = 10 * 60 * 1000;
const limiteCrear = crearLimitador({ max: 30, ventanaMs: DIEZ_MINUTOS });
const limiteBorrar = crearLimitador({ max: 60, ventanaMs: DIEZ_MINUTOS });

const MENSAJE_NO_DISPONIBLE = 'Los sitios de interés todavía no están disponibles en este sitio.';
const MENSAJE_BASE_CAIDA = 'No pudimos conectarnos con la base de datos de sitios. Inténtalo de nuevo en un momento.';

const leerJson = [
  express.json({ limit: '4kb' }),
  (error, req, res, next) => res.status(400).json({ ok: false, error: 'La solicitud no es válida. Recarga la página e inténtalo otra vez.' })
];

function requireLoginPagina(req, res, next) {
  if (!req.session.id_usuario) return res.redirect('/login');
  return next();
}

function requireLoginJson(req, res, next) {
  if (!req.session.id_usuario) {
    return res.status(401).json({ ok: false, codigo: 'sin_sesion', error: 'Tu sesión terminó. Vuelve a iniciar sesión.' });
  }
  return next();
}

function requireDisponible(req, res, next) {
  if (!sitios.habilitada()) return res.status(503).json({ ok: false, codigo: 'no_disponible', error: MENSAJE_NO_DISPONIBLE });
  return next();
}

function sinCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

// Nunca se muestran detalles de la base (direcciones, usuarios) al navegador: van al log del servidor.
function fallaDeBase(res, error, accion) {
  console.error(`Sitios: falló ${accion}:`, error.message);
  return res.status(503).json({ ok: false, codigo: 'base_caida', error: MENSAJE_BASE_CAIDA });
}

async function conAutores(filas) {
  const ids = [...new Set(filas.map((fila) => fila.id_usuario))];
  const usuarios = ids.length ? await Usuario.find({ id_usuario: { $in: ids } }, { id_usuario: 1, nombre: 1, usuario: 1 }).lean() : [];
  const nombres = new Map(usuarios.map((u) => [u.id_usuario, u.nombre || u.usuario]));
  return nombres;
}

function publico(fila, sesion, nombres) {
  return {
    id: fila.id,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    categoria: fila.categoria,
    lat: fila.lat,
    lng: fila.lng,
    creado: fila.creado,
    propio: fila.id_usuario === sesion.id_usuario,
    // Solo el admin ve de quién es cada sitio.
    autor: sesion.rol === 'admin' ? (nombres.get(fila.id_usuario) || `Usuario ${fila.id_usuario}`) : undefined
  };
}

function registrarRutasSitios(app) {
  app.get('/sitios', requireLoginPagina, (req, res) => {
    // La llave de Maps NO se imprime en el HTML (así no aparece al ver el código fuente de la página).
    // El JS la pide después a /api/sitios/mapa. Aun así debe estar restringida por dominio en Google Cloud.
    res.render('sitios', {
      disponible: sitios.habilitada(),
      mapaConfigurado: /^[\w-]{20,80}$/.test(String(process.env.GOOGLE_MAPS_API_KEY || '').trim()),
      categorias: sitios.CATEGORIAS,
      esAdmin: req.session.rol === 'admin'
    });
  });

  // Entrega la llave de Maps solo a quien ya inició sesión. No se cachea.
  app.get('/api/sitios/mapa', requireLoginJson, sinCache, (req, res) => {
    const llave = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
    res.json({ ok: true, mapsKey: /^[\w-]{20,80}$/.test(llave) ? llave : '' });
  });

  app.get('/api/sitios', requireLoginJson, requireDisponible, sinCache, async (req, res) => {
    try {
      const esAdmin = req.session.rol === 'admin';
      const filas = await sitios.listar({ idUsuario: req.session.id_usuario, todos: esAdmin });
      const nombres = esAdmin ? await conAutores(filas) : new Map();
      res.json({ ok: true, esAdmin, sitios: filas.map((fila) => publico(fila, req.session, nombres)) });
    } catch (error) {
      fallaDeBase(res, error, 'la lista');
    }
  });

  app.post('/api/sitios', requireLoginJson, requireDisponible, leerJson, sinCache, async (req, res) => {
    if (!limiteCrear.permitir(`u:${req.session.id_usuario}`)) {
      return res.status(429).json({ ok: false, codigo: 'demasiados', error: 'Estás guardando sitios muy rápido. Espera unos minutos.' });
    }
    let datos;
    try {
      datos = sitios.validarSitio(req.body);
    } catch (error) {
      if (error instanceof sitios.ErrorDeSitio) return res.status(400).json({ ok: false, error: error.message });
      throw error;
    }
    try {
      const fila = await sitios.crear(req.session.id_usuario, datos);
      return res.status(201).json({ ok: true, sitio: publico(fila, req.session, new Map([[req.session.id_usuario, req.session.nombre]])) });
    } catch (error) {
      if (error instanceof sitios.ErrorDeSitio) return res.status(400).json({ ok: false, error: error.message });
      return fallaDeBase(res, error, 'el guardado');
    }
  });

  app.delete('/api/sitios/:id', requireLoginJson, requireDisponible, sinCache, async (req, res) => {
    if (!limiteBorrar.permitir(`u:${req.session.id_usuario}`)) {
      return res.status(429).json({ ok: false, codigo: 'demasiados', error: 'Demasiadas acciones seguidas. Espera unos minutos.' });
    }
    try {
      const borrado = await sitios.borrar(req.params.id, { idUsuario: req.session.id_usuario, esAdmin: req.session.rol === 'admin' });
      if (!borrado) return res.status(404).json({ ok: false, error: 'No encontramos ese sitio (o no es tuyo).' });
      return res.json({ ok: true });
    } catch (error) {
      return fallaDeBase(res, error, 'el borrado');
    }
  });
}

module.exports = { registrarRutasSitios };
