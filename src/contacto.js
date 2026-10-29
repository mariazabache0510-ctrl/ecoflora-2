// Datos de contacto de EcoFlora en un solo lugar: los usan el pie de página, la página de
// contacto, el envío de correos y el panel de mensajes.

const EMAIL = 'mariazabache0510@gmail.com';
const TELEFONO_DIGITOS = '573124698497';
const SALUDO_WHATSAPP = 'Hola EcoFlora, quisiera más información sobre sus plantas.';

const contacto = {
  direccion: 'Calle 123 #45-67, Villavicencio-Meta',
  horario: 'Lun - Sáb: 8:00 a.m. - 6:00 p.m.',
  telefono: '+57 312 469 8497',
  telefonoHref: `tel:+${TELEFONO_DIGITOS}`,
  whatsappNumero: TELEFONO_DIGITOS,
  whatsappHref: `https://wa.me/${TELEFONO_DIGITOS}?text=${encodeURIComponent(SALUDO_WHATSAPP)}`,
  email: EMAIL,
  emailHref: `mailto:${EMAIL}`
};

// Correo que recibe los mensajes del formulario (se puede cambiar con CONTACT_TO_EMAIL).
function destinoCorreo() {
  return String(process.env.CONTACT_TO_EMAIL || EMAIL).trim();
}

// Enlace de WhatsApp para escribirle a una persona que dejó su teléfono en el formulario.
// Acepta números colombianos de 10 dígitos (3XXXXXXXXX) o con prefijo 57. Si no parece
// un número válido devuelve una cadena vacía.
function whatsappDe(telefono, texto) {
  let digitos = String(telefono || '').replace(/\D/g, '');
  if (digitos.length === 10 && digitos.startsWith('3')) digitos = `57${digitos}`;
  if (!/^57\d{10}$/.test(digitos)) return '';
  const consulta = texto ? `?text=${encodeURIComponent(texto)}` : '';
  return `https://wa.me/${digitos}${consulta}`;
}

module.exports = { contacto, destinoCorreo, whatsappDe, EMAIL };
