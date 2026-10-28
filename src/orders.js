const mongoose = require('mongoose');
const { Planta, Pedido, nextId } = require('./models');
const { clearUserCart } = require('./cart');

class StockError extends Error {
  constructor() {
    super('No hay stock suficiente para completar el pedido.');
    this.code = 'STOCK';
  }
}

function isTransactionUnsupported(error) {
  const parts = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    parts.push(current.message, current.errmsg, current.codeName);
    current = current.cause || current.errorResponse;
  }
  return /replica set|Transaction numbers are only allowed/i.test(parts.filter(Boolean).join(' '));
}

async function restoreStock(items) {
  for (const item of items) {
    await Planta.updateOne({ id_planta: item.id_planta }, { $inc: { stock: item.cantidad } });
  }
}

async function buildOrderDoc(idUsuario, items, envio, session) {
  const decremented = [];
  let pedido = null;
  try {
    for (const item of items) {
      const options = { new: true };
      if (session) options.session = session;
      const updated = await Planta.findOneAndUpdate(
        { id_planta: item.id_planta, stock: { $gte: item.cantidad } },
        { $inc: { stock: -item.cantidad } },
        options
      );
      if (!updated) throw new StockError();
      decremented.push(item);
    }

    const detalle = items.map((item) => ({
      id_planta: item.id_planta,
      nombre: item.nombre,
      cantidad: item.cantidad,
      precio_unitario: item.precio
    }));
    const total = detalle.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0);
    const idPedido = await nextId('pedidos', session);
    const doc = {
      id_pedido: idPedido,
      id_usuario: idUsuario,
      total,
      estado: 'pendiente',
      direccion_envio: envio.direccion,
      ciudad_envio: envio.ciudad,
      telefono_contacto: envio.telefono,
      notas: envio.notas,
      detalle,
      fecha_pedido: new Date()
    };
    const created = await Pedido.create([doc], session ? { session } : undefined);
    pedido = created[0];
    await clearUserCart(idUsuario, session);
    return pedido;
  } catch (error) {
    if (!session) {
      if (pedido) await Pedido.deleteOne({ id_pedido: pedido.id_pedido });
      await restoreStock(decremented);
    }
    throw error;
  }
}

async function placeOrder(idUsuario, items, envio) {
  const session = await mongoose.startSession();
  try {
    let pedido;
    await session.withTransaction(async () => {
      pedido = await buildOrderDoc(idUsuario, items, envio, session);
    });
    return pedido;
  } catch (error) {
    if (error instanceof StockError || error.code === 'STOCK') throw error;
    if (isTransactionUnsupported(error)) {
      return buildOrderDoc(idUsuario, items, envio, null);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { placeOrder, StockError };
