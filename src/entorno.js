// Ajustes que dependen de dónde corre el sitio (tu computador o Render).

const NOMBRE_COOKIE = 'ecoflora.sid';
const SECRETO_DE_DESARROLLO = 'ecoflora-dev-secret';
// Valores de ejemplo que no sirven como secreto real (el segundo es el de .env.example).
const SECRETOS_DE_EJEMPLO = [SECRETO_DE_DESARROLLO, 'cambia-esto-en-produccion'];

function esProduccion() {
  return process.env.NODE_ENV === 'production';
}

// El secreto firma la cookie de sesión. En producción es obligatorio y no puede ser el de desarrollo:
// con un secreto público cualquiera podría fabricar cookies válidas.
function secretoDeSesion() {
  const secreto = String(process.env.SESSION_SECRET || '').trim();
  if (esProduccion()) {
    if (!secreto || SECRETOS_DE_EJEMPLO.includes(secreto)) {
      throw new Error(
        'Falta SESSION_SECRET (o tiene un valor de ejemplo): en producción (NODE_ENV=production) es obligatoria. '
        + 'Créala en Render > Environment (por ejemplo con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))") '
        + 'y vuelve a desplegar.'
      );
    }
    return secreto;
  }
  return secreto || SECRETO_DE_DESARROLLO;
}

// Opciones de la cookie de sesión (también las usa /logout para borrarla igual que se creó).
function opcionesCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: esProduccion(),
    path: '/'
  };
}

module.exports = { NOMBRE_COOKIE, esProduccion, secretoDeSesion, opcionesCookie };
