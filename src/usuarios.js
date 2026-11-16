// Reglas compartidas para los datos de una cuenta (registro, "Nuevo usuario" del admin y edición).

const { Usuario } = require('./models');

const COLLATION = { locale: 'es', strength: 2 };
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// El usuario no puede llevar "@" ni espacios: el login acepta usuario O correo en el mismo campo,
// y así nadie puede crear un usuario que se confunda con el correo de otra persona.
const USUARIO_VALIDO = /^[\w.-]{3,40}$/;

const LIMITES = { nombre: 100, email: 150, telefono: 30, direccion: 200, ciudad: 100 };

function texto(valor) {
  return String(valor === undefined || valor === null ? '' : valor).trim();
}

// Lee y valida el formulario. `creando` aplica además el formato estricto del usuario (las cuentas antiguas
// con otro formato siguen pudiendo editarse sin que se les exija cambiarlo).
function leerDatos(body, { creando = false } = {}) {
  const datos = {
    nombre: texto(body.nombre),
    usuario: texto(body.usuario),
    email: texto(body.email),
    telefono: texto(body.telefono),
    direccion: texto(body.direccion),
    ciudad: texto(body.ciudad)
  };
  if (!datos.nombre || !datos.usuario || !datos.email) return { datos, error: 'Nombre, usuario y email son obligatorios.' };
  if (datos.nombre.length > LIMITES.nombre) return { datos, error: `El nombre admite hasta ${LIMITES.nombre} caracteres.` };
  if (datos.email.length > LIMITES.email || !CORREO_VALIDO.test(datos.email)) return { datos, error: 'Escribe un correo válido.' };
  if (datos.telefono.length > LIMITES.telefono) return { datos, error: `El teléfono admite hasta ${LIMITES.telefono} caracteres.` };
  if (datos.direccion.length > LIMITES.direccion) return { datos, error: `La dirección admite hasta ${LIMITES.direccion} caracteres.` };
  if (datos.ciudad.length > LIMITES.ciudad) return { datos, error: `La ciudad admite hasta ${LIMITES.ciudad} caracteres.` };
  if (creando && !USUARIO_VALIDO.test(datos.usuario)) {
    return { datos, error: 'El usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo (sin espacios ni @).' };
  }
  return { datos, error: '' };
}

// ¿Ya existe otra cuenta con ese usuario o correo? (sin distinguir mayúsculas ni tildes)
async function yaExiste({ usuario, email }, exceptoId) {
  const filtro = { $or: [{ usuario }, { email }] };
  if (exceptoId) filtro.id_usuario = { $ne: exceptoId };
  return Boolean(await Usuario.exists(filtro).collation(COLLATION));
}

// Inventa un usuario libre a partir de un correo (para las cuentas que nacen con Google).
async function usuarioDisponibleDesde(email) {
  const local = texto(email).split('@')[0].toLowerCase().replace(/[^\w.-]+/g, '').slice(0, 30);
  const base = local.length >= 3 ? local : (local + 'user').slice(0, 30);
  for (let intento = 0; intento < 20; intento += 1) {
    const candidato = intento === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await Usuario.exists({ usuario: candidato }).collation(COLLATION))) return candidato;
  }
  return `${base}${Date.now()}`.slice(0, 40);
}

module.exports = { COLLATION, CORREO_VALIDO, USUARIO_VALIDO, LIMITES, leerDatos, yaExiste, usuarioDisponibleDesde };
