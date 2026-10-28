const fs = require('fs');
const path = require('path');
const {
  Usuario,
  Categoria,
  Planta,
  Carrito,
  Pedido,
  Historial,
  Contacto,
  syncCounter
} = require('./models');
const { hashPassword } = require('./passwords');

const COLUMN_ORDERS = {
  usuarios: ['id_usuario', 'nombre', 'usuario', 'email', 'password', 'telefono', 'direccion', 'ciudad', 'rol', 'fecha_registro'],
  categorias: ['id_categoria', 'nombre', 'descripcion', 'icono'],
  plantas: ['id_planta', 'id_categoria', 'nombre', 'nombre_cientifico', 'descripcion', 'cuidados', 'precio', 'stock', 'imagen', 'destacada', 'fecha_creacion'],
  carrito: ['id_carrito', 'id_usuario', 'sesion_id', 'id_planta', 'cantidad', 'fecha_agregado'],
  pedidos: ['id_pedido', 'id_usuario', 'fecha_pedido', 'total', 'estado', 'direccion_envio', 'ciudad_envio', 'telefono_contacto', 'notas'],
  pedido_detalle: ['id_detalle', 'id_pedido', 'id_planta', 'cantidad', 'precio_unitario'],
  historial_navegacion: ['id_historial', 'id_usuario', 'ip_address', 'pagina', 'url', 'fecha_visita'],
  contactos: ['id_contacto', 'nombre', 'email', 'telefono', 'asunto', 'mensaje', 'leido', 'fecha']
};

const KNOWN_TABLES = new Set(Object.keys(COLUMN_ORDERS));
const ESTADOS = new Set(['pendiente', 'confirmado', 'en_camino', 'entregado', 'cancelado']);

function resolveSqlPath() {
  const full = path.join(__dirname, '..', 'data', 'ecoflora_full.sql');
  if (fs.existsSync(full)) return full;
  return path.join(__dirname, '..', 'ecoflora_db.sql');
}

function stripComments(sql) {
  return sql
    .replace(/^\uFEFF/, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

function parseValue(text, start) {
  let i = start;
  const quote = text[i];
  if (quote === "'" || quote === '"') {
    i += 1;
    let out = '';
    while (i < text.length) {
      if (text[i] === '\\') {
        const next = text[i + 1];
        const map = { n: '\n', r: '\r', t: '\t', '0': '\0', '\\': '\\', "'": "'", '"': '"' };
        out += Object.prototype.hasOwnProperty.call(map, next) ? map[next] : (next || '');
        i += 2;
        continue;
      }
      if (text[i] === quote) {
        if (text[i + 1] === quote) {
          out += quote;
          i += 2;
          continue;
        }
        i += 1;
        break;
      }
      out += text[i];
      i += 1;
    }
    return { value: out, next: i };
  }

  const match = text.slice(i).match(/^(NULL|TRUE|FALSE|-?\d+(?:\.\d+)?)/i);
  if (!match) {
    throw new Error(`No se pudo leer un valor SQL cerca de: ${text.slice(i, i + 40)}`);
  }
  i += match[0].length;
  if (/^null$/i.test(match[0])) return { value: null, next: i };
  if (/^true$/i.test(match[0])) return { value: 1, next: i };
  if (/^false$/i.test(match[0])) return { value: 0, next: i };
  return { value: Number(match[0]), next: i };
}

function parseTuple(text, start) {
  let i = start + 1;
  const values = [];
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] === ')') {
      i += 1;
      break;
    }
    if (text[i] === ',') {
      i += 1;
      continue;
    }
    const parsed = parseValue(text, i);
    values.push(parsed.value);
    i = parsed.next;
  }
  return { values, next: i };
}

