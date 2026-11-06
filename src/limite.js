// Límite sencillo en memoria: como máximo `max` intentos por clave dentro de `ventanaMs`.
// Sirve para que nadie llene el formulario de contacto (y tu correo) de mensajes seguidos.

function crearLimitador({ max, ventanaMs }) {
  const intentos = new Map();

  function limpiar(ahora) {
    for (const [clave, marcas] of intentos) {
      const vigentes = marcas.filter((marca) => ahora - marca < ventanaMs);
      if (vigentes.length) intentos.set(clave, vigentes);
      else intentos.delete(clave);
    }
  }

  return {
    // Registra un intento. Devuelve false si la clave ya superó el máximo permitido.
    permitir(clave, ahora = Date.now()) {
      if (intentos.size > 500) limpiar(ahora);
      const marcas = (intentos.get(clave) || []).filter((marca) => ahora - marca < ventanaMs);
      if (marcas.length >= max) {
        intentos.set(clave, marcas);
        return false;
      }
      marcas.push(ahora);
      intentos.set(clave, marcas);
      return true;
    },

    // ¿Esa clave ya llegó al máximo? Solo mira: NO cuenta como un intento nuevo. Sirve para contar
    // únicamente los intentos fallidos (el inicio de sesión con la contraseña correcta no gasta intentos).
    excedido(clave, ahora = Date.now()) {
      const marcas = (intentos.get(clave) || []).filter((marca) => ahora - marca < ventanaMs);
      return marcas.length >= max;
    },

    // Borra los intentos de una clave (por ejemplo, cuando la persona por fin entra bien).
    liberar(clave) {
      intentos.delete(clave);
    }
  };
}

module.exports = { crearLimitador };
