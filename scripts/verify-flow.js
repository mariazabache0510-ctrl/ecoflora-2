const base = process.env.BASE_URL || 'http://127.0.0.1:3000';

function assert(condition, message) {
  if (!condition) {
    console.error('FALLO:', message);
    process.exit(1);
  }
  console.log('ok', message);
}

function createClient() {
  const jar = new Map();
  return {
    async request(method, urlPath, body) {
      const headers = { Accept: 'text/html' };
      const cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
      if (cookie) headers.Cookie = cookie;
      let payload;
      if (body) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        payload = new URLSearchParams(body).toString();
      }
      const response = await fetch(base + urlPath, { method, headers, body: payload, redirect: 'manual' });
      const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
      setCookies.forEach((entry) => {
        const [pair] = entry.split(';');
        const index = pair.indexOf('=');
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!value) jar.delete(name);
        else jar.set(name, value);
      });
      const text = await response.text();
      return { status: response.status, text, location: response.headers.get('location') };
    }
  };
}

async function follow(client, method, urlPath, body) {
  let currentMethod = method;
  let currentPath = urlPath;
  let currentBody = body;
  let response;
  for (let hop = 0; hop < 6; hop += 1) {
    response = await client.request(currentMethod, currentPath, currentBody);
    if (response.status < 300 || response.status >= 400 || !response.location) return response;
    const nextUrl = response.location.startsWith('http')
      ? new URL(response.location).pathname + new URL(response.location).search
      : response.location;
    currentMethod = 'GET';
    currentPath = nextUrl;
    currentBody = null;
  }
  return response;
}

