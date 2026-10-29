const { Usuario, Categoria, Planta, Pedido, Historial, Contacto, Carrito, nextId } = require('./models');
const { hashPassword, verifyPassword } = require('./passwords');
const { getCartItems, addItem, updateQuantities, removeItem, mergeGuestCart } = require('./cart');
const { placeOrder, StockError } = require('./orders');
const { escapeRegex, ESTADOS } = require('./helpers');
const { enviarMensajeContacto, enviarAvisoDomicilio } = require('./mailer');
const { crearLimitador } = require('./limite');

// Como máximo 5 mensajes por IP cada 10 minutos en el formulario de contacto.
const limiteContacto = crearLimitador({ max: 5, ventanaMs: 10 * 60 * 1000 });
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Con 5 unidades o menos se considera "poco stock" (igual que en las tarjetas del catálogo).
const STOCK_BAJO = 5;
const LIMITE_STOCK = 100000;

const collation = { locale: 'es', strength: 2 };

function requireAdmin(req, res, next) {
  if (!req.session.id_usuario || req.session.rol !== 'admin') {
    return res.redirect('/?error=' + encodeURIComponent('Acceso no autorizado'));
  }
  return next();
}

function requireCliente(req, res, next) {
  if (!req.session.id_usuario || req.session.rol !== 'cliente') {
    return res.redirect('/?error=' + encodeURIComponent('Debes iniciar sesión'));
  }
  return next();
}

function cantidadesFromBody(body) {
  const cantidades = {};
  Object.entries(body || {}).forEach(([key, value]) => {
    const match = /^cant_(\d+)$/.exec(key);
    if (match) cantidades[match[1]] = value;
  });
  return cantidades;
}

function requireLogin(req, res, next) {
  if (!req.session.id_usuario) return res.redirect('/login');
  return next();
}

async function withCategoryNames(plantas) {
  const categorias = await Categoria.find().sort({ id_categoria: 1 }).lean();
  const names = new Map(categorias.map((categoria) => [categoria.id_categoria, categoria.nombre]));
  return {
    categorias,
    plantas: plantas.map((planta) => ({
      ...planta,
      categoria: names.get(planta.id_categoria) || ''
    }))
  };
}

