// Rutas de cuentas (Parte 1 del parcial): entrar con Google, recuperar la contraseña y crear usuarios desde el admin.

const express = require('express');
const { Usuario, Recuperacion, nextId } = require('./models');
const { hashPassword, CLAVE_MINIMA, MENSAJE_CLAVE_CORTA } = require('./passwords');
const { crearLimitador } = require('./limite');
const { iniciarSesion } = require('./sesion');
const { esProduccion } = require('./entorno');
const { enviarRecuperacion, urlPublica } = require('./mailer');
const google = require('./google');
const recuperacion = require('./recuperacion');
const { COLLATION, leerDatos, yaExiste, usuarioDisponibleDesde } = require('./usuarios');

const DIEZ_MINUTOS = 10 * 60 * 1000;
const limiteGoogle = crearLimitador({ max: 20, ventanaMs: DIEZ_MINUTOS });
const limiteRecuperarIp = crearLimitador({ max: 5, ventanaMs: DIEZ_MINUTOS });
const limiteRecuperarCuenta = crearLimitador({ max: 3, ventanaMs: 60 * 60 * 1000 });
const limiteCambiarClave = crearLimitador({ max: 10, ventanaMs: DIEZ_MINUTOS });

const MENSAJE_SOLO_CLAVE = 'Por seguridad, la cuenta de administración entra solo con contraseña.';
const MENSAJE_RECUPERAR = 'Si existe una cuenta con esos datos, te enviamos un correo con el enlace para cambiar la contraseña. '
  + 'Revisa también la carpeta de spam. El enlace vale 30 minutos.';

// Analiza JSON (solo en estas rutas). Si llega algo roto responde con un mensaje claro.
const leerJson = [
  express.json({ limit: '8kb' }),
  (error, req, res, next) => res.status(400).json({ ok: false, error: 'La solicitud no es válida. Recarga la página e inténtalo otra vez.' })
];

function sinCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

// Dirección pública para el enlace del correo. NUNCA se arma con el encabezado Host de la petición en producción:
// alguien podría pedir el correo de otra persona con un Host falso y apuntar el enlace a su propio sitio.
function direccionDelSitio(req) {
  const publica = urlPublica();
  if (publica) return publica;
  if (!esProduccion()) return `${req.protocol}://${req.get('host')}`;
  return '';
}

