const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema(
  { _id: String, seq: { type: Number, default: 0 } },
  { versionKey: false, collection: 'counters' }
);

const usuarioSchema = new mongoose.Schema(
  {
    id_usuario: { type: Number, required: true, unique: true },
    nombre: { type: String, required: true },
    usuario: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String, required: true },
    telefono: { type: String, default: '' },
    direccion: { type: String, default: '' },
    ciudad: { type: String, default: '' },
    rol: { type: String, enum: ['cliente', 'admin'], default: 'cliente' },
    fecha_registro: { type: Date, default: Date.now }
  },
  { versionKey: false, collection: 'usuarios' }
);
usuarioSchema.index({ usuario: 1 }, { unique: true, collation: { locale: 'es', strength: 2 } });
usuarioSchema.index({ email: 1 }, { unique: true, collation: { locale: 'es', strength: 2 } });

const categoriaSchema = new mongoose.Schema(
  {
    id_categoria: { type: Number, required: true, unique: true },
    nombre: { type: String, required: true },
    descripcion: { type: String, default: '' },
    icono: { type: String, default: 'bi-flower1' }
  },
  { versionKey: false, collection: 'categorias' }
);

const plantaSchema = new mongoose.Schema(
  {
    id_planta: { type: Number, required: true, unique: true },
    id_categoria: { type: Number, required: true },
    nombre: { type: String, required: true },
    nombre_cientifico: { type: String, default: '' },
    descripcion: { type: String, required: true },
    cuidados: { type: String, default: '' },
    precio: { type: Number, required: true },
    stock: { type: Number, required: true, default: 0 },
    imagen: { type: String, default: 'default.jpg' },
    destacada: { type: Boolean, default: false },
    fecha_creacion: { type: Date, default: Date.now }
  },
  { versionKey: false, collection: 'plantas' }
);
plantaSchema.index({ id_categoria: 1 });
plantaSchema.index({ destacada: -1, nombre: 1 });

const carritoSchema = new mongoose.Schema(
  {
    id_usuario: { type: Number, required: true, unique: true },
    items: {
      type: [
        {
          _id: false,
          id_planta: { type: Number, required: true },
          cantidad: { type: Number, required: true, default: 1 }
        }
      ],
      default: []
    },
    fecha_agregado: { type: Date, default: Date.now }
  },
  { versionKey: false, collection: 'carritos' }
);

const pedidoSchema = new mongoose.Schema(
  {
    id_pedido: { type: Number, required: true, unique: true },
    id_usuario: { type: Number, required: true },
    fecha_pedido: { type: Date, default: Date.now },
    total: { type: Number, required: true },
    estado: {
      type: String,
      enum: ['pendiente', 'confirmado', 'en_camino', 'entregado', 'cancelado'],
      default: 'pendiente'
    },
    direccion_envio: { type: String, required: true },
    ciudad_envio: { type: String, default: '' },
    telefono_contacto: { type: String, default: '' },
    notas: { type: String, default: '' },
    detalle: {
      type: [
        {
          _id: false,
          id_planta: { type: Number, required: true },
          nombre: { type: String, default: '' },
          cantidad: { type: Number, required: true },
          precio_unitario: { type: Number, required: true }
        }
      ],
      default: []
    }
  },
  { versionKey: false, collection: 'pedidos' }
);
pedidoSchema.index({ id_usuario: 1, fecha_pedido: -1 });

const historialSchema = new mongoose.Schema(
  {
    id_historial: { type: Number, required: true, unique: true },
    id_usuario: { type: Number, default: null },
    ip_address: { type: String, default: '' },
    pagina: { type: String, required: true },
    url: { type: String, required: true },
    fecha_visita: { type: Date, default: Date.now }
  },
  { versionKey: false, collection: 'historial' }
);
historialSchema.index({ id_usuario: 1, fecha_visita: -1 });

const contactoSchema = new mongoose.Schema(
  {
    id_contacto: { type: Number, required: true, unique: true },
    nombre: { type: String, required: true },
    email: { type: String, required: true },
    telefono: { type: String, default: '' },
    asunto: { type: String, default: '' },
    mensaje: { type: String, required: true },
    leido: { type: Boolean, default: false },
    fecha: { type: Date, default: Date.now }
  },
  { versionKey: false, collection: 'contactos' }
);

const Counter = mongoose.model('Counter', counterSchema);
const Usuario = mongoose.model('Usuario', usuarioSchema);
const Categoria = mongoose.model('Categoria', categoriaSchema);
const Planta = mongoose.model('Planta', plantaSchema);
const Carrito = mongoose.model('Carrito', carritoSchema);
const Pedido = mongoose.model('Pedido', pedidoSchema);
const Historial = mongoose.model('Historial', historialSchema);
const Contacto = mongoose.model('Contacto', contactoSchema);

async function nextId(name, session) {
  const options = { new: true, upsert: true, setDefaultsOnInsert: true };
  if (session) options.session = session;
  const counter = await Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, options);
  return counter.seq;
}

async function syncCounter(name, ids) {
  const max = ids.reduce((current, id) => Math.max(current, Number(id) || 0), 0);
  if (max < 1) return;
  await Counter.findByIdAndUpdate(
    name,
    { $max: { seq: max } },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

module.exports = {
  Counter,
  Usuario,
  Categoria,
  Planta,
  Carrito,
  Pedido,
  Historial,
  Contacto,
  nextId,
  syncCounter
};
