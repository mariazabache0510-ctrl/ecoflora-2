// Rutas del inicio de sesión con rostro.
//
// El navegador hace la parte de cámara e IA (face-api) y envía solo el descriptor: 128 números.
// Aquí se valida, se guarda cifrado y se compara. Nunca llega ni se guarda una foto.

const express = require('express');
const { Usuario, RostroUsuario } = require('./models');
const { verifyPassword } = require('./passwords');
const { crearLimitador } = require('./limite');
const rostro = require('./rostro');
const { iniciarSesion, destinoTrasLogin } = require('./sesion');

const DIEZ_MINUTOS = 10 * 60 * 1000;
// Probar contraseñas desde la pantalla de "activar rostro" también tiene límite.
const limiteAutorizar = crearLimitador({ max: 6, ventanaMs: DIEZ_MINUTOS });
const limiteRegistro = crearLimitador({ max: 10, ventanaMs: DIEZ_MINUTOS });
// Iniciar sesión con rostro: pocos intentos por IP+usuario y por usuario (la contraseña sigue funcionando).
const limiteDesafioIp = crearLimitador({ max: 30, ventanaMs: DIEZ_MINUTOS });
const limiteDesafioUsuario = crearLimitador({ max: 20, ventanaMs: DIEZ_MINUTOS });
const limiteIntentoIp = crearLimitador({ max: 6, ventanaMs: DIEZ_MINUTOS });
const limiteIntentoUsuario = crearLimitador({ max: 12, ventanaMs: DIEZ_MINUTOS });

const COLLATION = { locale: 'es', strength: 2 };
const MENSAJE_SIN_ROSTRO = 'No encontramos el inicio con rostro para esa cuenta. Revisa el usuario, o entra con tu contraseña y actívalo desde tu perfil.';
const MENSAJE_DEMASIADOS = 'Demasiados intentos con el rostro. Espera unos minutos o entra con tu contraseña.';

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

  // ---------- Iniciar sesión con rostro (no hace falta tener sesión) ----------
  // Es una comparación 1 a 1: la persona escribe (o el navegador recuerda) su usuario y la cámara
  // confirma que es ella. El servidor compara contra los descriptores de ESA cuenta y nada más.

  // Busca la cuenta y su rostro. Si algo falta devuelve null (el mensaje es el mismo para no revelar nada).
  async function cuentaConRostro(texto) {
    const usuario = String(texto || '').trim().slice(0, 120);
    if (!usuario) return null;
    const user = await Usuario.findOne({ $or: [{ usuario }, { email: usuario }] }).collation(COLLATION);
    if (!user) return null;
    const registro = await RostroUsuario.findOne({ id_usuario: user.id_usuario });
    if (!registro || !registro.descriptores.length) return null;
    return { user, registro };
  }

  // Antes de gastar tiempo en cámara y modelos, el navegador pregunta si esa cuenta tiene rostro activo.
  app.post('/login/rostro/comprobar', requireDisponible, ...leerJson, async (req, res, next) => {
    try {
      const nombre = String((req.body || {}).usuario || '').trim().toLowerCase().slice(0, 120);
      if (!limiteDesafioIp.permitir(`ip:${req.ip}`) || !limiteDesafioUsuario.permitir(`u:${nombre}`)) {
        return res.status(429).json({ ok: false, codigo: 'demasiados_intentos', error: MENSAJE_DEMASIADOS });
      }
      const cuenta = await cuentaConRostro(nombre);
      if (!cuenta) {
        return res.status(404).json({ ok: false, codigo: 'sin_rostro_activo', error: MENSAJE_SIN_ROSTRO });
      }
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  // Paso 1: el servidor entrega un reto de prueba de vida de un solo uso, ligado a esa cuenta.
  app.post('/login/rostro/desafio', requireDisponible, ...leerJson, async (req, res, next) => {
    try {
      const nombre = String((req.body || {}).usuario || '').trim().toLowerCase().slice(0, 120);
      if (!limiteDesafioIp.permitir(`ip:${req.ip}`) || !limiteDesafioUsuario.permitir(`u:${nombre}`)) {
        return res.status(429).json({ ok: false, codigo: 'demasiados_intentos', error: MENSAJE_DEMASIADOS });
      }
      const cuenta = await cuentaConRostro(nombre);
      if (!cuenta) {
        return res.status(404).json({ ok: false, codigo: 'sin_rostro_activo', error: MENSAJE_SIN_ROSTRO });
      }
      return res.json({ ok: true, desafio: rostro.crearDesafio(req, 'login', { id_usuario: cuenta.user.id_usuario }) });
    } catch (error) {
      return next(error);
    }
  });

  // Paso 2: llega UN descriptor (nunca fotos); se compara y, si coincide, se abre la sesión.
  app.post('/login/rostro', requireDisponible, ...leerJson, async (req, res, next) => {
    try {
      const { usuario, desafio, descriptor } = req.body || {};
      const nombre = String(usuario || '').trim().toLowerCase().slice(0, 120);
      // Los intentos se cuentan por (IP + usuario) y por usuario: frenan adivinar con muchos rostros.
      if (!limiteIntentoIp.permitir(`${req.ip}|${nombre}`) || !limiteIntentoUsuario.permitir(`u:${nombre}`)) {
        return res.status(429).json({ ok: false, codigo: 'demasiados_intentos', error: MENSAJE_DEMASIADOS });
      }
      const reto = rostro.consumirDesafio(req, desafio, 'login');
      if (!reto.ok) {
        return res.status(400).json({ ok: false, codigo: `desafio_${reto.motivo}`, error: MENSAJES_DESAFIO[reto.motivo] });
      }
      if (!rostro.descriptorValido(descriptor)) {
        return res.status(400).json({ ok: false, codigo: 'descriptor_invalido', error: 'No pudimos leer bien tu rostro. Inténtalo de nuevo con buena luz.' });
      }
      const cuenta = await cuentaConRostro(nombre);
      // El reto se pidió para una cuenta concreta: no sirve para otra.
      if (!cuenta || cuenta.user.id_usuario !== reto.desafio.id_usuario) {
        return res.status(404).json({ ok: false, codigo: 'sin_rostro_activo', error: MENSAJE_SIN_ROSTRO });
      }
      const guardados = cuenta.registro.descriptores.map(rostro.descifrar).filter(Boolean);
      if (!guardados.length) {
        return res.status(409).json({
          ok: false,
          codigo: 'rostro_ilegible',
          error: 'No pudimos leer tu rostro guardado. Entra con tu contraseña y vuelve a registrarlo desde tu perfil.'
        });
      }
      const distancia = rostro.mejorDistancia(descriptor, guardados);
      if (!(distancia <= rostro.umbral(cuenta.user.rol))) {
        return res.status(401).json({ ok: false, codigo: 'no_coincide', error: 'No te reconocimos. Inténtalo de nuevo con buena luz o entra con tu contraseña.' });
      }
      await iniciarSesion(req, cuenta.user);
      await RostroUsuario.updateOne({ id_usuario: cuenta.user.id_usuario }, { $set: { ultimo_uso: new Date() } });
      return res.json({ ok: true, destino: destinoTrasLogin(cuenta.user), nombre: cuenta.user.nombre });
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = { registrarRutasRostro, leerJson, requireDisponible };
