ECOFLORA - VIVERO WEB
======================

La aplicación está en Node.js (Express) y guarda los datos en MongoDB.
El proyecto PHP anterior quedó en la carpeta legacy/ y no se ejecuta.

1. REQUISITOS
   Node.js 20 o superior y MongoDB en marcha.
   En local, la URI por defecto es mongodb://127.0.0.1:27017/ecoflora

2. INSTALAR Y ARRANCAR
   npm install
   cp .env.example .env
   npm start

   La primera vez, si la base está vacía, se cargan las categorías y
   plantas de ecoflora_db.sql y se crea el administrador.

3. IMPORTAR UN VOLCADO SQL
   Para sustituir los datos con tu script de phpMyAdmin:
   - guárdalo como data/ecoflora_full.sql
   - o pásalo por argumento:
     npm run import -- ruta/al/archivo.sql

   El importador lee INSERT INTO de usuarios, categorias, plantas,
   carrito, pedidos, pedido_detalle, historial_navegacion y contactos.
   Las tablas que vengan en el archivo reemplazan esa colección.
   Los hashes de contraseña de PHP ($2y$) siguen siendo válidos.
   Si no existe el usuario admin, se crea con la clave Admin123.

4. ACCESO
   Inicio:    http://localhost:3000/
   Catálogo:  http://localhost:3000/catalogo
   Admin:     usuario admin  /  contraseña Admin123
   Cliente:   regístrate en /registro

5. RENDER
   El servicio web está descrito en render.yaml.
   MongoDB no viene incluido en Render: crea un cluster en MongoDB Atlas
   y define la variable MONGODB_URI en el servicio.
   SESSION_SECRET se genera sola al desplegar el blueprint.
   El servidor escucha en 0.0.0.0 y el puerto PORT.

6. CONTACTO POR CORREO Y WHATSAPP
   Los datos de contacto (dirección, teléfono, WhatsApp y correo) están en
   src/contacto.js.
   Cada mensaje del formulario /contacto se guarda en MongoDB y se envía por
   correo con Resend. Render gratis bloquea SMTP, por eso se usa su API web.
   - Crea una cuenta en https://resend.com con el correo que recibirá los
     mensajes y genera una API key.
   - En Render (Environment) define RESEND_API_KEY con esa clave.
   - CONTACT_TO_EMAIL (opcional) cambia el destinatario.
   Con el remitente de prueba onboarding@resend.dev, Resend solo entrega al
   correo con el que te registraste. Los mensajes también se leen en
   /admin/mensajes aunque el correo falle.

   Avisos de domicilio: cada vez que un cliente confirma un domicilio, llega
   al mismo correo un aviso con sus datos (cliente, dirección, teléfono,
   notas, plantas y total) y un botón para escribirle por WhatsApp. Usa la
   misma RESEND_API_KEY. El pedido y sus datos de entrega también se ven en
   /admin/pedidos; si el aviso falla, esa fila dice "Aviso no enviado".

7. INVENTARIO (STOCK)
   En Admin > Inventario (/admin/inventario) se ve cada planta con sus
   unidades disponibles. Cada tarjeta permite:
   - Añadir al stock: llegaron más plantas (19 + 5 = 24).
   - Quitar del stock: plantas dañadas o vendidas por fuera (no baja de 0).
   - Dejar en una cantidad: corregir el conteo exacto.
   Antes de guardar, la tarjeta muestra cuánto quedará. El stock también baja
   solo cuando un cliente confirma un domicilio. Hay buscador y filtros de
   "Poco stock" (5 unidades o menos) y "Agotadas"; el panel de admin avisa
   cuántas plantas hay por reponer.
   Si cancelas un pedido, sus unidades no vuelven solas: súmalas aquí.
   Si cambias data/ecoflora_full.sql, el catálogo se actualiza pero las
   plantas que ya existían conservan el stock actual (se gestiona desde el
   panel, no desde el SQL).

8. INICIO DE SESIÓN CON ROSTRO
   Además de la contraseña puedes entrar mirando a la cámara. Es opcional:
   al crear la cuenta te lo ofrece (con "Omitir por ahora") y, si ya tienes
   cuenta, lo activas desde tu perfil o el menú "Inicio con rostro".
   En /login aparecen las pestañas Contraseña | Rostro. La contraseña
   siempre queda como respaldo.

   Qué se guarda: la cámara calcula 128 números del rostro (el "descriptor")
   y el servidor los cifra con AES-256-GCM. No se envían ni se guardan fotos
   ni video. Antes de activarlo hay que aceptar la autorización (Ley 1581
   de 2012) y confirmar la contraseña. La política está en /privacidad.
   Para entrar, el navegador recuerda solo el nombre de usuario (con
   "No soy yo" para cambiarlo) y pide una prueba de vida (parpadear o girar
   la cabeza). La comparación la hace el servidor.

   Variables de entorno (local y Render → Environment):
   - FACE_ENCRYPTION_KEY (obligatoria; sin ella la función queda apagada).
     Genera una con:
     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
     Guárdala bien: si la pierdes o la cambias, cada persona tiene que
     volver a registrar su rostro.
   - FACE_MATCH_THRESHOLD=0.5 (qué tan parecido debe ser; menor = más
     estricto). La cuenta admin exige 0.05 más de parecido por defecto.
   - FACE_MATCH_THRESHOLD_ADMIN (opcional).

   La colección rostros_usuarios se crea sola en MongoDB. El archivo
   data/rostros_usuarios.sql es solo de referencia: el importador no lo lee
   y nunca debe llevar datos reales.

   Pruebas automatizadas (con una base LOCAL, nunca la de producción):
   - node scripts/verify-rostro-vida.js
   - node scripts/verify-face.js          (app encendida, misma clave)
   - node scripts/verify-rostro-browser.js (Chrome con cámara simulada;
     incluye el escenario "lento": sin WebGL y con el procesador 4 veces
     más lento, y muestra cuánto tarda cada etapa)

   Consejos de uso: buena luz de frente, sin gorra ni lentes oscuros;
   ábrelo en Chrome o Safari (no dentro de Instagram/WhatsApp); en el
   celular permite la cámara desde el candado de la dirección.

   Rapidez: los modelos (unos 8 MB, se guardan en el navegador) se van
   preparando mientras la persona acepta la autorización o al abrir la
   pestaña Rostro de un navegador que ya entró con rostro. La cámara se
   pide al mismo tiempo, la prueba de vida empieza apenas hay imagen y
   cada muestra del rostro se toma en una sola pasada. En un equipo lento
   (sin WebGL o con cada cuadro muy tardado) se dan más segundos (nunca
   menos de unos 12 cuadros para el gesto), se usa un detector más
   pequeño y, si tocaba parpadear, se pide girar la cabeza, porque un
   parpadeo dura menos que un cuadro. Si se queda pegado: abre la consola del
   navegador (F12, pestaña Console) y busca las líneas que empiezan con
   [rostro]; dicen cuánto tardó cada etapa y si el equipo usa WebGL
   (rápido) o el procesador (lento). Los tiempos y tamaños se ajustan en
   la constante ETAPA de public/js/rostro.js y los umbrales de parpadeo y
   giro en AJUSTES de public/js/rostro-vida.js.
