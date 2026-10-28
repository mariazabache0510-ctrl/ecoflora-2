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

module.exports = { hashPassword, verifyPassword, normalizeHash };