function registerRoutes(app) {
  app.get('/', async (req, res, next) => {
    try {
      const categorias = await Categoria.find().sort({ id_categoria: 1 }).limit(5).lean();
      const destacadas = await Planta.find({ destacada: true }).sort({ id_planta: 1 }).limit(6).lean();
      const named = await withCategoryNames(destacadas);
      res.render('index', { categorias, destacadas: named.plantas });
    } catch (error) {
      next(error);
    }
  });

  app.get('/catalogo', async (req, res, next) => {
    try {
      const categoriaFiltro = parseInt(req.query.categoria, 10) || 0;
      const busqueda = String(req.query.busqueda || '').trim();
      const filter = {};
      if (categoriaFiltro > 0) filter.id_categoria = categoriaFiltro;
      if (busqueda) {
        const regex = new RegExp(escapeRegex(busqueda), 'i');
        filter.$or = [{ nombre: regex }, { nombre_cientifico: regex }, { descripcion: regex }];
      }
      const plantas = await Planta.find(filter).sort({ destacada: -1, nombre: 1 }).lean();
      const named = await withCategoryNames(plantas);
      res.render('catalogo', {
        plantas: named.plantas,
        categorias: named.categorias,
        categoriaFiltro,
        busqueda
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/planta/:id', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10) || 0;
      const planta = await Planta.findOne({ id_planta: id }).lean();
      if (!planta) return res.render('planta', { planta: null, relacionadas: [] });
      const relacionadas = await Planta.find({
        id_categoria: planta.id_categoria,
        id_planta: { $ne: id }
      }).sort({ destacada: -1, id_planta: 1 }).limit(4).lean();
      const named = await withCategoryNames([planta, ...relacionadas]);
      return res.render('planta', {
        planta: named.plantas[0],
        relacionadas: named.plantas.slice(1)
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/nosotros', async (req, res, next) => {
    try {
      const destacadas = await Planta.find({ destacada: true }).sort({ id_planta: 1 }).limit(3).lean();
      res.render('nosotros', { destacadas });
    } catch (error) {
      next(error);
    }
  });

  app.get('/contacto', (req, res) => {
    res.render('contacto', { error: '', exito: '', valores: {} });
  });

  app.post('/contacto', async (req, res, next) => {
    try {
      const valores = {
        nombre: String(req.body.nombre || '').trim().slice(0, 100),
        email: String(req.body.email || '').trim().slice(0, 150),
        telefono: String(req.body.telefono || '').trim().slice(0, 30),
        asunto: String(req.body.asunto || '').trim().slice(0, 120),
        mensaje: String(req.body.mensaje || '').trim().slice(0, 2000)
      };
      const exito = 'Mensaje enviado correctamente. Te contactaremos pronto.';

      // Campo trampa oculto: solo los robots lo llenan. Se responde como si todo hubiera salido bien.
      if (String(req.body.sitio_web || '').trim()) {
        return res.render('contacto', { error: '', exito, valores: {} });
      }
      if (!valores.nombre || !valores.email || !valores.mensaje) {
        return res.status(400).render('contacto', { error: 'Completa los campos obligatorios.', exito: '', valores });
      }
      if (!CORREO_VALIDO.test(valores.email)) {
        return res.status(400).render('contacto', { error: 'Escribe un correo válido para poder responderte.', exito: '', valores });
      }
      if (!limiteContacto.permitir(req.ip || 'sin-ip')) {
        return res.status(429).render('contacto', {
          error: 'Enviaste varios mensajes seguidos. Intenta de nuevo en unos minutos o escríbenos por WhatsApp.',
          exito: '',
          valores
        });
      }

      // Primero se guarda (así nunca se pierde) y después se intenta el correo.
      const id = await nextId('contactos');
      const registro = await Contacto.create({ id_contacto: id, ...valores, leido: false });
      const envio = await enviarMensajeContacto({ ...valores, fecha: registro.fecha });
      if (!envio.enviado) console.error(`Contacto #${id}: no se pudo enviar el correo (${envio.motivo})`);
      await Contacto.updateOne(
        { id_contacto: id },
        { correo_enviado: envio.enviado, error_envio: envio.enviado ? '' : String(envio.motivo || '').slice(0, 300) }
      );

      return res.render('contacto', { error: '', exito, valores: {} });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/login', (req, res) => {
    res.render('login', { error: '' });
  });

  app.post('/login', async (req, res, next) => {
    try {
      const usuario = String(req.body.usuario || '').trim();
      const password = String(req.body.password || '').trim();
      if (!usuario || !password) {
        return res.render('login', { error: 'Completa todos los campos.' });
      }
      const user = await Usuario.findOne({ $or: [{ usuario }, { email: usuario }] }).collation(collation);
      if (!user) return res.render('login', { error: 'Usuario no encontrado.' });
      const ok = await verifyPassword(password, user.password);
      if (!ok) return res.render('login', { error: 'Contraseña incorrecta.' });
      req.session.id_usuario = user.id_usuario;
      req.session.nombre = user.nombre;
      req.session.usuario = user.usuario;
      req.session.rol = user.rol;
      await mergeGuestCart(req, user.id_usuario);
      const destino = user.rol === 'admin' ? '/admin' : '/';
      return req.session.save(() => res.redirect(destino));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/registro', (req, res) => {
    res.render('registro', { error: '', exito: '' });
  });

  app.post('/registro', async (req, res, next) => {
    try {
      const nombre = String(req.body.nombre || '').trim();
      const usuario = String(req.body.usuario || '').trim();
      const email = String(req.body.email || '').trim();
      const telefono = String(req.body.telefono || '').trim();
      const direccion = String(req.body.direccion || '').trim();
      const ciudad = String(req.body.ciudad || '').trim();
      const password = String(req.body.password || '').trim();
      const confirmar = String(req.body.confirmar || '').trim();
      if (!nombre || !usuario || !email || !password) {
        return res.render('registro', { error: 'Los campos con * son obligatorios.', exito: '' });
      }
      if (password !== confirmar) {
        return res.render('registro', { error: 'Las contraseñas no coinciden.', exito: '' });
      }
      if (password.length < 5) {
        return res.render('registro', { error: 'La contraseña debe tener al menos 5 caracteres.', exito: '' });
      }
      const exists = await Usuario.findOne({ $or: [{ usuario }, { email }] }).collation(collation);
      if (exists) {
        return res.render('registro', { error: 'El usuario o email ya están registrados.', exito: '' });
      }
      const id = await nextId('usuarios');
      await Usuario.create({
        id_usuario: id,
        nombre,
        usuario,
        email,
        password: await hashPassword(password),
        telefono,
        direccion,
        ciudad,
        rol: 'cliente'
      });
      return res.render('registro', { error: '', exito: 'Registro exitoso. Ahora puedes iniciar sesión.' });
    } catch (error) {
      if (error.code === 11000) {
        return res.render('registro', { error: 'El usuario o email ya están registrados.', exito: '' });
      }
      return next(error);
    }
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  app.post('/carrito', async (req, res, next) => {
    try {
      if (req.body.accion === 'agregar') {
        const idPlanta = parseInt(req.body.id_planta, 10) || 0;
        const cantidad = Math.max(1, parseInt(req.body.cantidad, 10) || 1);
        await addItem(req, idPlanta, cantidad);
        return req.session.save(() => res.redirect('/carrito'));
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'actualizar')) {
        await updateQuantities(req, cantidadesFromBody(req.body));
        return req.session.save(() => res.redirect('/carrito'));
      }
      return res.redirect('/carrito');
    } catch (error) {
      return next(error);
    }
  });

  app.get('/carrito', async (req, res, next) => {
    try {
      if (req.query.eliminar) {
        await removeItem(req, parseInt(req.query.eliminar, 10) || 0);
        return req.session.save(() => res.redirect('/carrito'));
      }
      const items = await getCartItems(req);
      const total = items.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
      return res.render('carrito', { items, total });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/confirmar-pedido', requireLogin, async (req, res, next) => {
    try {
      const items = await getCartItems(req);
      if (!items.length) return res.redirect('/carrito');
      const total = items.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
      return res.render('confirmar', { items, total, error: '' });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/confirmar-pedido', requireLogin, async (req, res, next) => {
    try {
      const items = await getCartItems(req);
      if (!items.length) return res.redirect('/carrito');
      const total = items.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
      const direccion = String(req.body.direccion || '').trim();
      const ciudad = String(req.body.ciudad || '').trim();
      const telefono = String(req.body.telefono || '').trim();
      const notas = String(req.body.notas || '').trim();
      if (!direccion || !telefono) {
        return res.render('confirmar', {
          items,
          total,
          error: 'La dirección y teléfono son obligatorios.'
        });
      }
      const pedido = await placeOrder(req.session.id_usuario, items, { direccion, ciudad, telefono, notas });
      avisarDomicilio(pedido, req.session.id_usuario);
      const destino = req.session.rol === 'cliente' ? '/usuario/domicilios?exito=1' : '/admin/pedidos';
      return res.redirect(destino);
    } catch (error) {
      if (error instanceof StockError || error.code === 'STOCK' || /pedido/i.test(error.message || '')) {
        try {
          const items = await getCartItems(req);
          const total = items.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
          const message = error.code === 'STOCK'
            ? error.message
            : 'Error al procesar el pedido. Intenta de nuevo.';
          return res.render('confirmar', { items, total, error: message });
        } catch (renderError) {
          return next(renderError);
        }
      }
      return next(error);
    }
  });

  app.get('/usuario', requireCliente, (req, res) => {
    res.render('usuario/panel');
  });

  app.get('/usuario/domicilios', requireCliente, async (req, res, next) => {
    try {
      const pedidos = await Pedido.find({ id_usuario: req.session.id_usuario }).sort({ fecha_pedido: -1 }).lean();
      res.render('usuario/domicilios', { pedidos, exito: req.query.exito === '1' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/usuario/historial', requireCliente, async (req, res, next) => {
    try {
      const historial = await Historial.find({ id_usuario: req.session.id_usuario })
        .sort({ fecha_visita: -1 })
        .limit(50)
        .lean();
      res.render('usuario/historial', { historial });
    } catch (error) {
      next(error);
    }
  });

  app.get('/usuario/perfil', requireCliente, async (req, res, next) => {
    try {
      const datos = await Usuario.findOne({ id_usuario: req.session.id_usuario }).lean();
      res.render('usuario/perfil', {
        datos,
        actualizado: req.query.actualizado === '1',
        error: typeof req.query.error === 'string' ? req.query.error : ''
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/usuario/perfil', requireCliente, async (req, res, next) => {
    try {
      const nombre = String(req.body.nombre || '').trim();
      const email = String(req.body.email || '').trim();
      const telefono = String(req.body.telefono || '').trim();
      const direccion = String(req.body.direccion || '').trim();
      const ciudad = String(req.body.ciudad || '').trim();
      if (!nombre || !email) {
        return res.redirect('/usuario/perfil?error=' + encodeURIComponent('Nombre y email son obligatorios'));
      }
      const taken = await Usuario.findOne({
        email,
        id_usuario: { $ne: req.session.id_usuario }
      }).collation(collation);
      if (taken) {
        return res.redirect('/usuario/perfil?error=' + encodeURIComponent('El email ya está registrado por otro usuario'));
      }
      await Usuario.updateOne(
        { id_usuario: req.session.id_usuario },
        { $set: { nombre, email, telefono, direccion, ciudad } }
      );
      req.session.nombre = nombre;
      return req.session.save(() => res.redirect('/usuario/perfil?actualizado=1'));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/admin', requireAdmin, async (req, res, next) => {
    try {
      const [totalPlantas, totalPedidos, totalUsuarios, pendientes, mensajesSinLeer, stockBajo] = await Promise.all([
        Planta.countDocuments(),
        Pedido.countDocuments(),
        Usuario.countDocuments({ rol: 'cliente' }),
        Pedido.countDocuments({ estado: 'pendiente' }),
        Contacto.countDocuments({ leido: { $ne: true } }),
        Planta.countDocuments({ stock: { $lte: STOCK_BAJO } })
      ]);
      res.render('admin/panel', { totalPlantas, totalPedidos, totalUsuarios, pendientes, mensajesSinLeer, stockBajo });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/usuarios', requireAdmin, async (req, res, next) => {
    try {
      const usuarios = await Usuario.find({}, { password: 0 }).sort({ fecha_registro: -1 }).lean();
      res.render('admin/usuarios', {
        usuarios,
        eliminado: req.query.eliminado === '1',
        actualizado: req.query.actualizado === '1',
        error: typeof req.query.error === 'string' ? req.query.error : ''
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin/usuarios/:id/editar', requireAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10) || 0;
      const usuario = await Usuario.findOne({ id_usuario: id }).lean();
      if (!usuario) return res.redirect('/admin/usuarios');
      return res.render('admin/editar', { usuario });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/admin/usuarios/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10) || 0;
      const nombre = String(req.body.nombre || '').trim();
      const usuario = String(req.body.usuario || '').trim();
      const email = String(req.body.email || '').trim();
      const telefono = String(req.body.telefono || '').trim();
      const direccion = String(req.body.direccion || '').trim();
      const ciudad = String(req.body.ciudad || '').trim();
      const rol = req.body.rol === 'admin' ? 'admin' : 'cliente';
      const password = String(req.body.password || '').trim();
      if (!nombre || !usuario || !email) {
        return res.redirect('/admin/usuarios?error=' + encodeURIComponent('No se pudo actualizar'));
      }
      const taken = await Usuario.findOne({
        id_usuario: { $ne: id },
        $or: [{ usuario }, { email }]
      }).collation(collation);
      if (taken) {
        return res.redirect('/admin/usuarios?error=' + encodeURIComponent('El usuario o email ya están registrados'));
      }
      const update = { nombre, usuario, email, telefono, direccion, ciudad, rol };
      if (password) update.password = await hashPassword(password);
      const result = await Usuario.updateOne({ id_usuario: id }, { $set: update });
      if (!result.matchedCount) {
        return res.redirect('/admin/usuarios?error=' + encodeURIComponent('No se pudo actualizar'));
      }
      if (id === req.session.id_usuario) {
        req.session.nombre = nombre;
        req.session.usuario = usuario;
        req.session.rol = rol;
        return req.session.save(() => res.redirect('/admin/usuarios?actualizado=1'));
      }
      return res.redirect('/admin/usuarios?actualizado=1');
    } catch (error) {
      return next(error);
    }
  });

  app.get('/admin/usuarios/:id/eliminar', requireAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10) || 0;
      if (id === req.session.id_usuario) {
        return res.redirect('/admin/usuarios?error=' + encodeURIComponent('No puedes eliminar tu propia cuenta'));
      }
      await Carrito.deleteOne({ id_usuario: id });
      await Historial.deleteMany({ id_usuario: id });
      await Pedido.deleteMany({ id_usuario: id });
      const result = await Usuario.deleteOne({ id_usuario: id });
      if (!result.deletedCount) {
        return res.redirect('/admin/usuarios?error=' + encodeURIComponent('No se pudo eliminar'));
      }
      return res.redirect('/admin/usuarios?eliminado=1');
    } catch (error) {
      return next(error);
    }
  });

  app.get('/admin/pedidos', requireAdmin, async (req, res, next) => {
    try {
      res.render('admin/pedidos', { pedidos: await pedidosConCliente() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/pedidos', requireAdmin, async (req, res, next) => {
    try {
      if (Object.prototype.hasOwnProperty.call(req.body, 'cambiar_estado')) {
        const id = parseInt(req.body.id_pedido, 10) || 0;
        const estado = String(req.body.estado || '');
        if (ESTADOS.includes(estado)) {
          await Pedido.updateOne({ id_pedido: id }, { $set: { estado } });
        }
      }
      res.redirect('/admin/pedidos');
    } catch (error) {
      next(error);
    }
  });

  // Mensajes del formulario de contacto (respaldo por si el correo no llega).
  app.get('/admin/mensajes', requireAdmin, async (req, res, next) => {
    try {
      const mensajes = await Contacto.find().sort({ fecha: -1 }).limit(200).lean();
      const sinLeer = mensajes.filter((mensaje) => !mensaje.leido).length;
      res.render('admin/mensajes', { mensajes, sinLeer, eliminado: req.query.eliminado === '1' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/mensajes/:id/leido', requireAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10) || 0;
      await Contacto.updateOne({ id_contacto: id }, { $set: { leido: req.body.leido !== '0' } });
      res.redirect('/admin/mensajes');
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/mensajes/:id/eliminar', requireAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10) || 0;
      await Contacto.deleteOne({ id_contacto: id });
      res.redirect('/admin/mensajes?eliminado=1');
    } catch (error) {
      next(error);
    }
  });

  // Inventario: añadir, quitar o corregir el stock de cada planta.
  app.get('/admin/inventario', requireAdmin, async (req, res, next) => {
    try {
      const todas = await Planta.find().sort({ nombre: 1 }).collation(collation).lean();
      const { plantas } = await withCategoryNames(todas);
      const aviso = req.session.aviso_inventario || null;
      delete req.session.aviso_inventario;
      const resumen = {
        total: plantas.length,
        agotadas: plantas.filter((planta) => planta.stock <= 0).length,
        poco: plantas.filter((planta) => planta.stock > 0 && planta.stock <= STOCK_BAJO).length,
        unidades: plantas.reduce((suma, planta) => suma + Math.max(0, planta.stock), 0)
      };
      res.render('admin/inventario', { plantas, aviso, resumen, STOCK_BAJO });
    } catch (error) {
      next(error);
    }
  });

  app.post('/admin/inventario/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10) || 0;
      const volver = (tipo, texto) => {
        req.session.aviso_inventario = { tipo, texto, id };
        return req.session.save(() => res.redirect(`/admin/inventario#planta-${id}`));
      };

      const planta = await Planta.findOne({ id_planta: id }).lean();
      if (!planta) return volver('error', 'No encontramos esa planta.');

      const accion = String(req.body.accion || '');
      if (!['agregar', 'quitar', 'fijar'].includes(accion)) return volver('error', 'Elige qué quieres hacer con el stock.');
      const texto = String(req.body.cantidad ?? '').trim();
      if (!/^\d{1,7}$/.test(texto)) return volver('error', 'Escribe una cantidad válida: un número entero, sin decimales ni signos.');
      const cantidad = Number(texto);
      if (accion !== 'fijar' && cantidad < 1) return volver('error', 'La cantidad debe ser de al menos 1 unidad.');
      if (cantidad > LIMITE_STOCK) return volver('error', `La cantidad máxima por planta es de ${LIMITE_STOCK} unidades.`);

      let antes;
      let despues;
      if (accion === 'agregar') {
        // Operaciones atómicas: si entra un pedido al mismo tiempo, no se pierde ninguna unidad.
        const previo = await Planta.findOneAndUpdate(
          { id_planta: id, stock: { $lte: LIMITE_STOCK - cantidad } },
          { $inc: { stock: cantidad } },
          { new: false }
        ).lean();
        if (!previo) return volver('error', `Con ${cantidad} unidades más, ${planta.nombre} superaría el máximo de ${LIMITE_STOCK}.`);
        antes = previo.stock;
        despues = antes + cantidad;
        return volver('ok', `Se añadieron ${cantidad} unidad${cantidad === 1 ? '' : 'es'} a ${planta.nombre}. Pasó de ${antes} a ${despues} disponibles.`);
      }
      if (accion === 'quitar') {
        const previo = await Planta.findOneAndUpdate(
          { id_planta: id, stock: { $gte: cantidad } },
          { $inc: { stock: -cantidad } },
          { new: false }
        ).lean();
        if (!previo) {
          const actual = await Planta.findOne({ id_planta: id }).lean();
          return volver('error', `No puedes quitar ${cantidad} unidades de ${planta.nombre}: solo hay ${actual ? Math.max(0, actual.stock) : 0}.`);
        }
        antes = previo.stock;
        despues = antes - cantidad;
        return volver('ok', `Se quitaron ${cantidad} unidad${cantidad === 1 ? '' : 'es'} de ${planta.nombre}. Pasó de ${antes} a ${despues} disponibles.`);
      }
      const previo = await Planta.findOneAndUpdate({ id_planta: id }, { $set: { stock: cantidad } }, { new: false }).lean();
      antes = previo ? previo.stock : planta.stock;
      return volver('ok', `El stock de ${planta.nombre} quedó en ${cantidad} unidad${cantidad === 1 ? '' : 'es'} (antes: ${antes}).`);
    } catch (error) {
      return next(error);
    }
  });
}

// Avisa por correo al administrador que un cliente pidió un domicilio. Va por detrás: el cliente no espera
// al correo, y si falla el pedido ya quedó guardado y se ve en /admin/pedidos con la marca "Aviso no enviado".
function avisarDomicilio(pedido, idUsuario) {
  (async () => {
    try {
      const cliente = await Usuario.findOne({ id_usuario: idUsuario }).lean();
      const resultado = await enviarAvisoDomicilio(pedido.toObject ? pedido.toObject() : pedido, cliente || {});
      if (!resultado.enviado) console.error(`No se pudo enviar el aviso del domicilio #${pedido.id_pedido}:`, resultado.motivo);
      await Pedido.updateOne(
        { id_pedido: pedido.id_pedido },
        { $set: { aviso_enviado: resultado.enviado, error_aviso: resultado.enviado ? '' : String(resultado.motivo || '').slice(0, 300) } }
      );
    } catch (error) {
      console.error(`Error al avisar del domicilio #${pedido && pedido.id_pedido}:`, error);
    }
  })();
}

async function pedidosConCliente() {
  const pedidos = await Pedido.find().sort({ fecha_pedido: -1 }).lean();
  const ids = [...new Set(pedidos.map((pedido) => pedido.id_usuario))];
  const usuarios = await Usuario.find({ id_usuario: { $in: ids } }).lean();
  const byId = new Map(usuarios.map((usuario) => [usuario.id_usuario, usuario]));
  return pedidos.map((pedido) => {
    const usuario = byId.get(pedido.id_usuario);
    return {
      ...pedido,
      cliente: usuario ? usuario.nombre : 'Usuario',
      email: usuario ? usuario.email : ''
    };
  });
}

module.exports = { registerRoutes };
