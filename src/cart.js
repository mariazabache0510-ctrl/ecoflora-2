const { Planta, Carrito } = require('./models');

async function cartCount(req) {
  if (req.session.id_usuario) {
    const cart = await Carrito.findOne({ id_usuario: req.session.id_usuario }).lean();
    return (cart?.items || []).reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
  }
  const guest = req.session.sesion_carrito || {};
  return Object.values(guest).reduce((sum, qty) => sum + Number(qty || 0), 0);
}

async function getCartItems(req) {
  if (req.session.id_usuario) {
    const cart = await Carrito.findOne({ id_usuario: req.session.id_usuario }).lean();
    const lines = cart?.items || [];
    if (!lines.length) return [];
    const plants = await Planta.find({ id_planta: { $in: lines.map((line) => line.id_planta) } }).lean();
    const byId = new Map(plants.map((plant) => [plant.id_planta, plant]));
    return lines.map((line) => {
      const plant = byId.get(line.id_planta);
      if (!plant) return null;
      return { ...plant, cantidad: line.cantidad };
    }).filter(Boolean);
  }

  const guest = req.session.sesion_carrito || {};
  const ids = Object.keys(guest).map((id) => Number(id)).filter((id) => id > 0);
  if (!ids.length) return [];
  const plants = await Planta.find({ id_planta: { $in: ids } }).lean();
  const byId = new Map(plants.map((plant) => [plant.id_planta, plant]));
  return ids.map((id) => {
    const plant = byId.get(id);
    if (!plant) return null;
    return { ...plant, cantidad: Number(guest[id] ?? guest[String(id)] ?? 0) };
  }).filter((item) => item && item.cantidad > 0);
}

async function addToUserCart(idUsuario, idPlanta, cantidad, stock) {
  const cart = await Carrito.findOne({ id_usuario: idUsuario });
  const qty = Math.min(Math.max(1, cantidad), stock);
  if (!cart) {
    await Carrito.create({
      id_usuario: idUsuario,
      items: [{ id_planta: idPlanta, cantidad: qty }]
    });
    return;
  }
  const item = cart.items.find((line) => line.id_planta === idPlanta);
  if (item) item.cantidad = Math.min(item.cantidad + cantidad, stock);
  else cart.items.push({ id_planta: idPlanta, cantidad: qty });
  await cart.save();
}

async function addItem(req, idPlanta, cantidad) {
  const planta = await Planta.findOne({ id_planta: idPlanta }).lean();
  const qty = Math.max(1, Number(cantidad) || 1);
  if (!planta || planta.stock < qty) return false;
  if (req.session.id_usuario) {
    await addToUserCart(req.session.id_usuario, idPlanta, qty, planta.stock);
    return true;
  }
  const guest = { ...(req.session.sesion_carrito || {}) };
  const prev = Number(guest[idPlanta] ?? guest[String(idPlanta)] ?? 0);
  guest[String(idPlanta)] = Math.min(prev + qty, planta.stock);
  req.session.sesion_carrito = guest;
  return true;
}

async function updateQuantities(req, cantidades) {
  const entries = Object.entries(cantidades || {});
  if (req.session.id_usuario) {
    const cart = await Carrito.findOne({ id_usuario: req.session.id_usuario });
    if (!cart) return;
    for (const [id, raw] of entries) {
      const idPlanta = Number(id);
      const planta = await Planta.findOne({ id_planta: idPlanta }).lean();
      let cantidad = Math.max(1, parseInt(raw, 10) || 1);
      if (planta && planta.stock >= 1) cantidad = Math.min(cantidad, planta.stock);
      const item = cart.items.find((line) => line.id_planta === idPlanta);
      if (item) item.cantidad = cantidad;
    }
    cart.markModified('items');
    await cart.save();
    return;
  }
  const guest = { ...(req.session.sesion_carrito || {}) };
  for (const [id, raw] of entries) {
    if (!Object.prototype.hasOwnProperty.call(guest, String(id)) && !Object.prototype.hasOwnProperty.call(guest, Number(id))) {
      continue;
    }
    const planta = await Planta.findOne({ id_planta: Number(id) }).lean();
    let cantidad = Math.max(1, parseInt(raw, 10) || 1);
    if (planta && planta.stock >= 1) cantidad = Math.min(cantidad, planta.stock);
    delete guest[id];
    guest[String(id)] = cantidad;
  }
  req.session.sesion_carrito = guest;
}

async function removeItem(req, idPlanta) {
  if (req.session.id_usuario) {
    await Carrito.updateOne(
      { id_usuario: req.session.id_usuario },
      { $pull: { items: { id_planta: idPlanta } } }
    );
    return;
  }
  const guest = { ...(req.session.sesion_carrito || {}) };
  delete guest[idPlanta];
  delete guest[String(idPlanta)];
  req.session.sesion_carrito = guest;
}

async function mergeGuestCart(req, idUsuario) {
  const guest = req.session.sesion_carrito || {};
  for (const [id, raw] of Object.entries(guest)) {
    const planta = await Planta.findOne({ id_planta: Number(id) }).lean();
    const qty = Math.max(1, Number(raw) || 1);
    if (!planta || planta.stock < 1) continue;
    await addToUserCart(idUsuario, Number(id), Math.min(qty, planta.stock), planta.stock);
  }
  delete req.session.sesion_carrito;
}

async function clearUserCart(idUsuario, session) {
  const options = session ? { session } : {};
  await Carrito.deleteOne({ id_usuario: idUsuario }, options);
}

module.exports = {
  cartCount,
  getCartItems,
  addItem,
  updateQuantities,
  removeItem,
  mergeGuestCart,
  clearUserCart
};
