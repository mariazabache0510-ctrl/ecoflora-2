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
  assert(home.includes('Monstera deliciosa'), 'inicio muestra la Monstera');
  assert(home.includes('Lavanda'), 'inicio muestra la Lavanda destacada');
  assert(home.includes('$85.000'), 'precio con separador de miles');
  assert(home.includes('Suculentas') && home.includes('Florales'), 'inicio muestra las categorías del dump');
  assert(home.includes('/css/estilos.css') && home.includes('/js/app.js'), 'sirve la hoja de estilos y el script');
  assert(home.includes('data-jardin') && home.includes('/img/fondo/lejos.svg'), 'inicio incluye el fondo dinámico de jardín');
  assert(home.includes('nav-indicador') && home.includes('class="logo-eco'), 'inicio incluye la navbar y el logo animados');
  assert(home.includes('tarjeta-planta') && home.includes('tarjeta-categoria'), 'inicio usa las tarjetas rediseñadas');
  assert(!home.includes('placehold'), 'ya no se usan imágenes de relleno');
  assert(home.includes('/img/plantas/monstera_deliciosa.webp'), 'la tarjeta apunta a la foto real de la planta');

  const fotos = ['monstera_deliciosa.webp', 'manzanilla.jpg.webp', 'Orquideas_phalaenopsis.jpg', '_default.svg'];
  for (const foto of fotos) {
    const respuesta = await fetch(base + '/img/plantas/' + foto);
    assert(respuesta.status === 200 && (respuesta.headers.get('content-type') || '').startsWith('image/'), 'la foto ' + foto + ' se sirve como imagen');
  }
  for (const capa of ['lejos', 'medio', 'cerca', 'esquina']) {
    const respuesta = await fetch(base + '/img/fondo/' + capa + '.svg');
    assert(respuesta.status === 200, 'la capa del fondo ' + capa + ' se sirve');
  }

  const guest = createClient();
  const catalogo = await guest.request('GET', '/catalogo?busqueda=Lavanda');
  assert(catalogo.status === 200 && catalogo.text.includes('Lavanda'), 'búsqueda encuentra Lavanda');
  assert(!catalogo.text.includes('Monstera deliciosa'), 'búsqueda no mezcla otras plantas');

  const completo = await guest.request('GET', '/catalogo');
  const tarjetas = (completo.text.match(/class="tarjeta-planta/g) || []).length;
  assert(tarjetas === 22, 'el catálogo muestra las 22 plantas del dump (hay ' + tarjetas + ')');
  assert(completo.text.includes('chip-filtro'), 'el catálogo muestra los filtros por categoría');

  const suculentas = await guest.request('GET', '/catalogo?categoria=3');
  assert(suculentas.text.includes('Echeveria elegans') && suculentas.text.includes('Aloe vera'), 'filtro de suculentas');
  assert(!suculentas.text.includes('Palma areca'), 'el filtro oculta otras categorías');

  const vacio = await guest.request('GET', '/catalogo?busqueda=zzzz-no-existe');
  assert(vacio.text.includes('No encontramos plantas'), 'búsqueda sin resultados');

  const ficha = await guest.request('GET', '/planta/1');
  assert(ficha.text.includes('Monstera deliciosa') && ficha.text.includes('Stock: 15'), 'ficha de la monstera');
  assert(ficha.text.includes('Luz indirecta, riego moderado') && ficha.text.includes('data-stepper'), 'la ficha muestra los cuidados y el selector de cantidad');
  assert(ficha.text.includes('También te puede interesar') && ficha.text.includes('Costilla de Adán'), 'la ficha muestra plantas relacionadas');

  const missing = await guest.request('GET', '/planta/99');
  assert(missing.text.includes('Planta no encontrada'), 'planta inexistente');

  const added = await follow(guest, 'POST', '/carrito', { accion: 'agregar', id_planta: '1', cantidad: '2' });
  assert(added.status === 200 && added.text.includes('Monstera deliciosa') && added.text.includes('$170.000'), 'carrito de invitado');
  assert(added.text.includes('Ingresa para continuar') && added.text.includes('/img/plantas/monstera_deliciosa.webp'), 'el carrito invita a ingresar y muestra la foto');

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
  assert(carrito.text.includes('Monstera deliciosa') && carrito.text.includes('Solicitar domicilio'), 'el carrito de invitado se fusiona al ingresar');

  await follow(guest, 'POST', '/carrito', { actualizar: '1', cant_1: '1' });
  const confirmar = await guest.request('GET', '/confirmar-pedido');
  assert(confirmar.text.includes('Confirmar domicilio') && confirmar.text.includes('$85.000'), 'resumen del domicilio');

  const pedido = await follow(guest, 'POST', '/confirmar-pedido', {
    direccion: 'Calle 45 #12-30',
    ciudad: 'Bogotá',
    telefono: '3010000000',
    notas: 'Portería'
  });
  assert(pedido.text.includes('Pedido realizado con éxito'), 'el pedido queda confirmado');
  assert(pedido.text.includes('Monstera deliciosa') && pedido.text.includes('Calle 45 #12-30'), 'el domicilio guarda el detalle');

  const fichaDespues = await guest.request('GET', '/planta/1');
  assert(fichaDespues.text.includes('Stock: 14'), 'el stock baja en una unidad');

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

  // --- Contacto: datos reales, WhatsApp y formulario ---
  const paginaContacto = await guest.request('GET', '/contacto');
  assert(paginaContacto.status === 200, 'la página de contacto responde 200');
  for (const dato of ['+57 312 469 8497', 'tel:+573124698497', 'mariazabache0510@gmail.com', 'mailto:mariazabache0510@gmail.com', 'Villavicencio-Meta']) {
    assert(paginaContacto.text.includes(dato), 'contacto muestra ' + dato);
  }
  assert(paginaContacto.text.includes('https://wa.me/573124698497'), 'contacto enlaza al WhatsApp +57 3124698497');
  assert(paginaContacto.text.includes('btn-whatsapp') && paginaContacto.text.includes('name="sitio_web"'), 'contacto tiene el botón de WhatsApp y la trampa anti-spam');
  for (const viejo of ['Bogotá', '(601)', 'hola@ecoflora.com']) {
    assert(!paginaContacto.text.includes(viejo), 'contacto ya no muestra ' + viejo);
  }

  for (const ruta of ['/', '/catalogo', '/nosotros']) {
    const pagina = await guest.request('GET', ruta);
    assert(
      pagina.text.includes('Villavicencio-Meta') && pagina.text.includes('+57 312 469 8497')
        && pagina.text.includes('mariazabache0510@gmail.com') && pagina.text.includes('https://wa.me/573124698497'),
      'el footer de ' + ruta + ' tiene los datos reales y WhatsApp'
    );
    assert(!pagina.text.includes('Bogotá') && !pagina.text.includes('(601)') && !pagina.text.includes('hola@ecoflora.com'), 'el footer de ' + ruta + ' no conserva los datos antiguos');
  }

  const sinCampos = await guest.request('POST', '/contacto', { nombre: 'Ana', email: '', mensaje: '' });
  assert(sinCampos.status === 400 && sinCampos.text.includes('Completa los campos obligatorios'), 'contacto exige los campos obligatorios');
  const correoMalo = await guest.request('POST', '/contacto', { nombre: 'Ana', email: 'no-es-correo', mensaje: 'Hola' });
  assert(correoMalo.status === 400 && correoMalo.text.includes('correo válido'), 'contacto rechaza un correo inválido');
  assert(correoMalo.text.includes('value="Ana"'), 'contacto conserva lo escrito cuando hay error');

  const marca = 'prueba-' + Date.now();
  const trampa = await guest.request('POST', '/contacto', {
    nombre: 'Robot', email: 'robot@spam.com', mensaje: 'compra ya ' + marca, sitio_web: 'http://spam.example'
  });
  assert(trampa.text.includes('Mensaje enviado correctamente'), 'el bot que llena la trampa recibe éxito aparente');

  const contacto = await guest.request('POST', '/contacto', {
    nombre: 'Ana',
    email: 'ana@correo.com',
    telefono: '3124000000',
    asunto: 'Riego',
    mensaje: '¿Cada cuánto riego el pothos? ' + marca
  });
  assert(contacto.text.includes('Mensaje enviado correctamente'), 'formulario de contacto');

  await guest.request('GET', '/logout');

  const adminBloqueado = await follow(guest, 'GET', '/admin');
  assert(adminBloqueado.text.includes('Acceso no autorizado'), 'un visitante no entra al admin');

  const admin = createClient();
  const panel = await follow(admin, 'POST', '/login', { usuario: 'admin', password: 'Admin123' });
  assert(panel.text.includes('Panel de Administración'), 'login de administrador');
  assert(panel.text.includes('>22<'), 'el panel cuenta las 22 plantas');
  assert(panel.text.includes('data-contar'), 'el panel usa los contadores animados');

  assert(panel.text.includes('/admin/mensajes') && panel.text.includes('sin leer'), 'el panel enlaza a los mensajes y cuenta los nuevos');

  const bandeja = await admin.request('GET', '/admin/mensajes');
  assert(bandeja.status === 200 && bandeja.text.includes('Mensajes de contacto'), 'el admin abre la bandeja de mensajes');
  const bloque = bandeja.text.split('<article').find((trozo) => trozo.includes(marca));
  assert(bloque, 'el mensaje del formulario aparece en la bandeja');
  assert(bloque.includes('ana@correo.com') && bloque.includes('3124000000') && bloque.includes('Riego'), 'la bandeja muestra los datos de quien escribió');
  assert(bloque.includes('mailto:ana@correo.com?subject=Re%3A%20Riego'), 'la bandeja permite responder por correo');
  assert(bloque.includes('https://wa.me/573124000000'), 'la bandeja permite responder por WhatsApp');
  assert(bloque.includes('Correo no enviado') || bloque.includes('Correo enviado'), 'la bandeja indica si el correo salió');
  assert(bloque.includes('Marcar como leído') && bloque.includes('estado-pendiente'), 'el mensaje nuevo se marca como no leído');
  assert(!bandeja.text.split('<article').some((trozo) => trozo.includes('compra ya ' + marca)), 'el mensaje del bot no se guarda');
  const idMensaje = bloque.match(/\/admin\/mensajes\/(\d+)\/leido/);
  assert(idMensaje, 'el mensaje tiene id');

  await follow(admin, 'POST', '/admin/mensajes/' + idMensaje[1] + '/leido', { leido: '1' });
  const bandeja2 = await admin.request('GET', '/admin/mensajes');
  const leido = bandeja2.text.split('<article').find((trozo) => trozo.includes(marca));
  assert(leido && leido.includes('Marcar como no leído') && !leido.includes('estado-pendiente'), 'el admin marca el mensaje como leído');

  await follow(admin, 'POST', '/admin/mensajes/' + idMensaje[1] + '/eliminar');
  const bandeja3 = await admin.request('GET', '/admin/mensajes');
  assert(!bandeja3.text.includes(marca), 'el admin elimina el mensaje');
  const visitanteMensajes = await guest.request('GET', '/admin/mensajes');
  assert(visitanteMensajes.status >= 300 || !visitanteMensajes.text.includes('Mensajes de contacto'), 'un visitante no entra a la bandeja de mensajes');

  const pedidos = await admin.request('GET', '/admin/pedidos');
  assert(pedidos.text.includes('Cliente Editado') && pedidos.text.includes('estado estado-pendiente'), 'el admin ve el pedido pendiente');
  assert(
    pedidos.text.includes('fila-detalle') && pedidos.text.includes('Calle 45 #12-30') && pedidos.text.includes('Portería')
      && pedidos.text.includes('tel:3010000000') && pedidos.text.includes('1 × Monstera deliciosa'),
    'el admin ve dirección, teléfono, notas y plantas de cada domicilio'
  );
  const idMatch = pedidos.text.match(/name="id_pedido" value="(\d+)"/);
  assert(idMatch, 'el pedido tiene id');
  assert(pedidos.text.includes('data-icono="bi-truck"') && pedidos.text.includes('data-tono="indigo"') && pedidos.text.includes('>En camino<'), 'el menú de estados trae iconos, colores y nombres legibles');
  await follow(admin, 'POST', '/admin/pedidos', {
    id_pedido: idMatch[1],
    estado: 'entregado',
    cambiar_estado: '1'
  });
  const pedidos2 = await admin.request('GET', '/admin/pedidos');
  assert(pedidos2.text.includes('estado estado-entregado') && !pedidos2.text.includes('estado estado-pendiente'), 'el admin cambia el estado');

  const usuarios = await admin.request('GET', '/admin/usuarios');
  assert(usuarios.text.includes('clienteprueba'), 'el admin lista clientes');
  const idUsuario = usuarios.text.match(/\/admin\/usuarios\/(\d+)\/editar/);
  assert(idUsuario, 'hay enlace para editar');
  const editar = await admin.request('GET', '/admin/usuarios/' + idUsuario[1] + '/editar');
  assert(editar.text.includes('data-icono="bi-shield-check"') && editar.text.includes('data-detalle='), 'el menú de rol trae iconos y descripciones');
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

  const nosotros = await guest.request('GET', '/nosotros');
  assert(nosotros.text.includes('Somos EcoFlora') && nosotros.text.includes('nosotros-collage') && nosotros.text.includes('data-contar'), 'la página Nosotros usa el collage y los contadores');

  const noExiste = await guest.request('GET', '/esto-no-existe');
  assert(noExiste.status === 404 && noExiste.text.includes('Página no encontrada'), 'la página 404 rediseñada');

  const css = await fetch(base + '/css/estilos.css');
  const textoCss = await css.text();
  assert(css.status === 200 && textoCss.includes('--verde-oscuro'), 'el CSS responde');
  assert(textoCss.includes('.selector-panel') && textoCss.includes('.selector-boton'), 'el CSS incluye los menús desplegables propios');
  const js = await fetch(base + '/js/app.js');
  const textoJs = await js.text();
  assert(js.status === 200 && textoJs.includes('DOMContentLoaded'), 'el JavaScript responde');
  assert(textoJs.includes('iniciarDesplegables'), 'el JavaScript convierte los <select> en menús propios');

  console.log('Flujo local completo.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