async function main() {
  const health = await fetch(base + '/health');
  assert(health.status === 200, 'health responde 200');

  const home = await (await fetch(base + '/', { headers: { Accept: 'text/html' } })).text();
  assert(home.includes('Pothos Dorado'), 'inicio muestra Pothos');
  assert(home.includes('Monstera Deliciosa'), 'inicio muestra Monstera');
  assert(home.includes('$25.000'), 'precio con separador de miles');
  assert(home.includes('Suculentas'), 'inicio muestra categorías');
  assert(home.includes('/css/estilos.css'), 'sirve la hoja de estilos');

  const guest = createClient();
  const catalogo = await guest.request('GET', '/catalogo?busqueda=Lavanda');
  assert(catalogo.status === 200 && catalogo.text.includes('Lavanda'), 'búsqueda encuentra Lavanda');
  assert(!catalogo.text.includes('Monstera Deliciosa'), 'búsqueda no mezcla otras plantas');

  const suculentas = await guest.request('GET', '/catalogo?categoria=3');
  assert(suculentas.text.includes('Echeveria Elegans'), 'filtro de suculentas');
  assert(!suculentas.text.includes('Palma Areca'), 'el filtro oculta otras categorías');

  const vacio = await guest.request('GET', '/catalogo?busqueda=zzzz-no-existe');
  assert(vacio.text.includes('No encontramos plantas'), 'búsqueda sin resultados');

  const ficha = await guest.request('GET', '/planta/2');
  assert(ficha.text.includes('Monstera deliciosa') && ficha.text.includes('Stock: 8'), 'ficha de la monstera');

  const missing = await guest.request('GET', '/planta/99');
  assert(missing.text.includes('Planta no encontrada'), 'planta inexistente');

  const added = await follow(guest, 'POST', '/carrito', { accion: 'agregar', id_planta: '2', cantidad: '2' });
  assert(added.status === 200 && added.text.includes('Monstera Deliciosa') && added.text.includes('$170.000'), 'carrito de invitado');

  const registro = await guest.request('POST', '/registro', {
    nombre: 'Cliente Prueba',
    usuario: 'clienteprueba',
    email: 'clienteprueba@ecoflora.com',
    telefono: '3010000000',
    direccion: 'Carrera 10',
    ciudad: 'Bogotá',
    password: 'clave123',
    confirmar: 'clave123'
  });
  assert(registro.text.includes('Registro exitoso'), 'registro de cliente');

  const duplicado = await guest.request('POST', '/registro', {
    nombre: 'Otro',
    usuario: 'clienteprueba',
    email: 'otro@ecoflora.com',
    password: 'clave123',
    confirmar: 'clave123'
  });
  assert(duplicado.text.includes('ya están registrados'), 'rechaza usuario duplicado');

  const loginMal = await guest.request('POST', '/login', { usuario: 'clienteprueba', password: 'no-es' });
  assert(loginMal.text.includes('Contraseña incorrecta'), 'rechaza una contraseña incorrecta');

  const login = await follow(guest, 'POST', '/login', { usuario: 'clienteprueba', password: 'clave123' });
  assert(login.text.includes('Mi Panel'), 'login de cliente');
  const carrito = await guest.request('GET', '/carrito');
  assert(carrito.text.includes('Monstera Deliciosa'), 'el carrito de invitado se fusiona al ingresar');

  await follow(guest, 'POST', '/carrito', { actualizar: '1', cant_2: '1' });
  const confirmar = await guest.request('GET', '/confirmar-pedido');
  assert(confirmar.text.includes('Confirmar domicilio') && confirmar.text.includes('$85.000'), 'resumen del domicilio');

  const pedido = await follow(guest, 'POST', '/confirmar-pedido', {
    direccion: 'Calle 45 #12-30',
    ciudad: 'Bogotá',
    telefono: '3010000000',
    notas: 'Portería'
  });
  assert(pedido.text.includes('Pedido realizado con éxito'), 'el pedido queda confirmado');
  assert(pedido.text.includes('Monstera Deliciosa') && pedido.text.includes('Calle 45 #12-30'), 'el domicilio guarda el detalle');

  const fichaDespues = await guest.request('GET', '/planta/2');
  assert(fichaDespues.text.includes('Stock: 7'), 'el stock baja en una unidad');

  const perfil = await follow(guest, 'POST', '/usuario/perfil', {
    nombre: 'Cliente Editado',
    email: 'clienteprueba@ecoflora.com',
    telefono: '3020000000',
    direccion: 'Calle nueva',
    ciudad: 'Medellín'
  });
  assert(perfil.text.includes('actualizados correctamente'), 'el cliente edita su perfil');
  assert(perfil.text.includes('Cliente Editado'), 'el nombre nuevo queda en la sesión');

  const historial = await guest.request('GET', '/usuario/historial');
  assert(historial.text.includes('Catalogo') || historial.text.includes('catalogo') || historial.text.includes('Planta'), 'el historial guarda visitas');

  const contacto = await guest.request('POST', '/contacto', {
    nombre: 'Ana',
    email: 'ana@correo.com',
    telefono: '300',
    asunto: 'Riego',
    mensaje: '¿Cada cuánto riego el pothos?'
  });
  assert(contacto.text.includes('Mensaje enviado correctamente'), 'formulario de contacto');

  await guest.request('GET', '/logout');

  const adminBloqueado = await follow(guest, 'GET', '/admin');
  assert(adminBloqueado.text.includes('Acceso no autorizado'), 'un visitante no entra al admin');

  const admin = createClient();
  const panel = await follow(admin, 'POST', '/login', { usuario: 'admin', password: 'Admin123' });
  assert(panel.text.includes('Panel de Administración'), 'login de administrador');
  assert(panel.text.includes('>6<') || panel.text.includes('>6</h3>'), 'el panel cuenta las plantas');

  const pedidos = await admin.request('GET', '/admin/pedidos');
  assert(pedidos.text.includes('Cliente Editado') && pedidos.text.includes('pendiente'), 'el admin ve el pedido pendiente');
  const idMatch = pedidos.text.match(/name="id_pedido" value="(\d+)"/);
  assert(idMatch, 'el pedido tiene id');
  await follow(admin, 'POST', '/admin/pedidos', {
    id_pedido: idMatch[1],
    estado: 'entregado',
    cambiar_estado: '1'
  });
  const pedidos2 = await admin.request('GET', '/admin/pedidos');
  assert(pedidos2.text.includes('entregado'), 'el admin cambia el estado');

  const usuarios = await admin.request('GET', '/admin/usuarios');
  assert(usuarios.text.includes('clienteprueba'), 'el admin lista clientes');
  const idUsuario = usuarios.text.match(/\/admin\/usuarios\/(\d+)\/editar/);
  assert(idUsuario, 'hay enlace para editar');
  await follow(admin, 'POST', '/admin/usuarios/' + idUsuario[1], {
    nombre: 'Cliente Editado',
    usuario: 'clienteprueba',
    email: 'clienteprueba@ecoflora.com',
    telefono: '3020000000',
    direccion: 'Calle nueva',
    ciudad: 'Cali',
    rol: 'cliente',
    password: ''
  });
  const usuarios2 = await admin.request('GET', '/admin/usuarios');
  assert(usuarios2.text.includes('Cali'), 'el admin actualiza la ciudad');

  const filaAdmin = usuarios.text.split('</tr>').find((fila) => fila.includes('>admin<'));
  const adminId = filaAdmin && filaAdmin.match(/\/admin\/usuarios\/(\d+)\/editar/);
  assert(adminId, 'se identifica la fila del administrador');
  const propio = await follow(admin, 'GET', '/admin/usuarios/' + adminId[1] + '/eliminar');
  assert(propio.text.includes('No puedes eliminar tu propia cuenta'), 'el admin no se elimina a sí mismo');

  await follow(admin, 'GET', '/admin/usuarios/' + idUsuario[1] + '/eliminar');
  const usuarios3 = await admin.request('GET', '/admin/usuarios');
  assert(!usuarios3.text.includes('clienteprueba'), 'el admin elimina al cliente');

  const css = await fetch(base + '/css/estilos.css');
  assert(css.status === 200 && (await css.text()).includes('--verde-oscuro'), 'el CSS original responde');
  const js = await fetch(base + '/js/app.js');
  assert(js.status === 200 && (await js.text()).includes('DOMContentLoaded'), 'el JavaScript original responde');

  console.log('Flujo local completo.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
