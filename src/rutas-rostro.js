// Rutas del inicio de sesión con rostro.
//
// El navegador hace la parte de cámara e IA (face-api) y envía solo el descriptor: 128 números.
// Aquí se valida, se guarda cifrado y se compara. Nunca llega ni se guarda una foto.

const express = require('express');
const { Usuario, RostroUsuario } = require('./models');
const { verifyPassword } = require('./passwords');
const { crearLimitador } = require('./limite');
const rostro = require('./rostro');

const DIEZ_MINUTOS = 10 * 60 * 1000;
// Probar contraseñas desde la pantalla de "activar rostro" también tiene límite.
const limiteAutorizar = crearLimitador({ max: 6, ventanaMs: DIEZ_MINUTOS });
const limiteRegistro = crearLimitador({ max: 10, ventanaMs: DIEZ_MINUTOS });

const AUTORIZACION_VIGENCIA_MS = 10 * 60 * 1000;

const MENSAJES_DESAFIO = {
  sin_desafio: 'No encontramos tu reto de seguridad. Empieza de nuevo.',
  vencido: 'Se acabó el tiempo del reto. Empieza de nuevo.',
  muy_rapido: 'Eso fue demasiado rápido. Inténtalo de nuevo con calma.'
};

// Analiza JSON (solo en estas rutas). Si llega algo roto responde con un mensaje claro.
const leerJson = [
  express.json({ limit: '32kb' }),
  (error, req, res, next) => res.status(400).json({ ok: false, error: 'La solicitud no es válida. Recarga la página e inténtalo otra vez.' })
];

function requireLoginJson(req, res, next) {
  if (!req.session.id_usuario) {
    return res.status(401).json({ ok: false, codigo: 'sin_sesion', error: 'Tu sesión terminó. Vuelve a iniciar sesión.' });
  }
  return next();
}

function requireLogin(req, res, next) {
  if (!req.session.id_usuario) return res.redirect('/login');
  return next();
}

function requireDisponible(req, res, next) {
  if (!rostro.disponible()) {
    return res.status(503).json({ ok: false, codigo: 'no_disponible', error: 'El inicio con rostro todavía no está disponible en este sitio.' });
  }
  return next();
}

function autorizacionVigente(req) {
  const autorizacion = req.session.rostro_autorizacion;
  return autorizacion && autorizacion.hasta > Date.now() ? autorizacion : null;
}

function registrarRutasRostro(app) {
  app.get('/privacidad', (req, res) => {
    res.render('privacidad');
  });

  app.get('/rostro', requireLogin, async (req, res, next) => {
    try {
      const registro = await RostroUsuario.findOne({ id_usuario: req.session.id_usuario }).lean();
      res.render('rostro', {
        disponible: rostro.disponible(),
        activo: Boolean(registro),
        desde: registro ? registro.fecha_registro : null,
        bienvenida: req.query.bienvenida === '1',
        activado: req.query.activado === '1',
        eliminado: req.query.eliminado === '1',
        versionConsentimiento: rostro.VERSION_CONSENTIMIENTO
      });
    } catch (error) {
      next(error);
    }
  });

  // Paso 1: la persona acepta la autorización (Ley 1581) y confirma su contraseña.
  app.post('/rostro/autorizar', requireLoginJson, requireDisponible, ...leerJson, async (req, res, next) => {
    try {
      const idUsuario = req.session.id_usuario;
      if (!limiteAutorizar.permitir(`u${idUsuario}`)) {
        return res.status(429).json({ ok: false, codigo: 'demasiados_intentos', error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' });
      }
      const { clave, consentimiento } = req.body || {};
      if (consentimiento !== true) {
        return res.status(400).json({ ok: false, codigo: 'sin_consentimiento', error: 'Para continuar debes aceptar la autorización de tratamiento de datos biométricos.' });
      }
      const usuario = await Usuario.findOne({ id_usuario: idUsuario });
      if (!usuario || !(await verifyPassword(String(clave || ''), usuario.password))) {
        return res.status(403).json({ ok: false, codigo: 'clave_incorrecta', error: 'La contraseña no es correcta.' });
      }
      req.session.rostro_autorizacion = {
        hasta: Date.now() + AUTORIZACION_VIGENCIA_MS,
        aceptado: Date.now(),
        version: rostro.VERSION_CONSENTIMIENTO
      };
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  // Paso 2: el servidor entrega un reto de prueba de vida de un solo uso.
  app.post('/rostro/desafio', requireLoginJson, requireDisponible, ...leerJson, (req, res) => {
    if (!autorizacionVigente(req)) {
      return res.status(403).json({ ok: false, codigo: 'sin_autorizacion', error: 'Primero acepta la autorización y confirma tu contraseña.' });
    }
    return res.json({ ok: true, desafio: rostro.crearDesafio(req, 'registro') });
  });

  // Paso 3: llegan los descriptores (nunca fotos). Se validan y se guardan cifrados.
  app.post('/rostro/registro', requireLoginJson, requireDisponible, ...leerJson, async (req, res, next) => {
    try {
      const idUsuario = req.session.id_usuario;
      const autorizacion = autorizacionVigente(req);
      if (!autorizacion) {
        return res.status(403).json({ ok: false, codigo: 'sin_autorizacion', error: 'Primero acepta la autorización y confirma tu contraseña.' });
      }
      if (!limiteRegistro.permitir(`u${idUsuario}`)) {
        return res.status(429).json({ ok: false, codigo: 'demasiados_intentos', error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' });
      }
      const { desafio, descriptores } = req.body || {};
      const reto = rostro.consumirDesafio(req, desafio, 'registro');
      if (!reto.ok) {
        return res.status(400).json({ ok: false, codigo: `desafio_${reto.motivo}`, error: MENSAJES_DESAFIO[reto.motivo] });
      }
      if (
        !Array.isArray(descriptores)
        || descriptores.length < rostro.MIN_DESCRIPTORES
        || descriptores.length > rostro.MAX_DESCRIPTORES
        || !descriptores.every(rostro.descriptorValido)
      ) {
        return res.status(400).json({ ok: false, codigo: 'descriptor_invalido', error: 'No pudimos leer bien tu rostro. Inténtalo de nuevo con buena luz.' });
      }
      if (!rostro.capturasConsistentes(descriptores)) {
        return res.status(422).json({ ok: false, codigo: 'captura_inestable', error: 'La captura salió inestable. Mantén la cabeza quieta, de frente y con buena luz, e inténtalo otra vez.' });
      }
      await RostroUsuario.findOneAndUpdate(
        { id_usuario: idUsuario },
        {
          $set: {
            descriptores: descriptores.map(rostro.cifrar),
            algoritmo: 'face-api-128',
            consentimiento_fecha: new Date(autorizacion.aceptado),
            consentimiento_version: autorizacion.version,
            fecha_registro: new Date(),
            ultimo_uso: null
          }
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
      delete req.session.rostro_autorizacion;
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  // Desactivar: se borra el rostro guardado (derecho a suprimir el dato).
  app.post('/rostro/eliminar', requireLogin, async (req, res, next) => {
    try {
      await RostroUsuario.deleteOne({ id_usuario: req.session.id_usuario });
      res.redirect('/rostro?eliminado=1');
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registrarRutasRostro, leerJson, requireDisponible };
