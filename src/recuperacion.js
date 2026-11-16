// Recuperar la contraseña con un enlace enviado por correo.
//
//  - El token tiene 256 bits al azar (crypto.randomBytes). Solo viaja por correo; en la base queda su SHA-256.
//  - Vale 30 minutos y se puede usar UNA vez. Pedir uno nuevo invalida los anteriores.
//  - Al cambiar la contraseña se cierran todas las sesiones abiertas de esa cuenta.

const crypto = require('crypto');
const mongoose = require('mongoose');
const { Recuperacion } = require('./models');

const VIGENCIA_MS = 30 * 60 * 1000;

function hashDe(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Crea el token, guarda su hash y devuelve el token en claro (para el enlace del correo).
async function crearToken(idUsuario, ahora = Date.now()) {
  await Recuperacion.deleteMany({ id_usuario: idUsuario });
  const token = crypto.randomBytes(32).toString('base64url');
  await Recuperacion.create({ id_usuario: idUsuario, token_hash: hashDe(token), vence: new Date(ahora + VIGENCIA_MS) });
  return token;
}

// ¿A qué cuenta pertenece el token? null si no existe, ya se usó o venció.
async function buscarToken(token, ahora = Date.now()) {
  const texto = String(token || '');
  if (!/^[\w-]{43}$/.test(texto)) return null;
  const registro = await Recuperacion.findOne({ token_hash: hashDe(texto) }).lean();
  if (!registro || registro.vence.getTime() <= ahora) return null;
  return registro;
}

// Gasta el token (un solo uso). Devuelve true solo para quien lo gastó primero: dos peticiones a la vez no pueden
// cambiar la contraseña con el mismo enlace.
async function gastarToken(token) {
  const resultado = await Recuperacion.deleteOne({ token_hash: hashDe(token) });
  return resultado.deletedCount === 1;
}

// Borra las sesiones guardadas de una cuenta (las de express-session viven en la colección "sessions").
async function cerrarSesionesDe(idUsuario, { excepto } = {}) {
  const id = Number(idUsuario);
  if (!Number.isInteger(id)) return 0;
  const coleccion = mongoose.connection.db.collection('sessions');
  // La sesión se guarda como texto JSON: "id_usuario":7 seguido de coma o llave.
  const filtro = { session: { $regex: `"id_usuario":${id}[,}]` } };
  if (excepto) filtro._id = { $ne: excepto };
  const resultado = await coleccion.deleteMany(filtro);
  return resultado.deletedCount || 0;
}

module.exports = { VIGENCIA_MS, hashDe, crearToken, buscarToken, gastarToken, cerrarSesionesDe };