function registrarRutasCuentas(app, { requireAdmin }) {
  /* ---------- Entrar o registrarse con Google ---------- */

  app.post('/auth/google', ...leerJson, async (req, res, next) => {
    try {
      if (!google.disponible()) {
        return res.status(503).json({ ok: false, codigo: 'no_disponible', error: 'El inicio con Google todavía no está disponible en este sitio.' });
      }
      if (!limiteGoogle.permitir(req.ip)) {
        return res.status(429).json({ ok: false, codigo: 'demasiados_intentos', error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' });
      }
      let datos;
      try {
        datos = await google.verificarCredencial(req.body && req.body.credential);
      } catch (error) {
        const codigo = error.codigo || 'credencial_invalida';
        return res.status(codigo === 'correo_no_verificado' ? 403 : 401).json({ ok: false, codigo, error: error.message });
      }

      let usuario = await Usuario.findOne({ google_id: datos.sub });
      if (!usuario) usuario = await Usuario.findOne({ email: datos.email }).collation(COLLATION);

      if (usuario && usuario.rol === 'admin') {
        return res.status(403).json({ ok: false, codigo: 'solo_contrasena', error: MENSAJE_SOLO_CLAVE });
      }
      if (usuario && usuario.google_id && usuario.google_id !== datos.sub) {
        return res.status(403).json({ ok: false, codigo: 'otra_cuenta_google', error: 'Esa cuenta de EcoFlora ya está vinculada a otra cuenta de Google.' });
      }

      let nuevo = false;
      if (!usuario) {
        usuario = await crearCuentaGoogle(datos);
        nuevo = true;
      } else if (!usuario.google_id) {
        // Misma persona: el correo coincide y Google confirma que es suyo. Se vincula para la próxima vez.
        await Usuario.updateOne({ id_usuario: usuario.id_usuario }, { $set: { google_id: datos.sub } });
      }

      await iniciarSesion(req, usuario);
      const destino = nuevo ? '/usuario/perfil?bienvenida=1' : '/';
      return req.session.save(() => res.json({ ok: true, nuevo, destino }));
    } catch (error) {
      return next(error);
    }
  });

  async function crearCuentaGoogle(datos) {
    try {
      return await Usuario.create({
        id_usuario: await nextId('usuarios'),
        nombre: (datos.nombre || datos.email.split('@')[0]).slice(0, 100),
        usuario: await usuarioDisponibleDesde(datos.email),
        email: datos.email,
        password: '',
        proveedor: 'google',
        google_id: datos.sub,
        rol: 'cliente'
      });
    } catch (error) {
      // Dos clics seguidos: la otra petición ya la creó.
      if (error && error.code === 11000) {
        const existente = await Usuario.findOne({ google_id: datos.sub });
        if (existente) return existente;
      }
      throw error;
    }
  }

  /* ---------- Recuperar la contraseña ---------- */

  app.get('/recuperar', sinCache, (req, res) => {
    res.render('recuperar', { error: '', exito: '', valor: '' });
  });

  app.post('/recuperar', sinCache, async (req, res, next) => {
    try {
      const dato = String(req.body.dato || '').trim().slice(0, 150);
      if (!dato) return res.status(400).render('recuperar', { error: 'Escribe tu correo o tu usuario.', exito: '', valor: '' });
      if (!limiteRecuperarIp.permitir(req.ip)) {
        return res.status(429).render('recuperar', { error: 'Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.', exito: '', valor: dato });
      }
      // Siempre la misma respuesta, exista o no la cuenta: así no se puede averiguar quién está registrado.
      const respuesta = () => res.render('recuperar', { error: '', exito: MENSAJE_RECUPERAR, valor: '' });
      // Máximo 3 correos por hora para la misma cuenta (nadie puede llenarle el buzón a otra persona).
      if (!limiteRecuperarCuenta.permitir(dato.toLowerCase())) return respuesta();

      const usuario = await Usuario.findOne({ $or: [{ email: dato }, { usuario: dato }] }).collation(COLLATION);
      if (!usuario || !usuario.email) return respuesta();
      const base = direccionDelSitio(req);
      if (!base) {
        console.error('Recuperar contraseña: falta PUBLIC_URL (o RENDER_EXTERNAL_URL) para armar el enlace del correo.');
        return respuesta();
      }
      const token = await recuperacion.crearToken(usuario.id_usuario);
      const enlace = `${base}/recuperar/${token}`;
      // El correo se envía en segundo plano: así la respuesta tarda lo mismo con cuenta o sin ella.
      enviarRecuperacion(usuario, enlace, Math.round(recuperacion.VIGENCIA_MS / 60000)).then((resultado) => {
        if (resultado.enviado) return;
        console.error(`Recuperar contraseña: no se pudo enviar el correo (${resultado.motivo}).`);
        if (!esProduccion()) console.log(`[recuperacion] enlace de prueba para ${usuario.usuario}: ${enlace}`);
      });
      return respuesta();
    } catch (error) {
      return next(error);
    }
  });

  function paginaEnlaceInvalido(res) {
    return res.status(400).render('recuperar-nueva', { valido: false, token: '', error: '' });
  }

  app.get('/recuperar/:token', sinCache, async (req, res, next) => {
    try {
      const registro = await recuperacion.buscarToken(req.params.token);
      if (!registro) return paginaEnlaceInvalido(res);
      return res.render('recuperar-nueva', { valido: true, token: req.params.token, error: '' });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/recuperar/:token', sinCache, async (req, res, next) => {
    try {
      if (!limiteCambiarClave.permitir(req.ip)) {
        return res.status(429).render('recuperar-nueva', { valido: true, token: req.params.token, error: 'Demasiados intentos. Espera unos minutos.' });
      }
      const registro = await recuperacion.buscarToken(req.params.token);
      if (!registro) return paginaEnlaceInvalido(res);

      const password = String(req.body.password || '').trim();
      const confirmar = String(req.body.confirmar || '').trim();
      const fallo = (mensaje) => res.status(400).render('recuperar-nueva', { valido: true, token: req.params.token, error: mensaje });
      if (password !== confirmar) return fallo('Las contraseñas no coinciden.');
      if (password.length < CLAVE_MINIMA) return fallo(MENSAJE_CLAVE_CORTA);
      if (password.length > 200) return fallo('La contraseña es demasiado larga.');

      // Un solo uso: si otra petición gastó el enlace primero, esta ya no cambia nada.
      if (!(await recuperacion.gastarToken(req.params.token))) return paginaEnlaceInvalido(res);

      await Usuario.updateOne({ id_usuario: registro.id_usuario }, { $set: { password: await hashPassword(password) } });
      await Recuperacion.deleteMany({ id_usuario: registro.id_usuario });
      await recuperacion.cerrarSesionesDe(registro.id_usuario);
      return res.redirect('/login?clave=cambiada');
    } catch (error) {
      return next(error);
    }
  });

  /* ---------- Admin: crear un usuario (la "C" del CRUD) ---------- */

  const usuarioVacio = { id_usuario: null, nombre: '', usuario: '', email: '', telefono: '', ciudad: '', direccion: '', rol: 'cliente', proveedor: 'local' };

  app.get('/admin/usuarios/nuevo', requireAdmin, (req, res) => {
    res.render('admin/editar', { usuario: usuarioVacio, nuevo: true, error: '' });
  });

  app.post('/admin/usuarios/nuevo', requireAdmin, async (req, res, next) => {
    try {
      const { datos, error } = leerDatos(req.body, { creando: true });
      const rol = req.body.rol === 'admin' ? 'admin' : 'cliente';
      const password = String(req.body.password || '').trim();
      const mostrar = (mensaje) => res.status(400).render('admin/editar', { usuario: { ...usuarioVacio, ...datos, rol }, nuevo: true, error: mensaje });
      if (error) return mostrar(error);
      if (password.length < CLAVE_MINIMA) return mostrar(MENSAJE_CLAVE_CORTA);
      if (password.length > 200) return mostrar('La contraseña es demasiado larga.');
      if (await yaExiste(datos)) return mostrar('El usuario o email ya están registrados.');
      try {
        await Usuario.create({ id_usuario: await nextId('usuarios'), ...datos, password: await hashPassword(password), rol });
      } catch (fallo) {
        if (fallo && fallo.code === 11000) return mostrar('El usuario o email ya están registrados.');
        throw fallo;
      }
      return res.redirect('/admin/usuarios?creado=1');
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = { registrarRutasCuentas, MENSAJE_RECUPERAR };