function parseSqlDump(sql) {
  const text = stripComments(sql);
  const bucket = {};
  const re = /INSERT\s+INTO\s+(?:`?[A-Za-z0-9_]+`?\.)?`?([A-Za-z0-9_]+)`?\s*(?:\(([^)]*)\))?\s*VALUES\s*/gi;
  let match = re.exec(text);
  while (match) {
    const table = match[1].toLowerCase();
    const columns = match[2]
      ? match[2].split(',').map((column) => column.trim().replace(/`/g, '')).filter(Boolean)
      : null;
    let i = re.lastIndex;
    const tuples = [];
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i += 1;
      if (text[i] === ';') {
        i += 1;
        break;
      }
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] !== '(') break;
      const parsed = parseTuple(text, i);
      tuples.push(parsed.values);
      i = parsed.next;
    }
    re.lastIndex = i;
    if (KNOWN_TABLES.has(table)) {
      if (!bucket[table]) bucket[table] = [];
      const order = columns && columns.length ? columns : COLUMN_ORDERS[table];
      tuples.forEach((values) => {
        const row = {};
        order.forEach((column, index) => {
          row[column] = values[index];
        });
        bucket[table].push(row);
      });
    }
    match = re.exec(text);
  }
  return bucket;
}

function parseDate(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const date = new Date(String(value).trim().replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function text(value) {
  return value == null ? '' : String(value);
}

function assignIds(rows, field) {
  let auto = rows.reduce((max, row) => Math.max(max, Number(row[field]) || 0), 0);
  rows.forEach((row) => {
    if (!Number(row[field])) {
      auto += 1;
      row[field] = auto;
    } else {
      row[field] = Number(row[field]);
    }
  });
}

function dedupe(rows, field) {
  const map = new Map();
  rows.forEach((row) => map.set(Number(row[field]), row));
  return [...map.values()];
}

function flag(value) {
  return value === true || value === 1 || value === '1';
}

async function applyDump(bucket) {
  if (bucket.categorias) {
    assignIds(bucket.categorias, 'id_categoria');
    const rows = dedupe(bucket.categorias, 'id_categoria').map((row) => ({
      id_categoria: Number(row.id_categoria),
      nombre: text(row.nombre),
      descripcion: text(row.descripcion),
      icono: text(row.icono) || 'bi-flower1'
    }));
    await Categoria.deleteMany({});
    if (rows.length) await Categoria.insertMany(rows);
    await syncCounter('categorias', rows.map((row) => row.id_categoria));
  }

  if (bucket.plantas) {
    assignIds(bucket.plantas, 'id_planta');
    const rows = dedupe(bucket.plantas, 'id_planta').map((row) => ({
      id_planta: Number(row.id_planta),
      id_categoria: Number(row.id_categoria),
      nombre: text(row.nombre),
      nombre_cientifico: text(row.nombre_cientifico),
      descripcion: text(row.descripcion),
      cuidados: text(row.cuidados),
      precio: Number(row.precio) || 0,
      stock: Number(row.stock) || 0,
      imagen: text(row.imagen) || 'default.jpg',
      destacada: flag(row.destacada),
      fecha_creacion: parseDate(row.fecha_creacion)
    }));
    await Planta.deleteMany({});
    if (rows.length) await Planta.insertMany(rows);
    await syncCounter('plantas', rows.map((row) => row.id_planta));
  }

  if (bucket.usuarios) {
    assignIds(bucket.usuarios, 'id_usuario');
    const rows = dedupe(bucket.usuarios, 'id_usuario').map((row) => ({
      id_usuario: Number(row.id_usuario),
      nombre: text(row.nombre),
      usuario: text(row.usuario),
      email: text(row.email),
      password: text(row.password),
      telefono: text(row.telefono),
      direccion: text(row.direccion),
      ciudad: text(row.ciudad),
      rol: row.rol === 'admin' ? 'admin' : 'cliente',
      fecha_registro: parseDate(row.fecha_registro)
    })).filter((row) => row.usuario && row.email && row.password);
    await Usuario.deleteMany({});
    if (rows.length) await Usuario.insertMany(rows);
    await syncCounter('usuarios', rows.map((row) => row.id_usuario));
  }

  if (bucket.carrito) {
    const grouped = new Map();
    bucket.carrito.forEach((row) => {
      const idUsuario = Number(row.id_usuario);
      const idPlanta = Number(row.id_planta);
      const cantidad = Math.max(1, Number(row.cantidad) || 1);
      if (!idUsuario || !idPlanta) return;
      const items = grouped.get(idUsuario) || [];
      const existing = items.find((item) => item.id_planta === idPlanta);
      if (existing) existing.cantidad += cantidad;
      else items.push({ id_planta: idPlanta, cantidad });
      grouped.set(idUsuario, items);
    });
    await Carrito.deleteMany({});
    const docs = [...grouped.entries()].map(([id_usuario, items]) => ({
      id_usuario,
      items,
      fecha_agregado: new Date()
    }));
    if (docs.length) await Carrito.insertMany(docs);
  }

  if (bucket.pedidos || bucket.pedido_detalle) {
    const pedidos = bucket.pedidos ? [...bucket.pedidos] : [];
    assignIds(pedidos, 'id_pedido');
    const uniquePedidos = dedupe(pedidos, 'id_pedido');
    const plantas = await Planta.find({}, { id_planta: 1, nombre: 1 }).lean();
    const nombres = new Map(plantas.map((planta) => [planta.id_planta, planta.nombre]));
    const detalles = new Map();
    (bucket.pedido_detalle || []).forEach((row) => {
      const idPedido = Number(row.id_pedido);
      const list = detalles.get(idPedido) || [];
      const idPlanta = Number(row.id_planta);
      list.push({
        id_planta: idPlanta,
        nombre: nombres.get(idPlanta) || `Planta ${idPlanta}`,
        cantidad: Math.max(1, Number(row.cantidad) || 1),
        precio_unitario: Number(row.precio_unitario) || 0
      });
      detalles.set(idPedido, list);
    });
    const docs = uniquePedidos.map((row) => ({
      id_pedido: Number(row.id_pedido),
      id_usuario: Number(row.id_usuario),
      fecha_pedido: parseDate(row.fecha_pedido),
      total: Number(row.total) || 0,
      estado: ESTADOS.has(row.estado) ? row.estado : 'pendiente',
      direccion_envio: text(row.direccion_envio),
      ciudad_envio: text(row.ciudad_envio),
      telefono_contacto: text(row.telefono_contacto),
      notas: text(row.notas),
      detalle: detalles.get(Number(row.id_pedido)) || []
    })).filter((row) => row.id_usuario && row.direccion_envio);
    await Pedido.deleteMany({});
    if (docs.length) await Pedido.insertMany(docs);
    await syncCounter('pedidos', docs.map((row) => row.id_pedido));
  }

  if (bucket.historial_navegacion) {
    assignIds(bucket.historial_navegacion, 'id_historial');
    const rows = dedupe(bucket.historial_navegacion, 'id_historial').map((row) => ({
      id_historial: Number(row.id_historial),
      id_usuario: row.id_usuario == null || row.id_usuario === '' ? null : Number(row.id_usuario),
      ip_address: text(row.ip_address),
      pagina: text(row.pagina),
      url: text(row.url),
      fecha_visita: parseDate(row.fecha_visita)
    })).filter((row) => row.pagina && row.url);
    await Historial.deleteMany({});
    if (rows.length) await Historial.insertMany(rows);
    await syncCounter('historial', rows.map((row) => row.id_historial));
  }

  if (bucket.contactos) {
    assignIds(bucket.contactos, 'id_contacto');
    const rows = dedupe(bucket.contactos, 'id_contacto').map((row) => ({
      id_contacto: Number(row.id_contacto),
      nombre: text(row.nombre),
      email: text(row.email),
      telefono: text(row.telefono),
      asunto: text(row.asunto),
      mensaje: text(row.mensaje),
      leido: flag(row.leido),
      fecha: parseDate(row.fecha)
    })).filter((row) => row.nombre && row.email && row.mensaje);
    await Contacto.deleteMany({});
    if (rows.length) await Contacto.insertMany(rows);
    await syncCounter('contactos', rows.map((row) => row.id_contacto));
  }
}

async function importFile(filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const bucket = parseSqlDump(sql);
  await applyDump(bucket);
  return bucket;
}

async function ensureAdmin() {
  const existing = await Usuario.findOne({ usuario: 'admin' }).collation({ locale: 'es', strength: 2 });
  if (existing) return existing;
  const { nextId } = require('./models');
  const id = await nextId('usuarios');
  return Usuario.create({
    id_usuario: id,
    nombre: 'Administrador EcoFlora',
    usuario: 'admin',
    email: 'admin@ecoflora.com',
    password: await hashPassword('Admin123'),
    telefono: '3000000000',
    direccion: 'Calle Principal 123',
    ciudad: 'Bogotá',
    rol: 'admin',
    fecha_registro: new Date()
  });
}

async function importIfEmpty() {
  const count = await Categoria.countDocuments();
  if (count > 0) return false;
  const file = resolveSqlPath();
  await importFile(file);
  await ensureAdmin();
  return true;
}

module.exports = {
  resolveSqlPath,
  parseSqlDump,
  importFile,
  ensureAdmin,
  importIfEmpty
};
