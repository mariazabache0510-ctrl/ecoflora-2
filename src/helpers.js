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

function formatDate(value, withSeconds) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const base = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad(date.getSeconds())}` : base;
}

function plantImage(nombre, size) {
  const text = encodeURIComponent(nombre || 'Planta');
  if (size === 'detail') {
    return `https://placehold.co/800x600/1b4332/ffffff?text=${text}`;
  }
  if (size === 'thumb') {
    return `https://placehold.co/100x100/2d6a4f/ffffff?text=${text}`;
  }
  return `https://placehold.co/600x400/2d6a4f/ffffff?text=${text}`;
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
  escapeRegex,
  pageName
};
