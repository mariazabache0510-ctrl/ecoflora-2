// Inicio de sesión compartido: lo usan el login con contraseña, el registro y el login con rostro,
// para que los tres dejen la sesión exactamente igual.
const { mergeGuestCart } = require('./cart');

async function iniciarSesion(req, user) {
  req.session.id_usuario = user.id_usuario;
  req.session.nombre = user.nombre;
  req.session.usuario = user.usuario;
  req.session.rol = user.rol;
  // El carrito que armó como invitado pasa a su cuenta.
  await mergeGuestCart(req, user.id_usuario);
}

function destinoTrasLogin(user) {
  return user.rol === 'admin' ? '/admin' : '/';
}

module.exports = { iniciarSesion, destinoTrasLogin };
