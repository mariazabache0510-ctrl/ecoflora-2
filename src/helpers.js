const ESTADOS = ['pendiente', 'confirmado', 'en_camino', 'entregado', 'cancelado'];

const COLORES_ESTADO = {
  pendiente: 'warning',
  confirmado: 'info',
  en_camino: 'primary',
  entregado: 'success',
  cancelado: 'danger'
};

function formatPrice(value) {
  const rounded = Math.round(Number(value) || 0);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(value) {
  return escapeHtml(value).replace(/\r\n|\n|\r/g, '<br>');
}

function excerpt(value, length) {
  return String(value || '').slice(0, length);
}

function ucfirst(value) {
  const text = String(value || '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Las fechas se muestran siempre en hora de Colombia, aunque el servidor (Render) trabaje en UTC.
const FORMATO_FECHA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

function formatDate(value, withSeconds) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const partes = {};
  FORMATO_FECHA.formatToParts(date).forEach((parte) => { partes[parte.type] = parte.value; });
  const base = `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`;
  return withSeconds ? `${base}:${partes.second}` : base;
}

const DEFAULT_IMAGE = '/img/plantas/_default.svg';

// Ruta pública de la foto de una planta (columna `imagen`). Si no hay archivo asignado, usa la ilustración de respaldo.
function plantImage(planta) {
  const file = String((planta && planta.imagen) || '').trim();
  if (!file || file === 'default.jpg') return DEFAULT_IMAGE;
  return `/img/plantas/${encodeURIComponent(file)}`;
}

// Etiqueta <img> completa: carga diferida y respaldo automático si el archivo no carga.
function plantImg(planta, attrs = {}) {
  const alt = attrs.alt !== undefined ? attrs.alt : (planta && planta.nombre) || 'Planta';
  const parts = [
    `src="${escapeHtml(plantImage(planta))}"`,
    `alt="${escapeHtml(alt)}"`,
    `loading="${attrs.eager ? 'eager' : 'lazy'}"`,
    'decoding="async"'
  ];
  if (attrs.class) parts.push(`class="${escapeHtml(attrs.class)}"`);
  if (attrs.width) parts.push(`width="${escapeHtml(attrs.width)}"`);
  if (attrs.height) parts.push(`height="${escapeHtml(attrs.height)}"`);
  if (attrs.style) parts.push(`style="${escapeHtml(attrs.style)}"`);
  parts.push(`onerror="this.onerror=null;this.src='${DEFAULT_IMAGE}'"`);
  return `<img ${parts.join(' ')}>`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pageName(req) {
  const path = req.path;
  if (path === '/' || path === '') return 'index';
  if (path.startsWith('/planta')) return 'planta';
  if (path.startsWith('/admin/usuarios')) return 'usuarios';
  if (path.startsWith('/admin/pedidos')) return 'pedidos_admin';
  if (path === '/admin') return 'panel_admin';
  if (path.startsWith('/usuario/domicilios')) return 'domicilios';
  if (path.startsWith('/usuario/historial')) return 'historial';
  if (path.startsWith('/usuario/perfil')) return 'editar_perfil';
  if (path === '/usuario') return 'panel';
  if (path === '/confirmar-pedido') return 'confirmar_pedido';
  return path.split('/').filter(Boolean)[0] || 'index';
}

module.exports = {
  ESTADOS,
  COLORES_ESTADO,
  formatPrice,
  escapeHtml,
  nl2br,
  excerpt,
  ucfirst,
  formatDate,
  plantImage,
  plantImg,
  escapeRegex,
  pageName
};
