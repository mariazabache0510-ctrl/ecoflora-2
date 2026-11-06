// Inicio de sesión compartido: lo usan el login con contraseña, el registro y el login con rostro,
// para que los tres dejen la sesión exactamente igual.
const { mergeGuestCart } = require('./cart');
const { NOMBRE_COOKIE, opcionesCookie } = require('./entorno');

function regenerar(req) {
  return new Promise((resolver, rechazar) => {
    req.session.regenerate((error) => (error ? rechazar(error) : resolver()));
  });
}

function destruir(req) {
  return new Promise((resolver) => {
    if (!req.session) return resolver();
    return req.session.destroy(() => resolver());
  });
}

async function iniciarSesion(req, user) {
  // Se estrena una sesión nueva (otro identificador) al entrar: así un identificador que alguien haya
  // puesto o robado ANTES del login no sirve después (fijación de sesión). Solo se conserva el carrito de invitado.
  const carritoInvitado = req.session.sesion_carrito;
  await regenerar(req);
  if (carritoInvitado) req.session.sesion_carrito = carritoInvitado;
  req.session.id_usuario = user.id_usuario;
  req.session.nombre = user.nombre;
  req.session.usuario = user.usuario;
  req.session.rol = user.rol;
  // El carrito que armó como invitado pasa a su cuenta.
  await mergeGuestCart(req, user.id_usuario);
}

// Cierra la sesión: borra los datos del servidor y la cookie del navegador.
async function cerrarSesion(req, res) {
  await destruir(req);
  res.clearCookie(NOMBRE_COOKIE, opcionesCookie());
}

function destinoTrasLogin(user) {
  return user.rol === 'admin' ? '/admin' : '/';
}

module.exports = { iniciarSesion, cerrarSesion, destinoTrasLogin };
