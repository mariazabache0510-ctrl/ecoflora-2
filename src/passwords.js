const crypto = require('crypto');
const bcrypt = require('bcryptjs');

function normalizeHash(hash) {
  return String(hash || '').replace(/^\$2y\$/, '$2a$');
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, normalizeHash(hash));
}

// Hash de una contraseña inventada, con el mismo costo que los reales. Cuando el usuario no existe se compara
// contra este hash para que la respuesta tarde casi lo mismo que con un usuario real (no se puede adivinar
// qué usuarios existen midiendo el tiempo). Se calcula una sola vez, en segundo plano, al cargar el módulo.
const hashFalso = hashPassword(crypto.randomBytes(24).toString('hex'));

async function gastarTiempoDeVerificacion(plain) {
  await bcrypt.compare(String(plain || ''), await hashFalso);
  return false;
}

// Largo mínimo de las contraseñas nuevas (registro y edición del admin). El login NO lo exige: las cuentas
// antiguas con claves más cortas siguen pudiendo entrar y cambiarlas cuando quieran.
const CLAVE_MINIMA = 8;
const MENSAJE_CLAVE_CORTA = `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`;

module.exports = { hashPassword, verifyPassword, normalizeHash, gastarTiempoDeVerificacion, CLAVE_MINIMA, MENSAJE_CLAVE_CORTA };
