// Pantalla del admin para la base federada (Parte 2): estado de los dos servidores, el enlace entre ellos y la consulta federada.

const federada = require('./federada');

let sincronizando = false;

function fechaCorta(valor) {
  if (!valor) return '';
  const fecha = valor instanceof Date ? valor : new Date(String(valor).replace(' ', 'T'));
  if (Number.isNaN(fecha.getTime())) return String(valor);
  const dos = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

function registrarRutasFederada(app, { requireAdmin }) {
  app.get('/admin/federada', requireAdmin, async (req, res, next) => {
    try {
      const base = {
        habilitada: federada.habilitada(),
        datos: null,
        sincronizado: null,
        error: typeof req.query.error === 'string' ? req.query.error : ''
      };
      if (req.query.sincronizado === '1') {
        base.sincronizado = {
          clientes: Number(req.query.c) || 0,
          productos: Number(req.query.p) || 0,
          facturas: Number(req.query.f) || 0,
          omitidas: Number(req.query.o) || 0
        };
      }
      if (base.habilitada) {
        const datos = await federada.panorama();
        datos.facturas = datos.facturas.map((fila) => ({ ...fila, fecha: fechaCorta(fila.fecha) }));
        datos.ventas = datos.ventas.map((fila) => ({ ...fila, fecha: fechaCorta(fila.fecha) }));
        base.datos = datos;
      }
      res.render('admin/federada', { ...base, fechaCorta });
    } catch (error) {
      next(error);
    }
  });

  // Copia todo lo que ya existe en la tienda (clientes, plantas y pedidos) a los dos servidores. Se puede repetir.
  app.post('/admin/federada/sincronizar', requireAdmin, async (req, res, next) => {
    try {
      if (!federada.habilitada()) return res.redirect('/admin/federada');
      if (sincronizando) return res.redirect('/admin/federada?error=' + encodeURIComponent('Ya hay una sincronización en curso.'));
      sincronizando = true;
      try {
        const r = await federada.sincronizarTodo();
        return res.redirect(`/admin/federada?sincronizado=1&c=${r.clientes}&p=${r.productos}&f=${r.facturas}&o=${r.omitidas || 0}`);
      } finally {
        sincronizando = false;
      }
    } catch (error) {
      console.error('Federada: falló la sincronización:', error.message);
      return res.redirect('/admin/federada?error=' + encodeURIComponent('No se pudo sincronizar: ' + String(error.message).slice(0, 160)));
    }
  });
}

module.exports = { registrarRutasFederada };
