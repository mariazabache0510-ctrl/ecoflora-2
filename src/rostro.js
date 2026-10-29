// Inicio de sesión con reconocimiento facial: lo que hace el SERVIDOR.
//
// El navegador usa la cámara y convierte el rostro en 128 números (el "descriptor"); nunca se
// envía ni se guarda una foto. Aquí solo se valida ese vector, se guarda CIFRADO y se compara
// con la distancia euclidiana contra el que llegue al iniciar sesión.

const crypto = require('crypto');

const DIMENSION = 128;
const MIN_DESCRIPTORES = 3;
const MAX_DESCRIPTORES = 5;
// Cambia este valor si algún día cambia el texto legal: así se sabe qué versión aceptó cada persona.
const VERSION_CONSENTIMIENTO = 'v1-2026-10';

const DESAFIO_VIGENCIA_MS = 90 * 1000;
const DESAFIO_MINIMO_MS = 1000;
const ACCIONES = ['parpadear', 'girar_izquierda', 'girar_derecha'];

// ---------- Cifrado (AES-256-GCM) ----------

// La clave sale de FACE_ENCRYPTION_KEY (cualquier texto largo sirve: se convierte en 32 bytes).
// Sin clave la función queda apagada: nunca se guarda un rostro sin cifrar.
function claveCifrado() {
  const bruta = String(process.env.FACE_ENCRYPTION_KEY || '').trim();
  if (bruta.length < 16) return null;
  return crypto.createHash('sha256').update(bruta).digest();
}

function disponible() {
  return claveCifrado() !== null;
}

// descriptor (128 números) -> "v1.iv.tag.datos" en base64url
function cifrar(descriptor) {
  const clave = claveCifrado();
  if (!clave) throw new Error('Falta FACE_ENCRYPTION_KEY');
  const datos = Buffer.from(new Float32Array(descriptor).buffer);
  const iv = crypto.randomBytes(12);
  const cifrador = crypto.createCipheriv('aes-256-gcm', clave, iv);
  const cifrado = Buffer.concat([cifrador.update(datos), cifrador.final()]);
  const etiqueta = cifrador.getAuthTag();
  return ['v1', iv.toString('base64url'), etiqueta.toString('base64url'), cifrado.toString('base64url')].join('.');
}

// Devuelve el descriptor o null si el texto está dañado o la clave cambió.
function descifrar(texto) {
  const clave = claveCifrado();
  if (!clave) return null;
  try {
    const [version, iv, etiqueta, datos] = String(texto).split('.');
    if (version !== 'v1' || !iv || !etiqueta || !datos) return null;
    const descifrador = crypto.createDecipheriv('aes-256-gcm', clave, Buffer.from(iv, 'base64url'));
    descifrador.setAuthTag(Buffer.from(etiqueta, 'base64url'));
    const plano = Buffer.concat([descifrador.update(Buffer.from(datos, 'base64url')), descifrador.final()]);
    if (plano.length !== DIMENSION * 4) return null;
    const vista = new Float32Array(plano.buffer.slice(plano.byteOffset, plano.byteOffset + plano.length));
    return Array.from(vista);
  } catch (error) {
    return null;
  }
}

// ---------- Descriptores y distancia ----------

// Un descriptor válido son exactamente 128 números finitos y razonables (no todo ceros).
function descriptorValido(descriptor) {
  if (!Array.isArray(descriptor) || descriptor.length !== DIMENSION) return false;
  let suma = 0;
  for (const valor of descriptor) {
    if (typeof valor !== 'number' || !Number.isFinite(valor) || Math.abs(valor) > 3) return false;
    suma += valor * valor;
  }
  const norma = Math.sqrt(suma);
  return norma > 0.1 && norma < 10;
}

function distancia(a, b) {
  let suma = 0;
  for (let i = 0; i < DIMENSION; i += 1) {
    const diferencia = a[i] - b[i];
    suma += diferencia * diferencia;
  }
  return Math.sqrt(suma);
}

// La menor distancia entre el descriptor nuevo y cualquiera de los guardados.
function mejorDistancia(descriptor, guardados) {
  let mejor = Infinity;
  for (const guardado of guardados) {
    const d = distancia(descriptor, guardado);
    if (d < mejor) mejor = d;
  }
  return mejor;
}

// Las capturas del registro deben parecerse entre sí: si no, no es la misma persona o la captura salió mala.
function capturasConsistentes(descriptores, maximo = 0.45) {
  for (let i = 0; i < descriptores.length; i += 1) {
    for (let j = i + 1; j < descriptores.length; j += 1) {
      if (distancia(descriptores[i], descriptores[j]) > maximo) return false;
    }
  }
  return true;
}

// ---------- Umbral (configurable) ----------

function leerNumero(nombre, porDefecto, minimo, maximo) {
  const numero = Number.parseFloat(String(process.env[nombre] || '').replace(',', '.'));
  if (!Number.isFinite(numero)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, numero));
}

// FACE_MATCH_THRESHOLD: entre más bajo, más estricto. 0.5 es un buen punto de partida.
function umbral(rol) {
  const general = leerNumero('FACE_MATCH_THRESHOLD', 0.5, 0.2, 0.7);
  if (rol !== 'admin') return general;
  // La cuenta admin controla pedidos y stock: por defecto exige 0.05 más de parecido.
  return leerNumero('FACE_MATCH_THRESHOLD_ADMIN', Math.max(0.2, general - 0.05), 0.2, 0.7);
}

// ---------- Retos de prueba de vida (un solo uso) ----------

// Guarda un reto nuevo en la sesión. El navegador debe superarlo y devolver el código.
function crearDesafio(req, proposito, extra = {}) {
  const accion = ACCIONES[crypto.randomInt(ACCIONES.length)];
  const nonce = crypto.randomBytes(16).toString('hex');
  req.session.rostro_desafio = { nonce, accion, proposito, creado: Date.now(), ...extra };
  return { nonce, accion, expira_en: DESAFIO_VIGENCIA_MS };
}

// Revisa y GASTA el reto: sirve una sola vez, aunque falle.
function consumirDesafio(req, nonce, proposito, ahora = Date.now()) {
  const desafio = req.session.rostro_desafio;
  delete req.session.rostro_desafio;
  if (!desafio || typeof nonce !== 'string') return { ok: false, motivo: 'sin_desafio' };
  const iguales = desafio.nonce.length === nonce.length
    && crypto.timingSafeEqual(Buffer.from(desafio.nonce), Buffer.from(nonce));
  if (!iguales || desafio.proposito !== proposito) return { ok: false, motivo: 'sin_desafio' };
  const edad = ahora - desafio.creado;
  if (edad > DESAFIO_VIGENCIA_MS) return { ok: false, motivo: 'vencido' };
  if (edad < DESAFIO_MINIMO_MS) return { ok: false, motivo: 'muy_rapido' };
  return { ok: true, desafio };
}

module.exports = {
  DIMENSION,
  MIN_DESCRIPTORES,
  MAX_DESCRIPTORES,
  VERSION_CONSENTIMIENTO,
  ACCIONES,
  disponible,
  cifrar,
  descifrar,
  descriptorValido,
  distancia,
  mejorDistancia,
  capturasConsistentes,
  umbral,
  crearDesafio,
  consumirDesafio
};
