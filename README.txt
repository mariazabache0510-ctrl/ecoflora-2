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
   plantas de ecoflora_db.sql y se crea el administrador. La contraseña
   inicial del admin se define con la variable ADMIN_INITIAL_PASSWORD
   (mínimo 8 caracteres); mira la sección 9.

3. IMPORTAR UN VOLCADO SQL
   Para sustituir los datos con tu script de phpMyAdmin:
   - guárdalo como data/ecoflora_full.sql
   - o pásalo por argumento:
     npm run import -- ruta/al/archivo.sql

   El importador lee INSERT INTO de usuarios, categorias, plantas,
   carrito, pedidos, pedido_detalle, historial_navegacion y contactos.
   Las tablas que vengan en el archivo reemplazan esa colección.
   Los hashes de contraseña de PHP ($2y$) siguen siendo válidos.
   Si no existe el usuario admin, se crea con ADMIN_INITIAL_PASSWORD (ver
   sección 9). El admin que trae el script de ejemplo no se importa.

4. ACCESO
   Inicio:    http://localhost:3000/
   Catálogo:  http://localhost:3000/catalogo
   Admin:     usuario admin  /  la contraseña de ADMIN_INITIAL_PASSWORD
              (sección 9; la contraseña nunca se escribe en este archivo)
   Cliente:   regístrate en /registro

5. RENDER
   El servicio web está descrito en render.yaml.
   MongoDB no viene incluido en Render: crea un cluster en MongoDB Atlas
   y define la variable MONGODB_URI en el servicio.
   SESSION_SECRET se genera sola al desplegar el blueprint. En producción
   (NODE_ENV=production) el servidor NO arranca sin ella.
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

   La cuenta de ADMINISTRACIÓN entra solo con contraseña: el rostro es
   para clientes. Motivo: el servidor no puede comprobar que la persona
   esté de verdad frente a la cámara (la prueba de vida corre en el
   navegador), y esa cuenta controla pedidos, stock y usuarios. Por eso:
   el menú del admin no ofrece el rostro, el servidor rechaza activarlo
   para un admin, y al arrancar (o al ascender a alguien a admin) se borra
   cualquier rostro guardado de una cuenta admin.

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
     estricto; entre 0.2 y 0.7).

   La colección rostros_usuarios se crea sola en MongoDB. El archivo
   data/rostros_usuarios.sql es solo de referencia: el importador no lo lee
   y nunca debe llevar datos reales.

   Pruebas automatizadas (con una base LOCAL, nunca la de producción):
   - node scripts/verify-rostro-vida.js
   - node scripts/verify-face.js          (app encendida, misma clave)
   - node scripts/verify-rostro-browser.js (Chrome con cámara simulada;
     incluye el escenario "lento": sin WebGL y con el procesador 4 veces
     más lento, el escenario "sin_wasm" y muestra cuánto tarda cada etapa)
   - node scripts/bench-rostro.js          (mide en TU navegador y TU equipo
     cuánto tarda el primer cuadro y cada cuadro con WebAssembly, WebGL y
     el procesador; abre la dirección que imprime y deja el resultado en la
     terminal)

   Consejos de uso: buena luz de frente, sin gorra ni lentes oscuros;
   ábrelo en Chrome o Safari (no dentro de Instagram/WhatsApp); en el
   celular permite la cámara desde el candado de la dirección.

   Rapidez: los modelos (unos 8 MB, se guardan en el navegador) se van
   preparando mientras la persona acepta la autorización o al abrir la
   pestaña Rostro de un navegador que ya entró con rostro. La cámara se
   pide al mismo tiempo, la prueba de vida empieza apenas hay imagen y
   cada muestra del rostro se toma en una sola pasada.

   Motor de cálculo: el reconocimiento usa TensorFlow.js con el motor
   WebAssembly (wasm), que arranca al instante. Se probó con WebGL (la
   tarjeta gráfica) y en un Mac con gráfica Intel el PRIMER cuadro tardó
   cerca de 2 minutos, porque WebGL compila programas para la tarjeta antes
   de usarla (y otra vez si cambia el tamaño de entrada): parecía que nunca
   confirmaba. Con wasm el primer cuadro tarda menos de medio segundo y cada
   cuadro unos 100 ms. El orden es wasm -> WebGL -> procesador (cpu); los
   archivos .wasm salen del paquete @tensorflow/tfjs-backend-wasm y se sirven
   desde /vendor/tfjs-wasm/ (la política CSP permite 'wasm-unsafe-eval',
   no 'unsafe-eval'). No se usa la versión con hilos porque exige
   aislamiento entre orígenes (COOP/COEP) que el sitio no tiene.
   El detector trabaja con imágenes de 160 px (128 px en modo lento).

   En un equipo lento (cada cuadro muy tardado o solo el procesador) se dan
   más segundos (nunca menos de unos 12 cuadros para el gesto), se usa un
   detector más pequeño y, si tocaba parpadear, se pide girar la cabeza,
   porque un parpadeo dura menos que un cuadro. Si se queda pegado: abre la
   consola del navegador (F12, pestaña Console) y busca las líneas que
   empiezan con [rostro]; dicen cuánto tardó cada etapa y qué motor usa el
   equipo (wasm: rápido; cpu: lento). Los tiempos y tamaños se ajustan en
   la constante ETAPA de public/js/rostro.js y los umbrales de parpadeo y
   giro en AJUSTES de public/js/rostro-vida.js.

9. SEGURIDAD
   Variables de entorno (local en .env, producción en Render > Environment;
   NUNCA se suben al repositorio):
   - SESSION_SECRET: firma la cookie de sesión. En producción es obligatoria
     (sin ella el servidor no arranca). Genera una con:
     node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   - NODE_ENV=production: activa la cookie solo-https, HSTS y las
     comprobaciones de arranque.
   - ADMIN_INITIAL_PASSWORD: contraseña con la que se CREA el usuario admin
     (mínimo 8 caracteres). Solo se usa si el admin todavía no existe. Si en
     producción no la defines, se genera una aleatoria y se muestra UNA sola
     vez en el log del arranque. Si el admin ya existe, cambia su contraseña
     desde el panel: Gestionar Usuarios > Editar > Nueva contraseña.
     Al arrancar en producción, si el admin sigue con la contraseña de
     fábrica de versiones anteriores, el log muestra una advertencia clara.

   Qué protege el sitio:
   - Login con contraseña: 5 intentos fallidos cada 10 minutos por IP+usuario
     y 10 por usuario; un solo mensaje ("Usuario o contraseña incorrectos") y
     el mismo tiempo de respuesta exista o no el usuario.
   - Sesión: cookie "ecoflora.sid" (httpOnly, SameSite=Lax y Secure en
     producción), con identificador nuevo en cada inicio de sesión y borrada
     al salir. Contraseñas nuevas: mínimo 8 caracteres.
   - CSRF: todo POST lleva un token por sesión (campo oculto _csrf, o el
     encabezado X-CSRF-Token en el JS del rostro). Quitar del carrito y
     eliminar usuarios son POST con confirmación, no enlaces.
   - Encabezados (helmet): política de contenido (CSP) que solo permite los
     scripts, estilos, tipografías e imágenes que el sitio usa, no permite
     meter el sitio en otra página y activa HSTS en producción. Por eso las
     vistas no usan onclick="", onsubmit="" ni "javascript:": usa los
     atributos data-confirmar, data-volver y data-respaldo (public/js/app.js)
     y, para un script en línea, nonce="<%= cspNonce %>". Si cambias la
     versión de Bootstrap en las vistas, actualiza src/seguridad.js.
   - Entradas: formularios de hasta 20 KB, JSON del rostro de hasta 32 KB y
     limpieza de claves con "$" o "." (express-mongo-sanitize).
   - Pruebas: MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora node scripts/verify-seguridad.js
     (necesita MongoDB LOCAL encendido; levanta sus propias copias de la app en los
     puertos 3201 y 3202 y borra las bases temporales que crea).

10. PARCIAL FINAL: ECOFLORA COMO SISTEMA DE INFORMACIÓN HÍBRIDO
   La tienda ya no depende de una sola base de datos. Cada parte del parcial
   usa una tecnología distinta y todas conviven con la tienda (MongoDB):

                          +---------------------------+
                          |  EcoFlora (Node + Express)|
                          +-------------+-------------+
                                        |
        +-------------------+-----------+-----------+----------------------+
        |                   |                       |                      |
   MongoDB Atlas      PostgreSQL 16  <--mysql_fdw-->  MySQL 8         CockroachDB Cloud
   (NoSQL, nube)      servidor 1 (Docker)         servidor 2 (Docker)  (NewSQL, nube)
   usuarios, plantas  cliente, producto           factura              sitios_interes
   pedidos, sesiones  + factura_mysql (foránea)                        (mapa de Google)
   Parte 1            Parte 2 (solo en tu computador)                  Parte 3

   PARTE 1 - Usuarios en MongoDB (colección usuarios)
   - CRUD completo en el panel: Gestionar Usuarios > "Nuevo usuario" crea
     (con validación de correo, usuario, teléfono y contraseña), editar,
     listar y eliminar. No puedes borrarte a ti mismo ni quitarle el rol al
     último administrador.
   - Entrar con Google (Google Identity Services): el botón está en /login y
     /registro. El navegador recibe un token de Google y lo envía a
     POST /auth/google; el servidor lo VERIFICA (firma, audiencia, emisor,
     vencimiento y correo verificado) con google-auth-library. Si el correo ya
     existe, se enlaza la cuenta; si no, se crea una cuenta de cliente
     (campos google_id y proveedor). La cuenta admin NO entra con Google.
   - Recuperar contraseña: /recuperar pide el correo o usuario y envía un
     enlace por Resend. El token es aleatorio, se guarda solo su hash, vale 30
     minutos y se usa una sola vez; al cambiarla se cierran las sesiones
     abiertas. La respuesta es siempre la misma (no revela si el correo existe)
     y hay límites por IP y por cuenta.
   - Variable: GOOGLE_CLIENT_ID (sin ella el botón no aparece).

   PARTE 2 - Base federada en dos servidores (Docker Compose)
   - Servidor 1: PostgreSQL 16 con la extensión mysql_fdw (puerto 5433), con
     las tablas cliente y producto.
     Servidor 2: MySQL 8 (puerto 3307), con la tabla factura.
   - Por qué mysql_fdw y no postgres_fdw: postgres_fdw solo enlaza Postgres con
     Postgres. Para que Postgres lea una tabla de MySQL se necesita mysql_fdw.
     Es el equivalente de un "db_link" de Oracle.
   - Encender (solo en tu computador; necesita Docker Desktop):
       cd docker
       cp .env.example .env        (cambia las contraseñas; .env no se sube)
       docker compose up -d --build
     Si el puerto 5433 o el 3307 ya lo usa otro programa, cambia PG_PORT o
     MYSQL_PORT en docker/.env. Para empezar de cero: docker compose down -v
   - Los scripts SQL están en docker/sql/: esquemas de las tablas
     (postgres/01-esquema.sql y mysql/01-esquema.sql) y el enlace entre
     servidores (federacion.sql).
   - El enlace (federacion.sql), explicado paso a paso:
       CREATE EXTENSION mysql_fdw;
       CREATE SERVER servidor_mysql FOREIGN DATA WRAPPER mysql_fdw
           OPTIONS (host 'mysql', port '3306');
       CREATE USER MAPPING FOR CURRENT_USER SERVER servidor_mysql
           OPTIONS (username '...', password '...');
       CREATE FOREIGN TABLE factura_mysql (...)
           SERVER servidor_mysql OPTIONS (dbname 'ecoflora_facturas', table_name 'factura');
       CREATE VIEW v_ventas_federada AS
           SELECT ... FROM factura_mysql f
           JOIN cliente c ON c.id_cliente = f.id_cliente
           JOIN producto p ON p.id_producto = f.id_producto;
     (las contraseñas llegan por variables de entorno, no están en los
     archivos). Con eso, desde Postgres se escribe
       SELECT * FROM v_ventas_federada;
     y salen datos de DOS servidores con una sola consulta; también se puede
     hacer INSERT/UPDATE/DELETE sobre factura_mysql y el cambio queda en MySQL.
   - La tienda (src/federada.js) se conecta con PG_URL y MYSQL_URL. Solo si
     las dos existen, la base federada se enciende:
       * al confirmar un pedido, el cliente y las plantas pedidas van a
         Postgres y la factura (una fila por planta) a MySQL;
       * al cambiar el estado del pedido, la factura cambia (entregado ->
         pagada, cancelado -> anulada);
       * si algún servidor está caído, el pedido se confirma igual (solo se
         anota el error en el log).
   - Carga inicial de lo que ya existe en MongoDB (se puede repetir sin
     duplicar): node scripts/federada-sync.js  o el botón "Sincronizar ahora"
     de /admin/federada (menú del admin > Base federada).
   - En Render se enciende con dos private services (ecoflora-pg + ecoflora-mysql)
     en render.yaml (plan Starter + disco de 1 GB c/u). Sin ellos la parte queda
     apagada y la tienda sigue solo con MongoDB.
   - Variables locales: PG_URL y MYSQL_URL (ejemplos en .env.example).
     En Render: PGHOST/POSTGRES_PASSWORD y MYSQL_HOST/MYSQL_PASSWORD (Blueprint).

   PARTE 3 - Sitios de interés con Google Maps y CockroachDB
   - Página /sitios (requiere iniciar sesión; menú de cuenta > Sitios de
     interés): haces clic en el mapa para poner un marcador, escribes nombre,
     descripción y categoría, y se guarda. Cada persona ve y borra solo los
     suyos; el admin ve y puede borrar todos.
   - API: GET /api/sitios, POST /api/sitios, DELETE /api/sitios/:id. Los POST y
     DELETE llevan token CSRF; se valida latitud (-90 a 90), longitud (-180 a
     180), texto y categoría; máximo 200 sitios por persona y límite de
     velocidad.
   - Los datos van a CockroachDB (base distribuida compatible con PostgreSQL;
     se usa el cliente pg con SSL obligatorio). La tabla sitios_interes (id
     UUID, id_usuario, nombre, descripcion, categoria, lat, lng, creado) se
     crea sola la primera vez.
   - Variables: COCKROACH_URL, GOOGLE_MAPS_API_KEY (la llave del mapa va en el
     navegador, por eso debe estar RESTRINGIDA por dominio en Google Cloud).
     Sin COCKROACH_URL la página avisa que no está disponible; sin llave de
     Maps el formulario sigue sirviendo escribiendo las coordenadas.

   LO QUE TIENES QUE CREAR TÚ (necesita tus cuentas) Y DÓNDE PONERLO
   1. Google OAuth: console.cloud.google.com > APIs y servicios > Credenciales >
      Crear credenciales > ID de cliente de OAuth > Aplicación web. En
      "Orígenes autorizados de JavaScript" agrega http://localhost:3000 y
      https://ecoflora-node.onrender.com (sin barra final). Copia el ID de
      cliente en GOOGLE_CLIENT_ID.
   2. Llave de Google Maps: en la misma consola, habilita "Maps JavaScript API"
      y crea una clave de API. Restricción de aplicaciones: sitios web, con
      http://localhost:3000/* y https://ecoflora-node.onrender.com/*. Restricción
      de API: solo Maps JavaScript API. Cópiala en GOOGLE_MAPS_API_KEY.
      (Google puede pedir una cuenta de facturación; el uso de este curso cae
      dentro del crédito gratuito.)
   3. CockroachDB: cockroachlabs.cloud > crea un cluster gratis (Basic/Serverless) >
      Connect > copia la cadena de conexión (postgresql://...) en COCKROACH_URL.
   4. Pon las tres variables en tu .env (local) y en Render > Environment
      (ecoflora-node) y vuelve a desplegar. NUNCA las subas al repositorio.

   PRUEBAS (necesitan MongoDB LOCAL; las de federada y sitios también el
   contenedor de Postgres de docker/; todas crean y borran sus propias bases):
     MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora node scripts/verify-cuentas.js
       (Parte 1: CRUD, Google con tokens de prueba firmados, recuperación)
     MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora node scripts/verify-federada.js
       (Parte 2: carga, factura al confirmar, consulta federada, servidores caídos;
        VACÍA las tablas cliente/producto/factura de los servidores de práctica)
     MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora node scripts/verify-sitios.js
       (Parte 3: usa el Postgres de Docker como sustituto de CockroachDB)
     MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora node scripts/verify-seguridad.js
     BASE_URL=http://127.0.0.1:3000 node scripts/verify-parcial-browser.js
       (con la app encendida; pantallas nuevas en Chrome real)
   Lo que NO se puede probar sin tus cuentas: el inicio real con Google, el mapa
   de Google con tu llave y CockroachDB Cloud. Hazlo tú una vez configuradas
   las variables (ver la demostración).

   GUION DE DEMOSTRACIÓN (unos 8 minutos)
   Antes: docker compose up -d --build (carpeta docker/), PG_URL, MYSQL_URL,
   GOOGLE_CLIENT_ID, GOOGLE_MAPS_API_KEY y COCKROACH_URL en .env, npm start y
   node scripts/federada-sync.js.
   1. Parte 1 (MongoDB). Entra como admin > Gestionar Usuarios > "Nuevo usuario":
      crea uno y muéstralo en la lista; edítalo y bórralo. Cierra sesión: en
      /login pulsa "Continuar con Google" y muestra que se crea la cuenta (aparece
      con la insignia Google en la lista). Pulsa "¿Olvidaste tu contraseña?",
      pide el enlace, ábrelo desde el correo y cambia la clave; muestra que el
      mismo enlace ya no sirve.
   2. Parte 2 (dos servidores). Muestra docker compose ps (dos contenedores).
      En la tienda haz un pedido como cliente. Entra como admin > Base federada:
      los dos servidores están conectados y la factura aparece en la consulta
      federada. En una terminal:
        docker exec -it ecoflora_postgres psql -U ecoflora -d ecoflora_pg
        SELECT * FROM v_ventas_federada;           (Postgres + MySQL en una consulta)
        SELECT * FROM factura_mysql;               (la tabla de MySQL vista desde Postgres)
      y en MySQL: docker exec -it ecoflora_mysql mysql -uecoflora_app -p ecoflora_facturas
        SELECT * FROM factura;                     (los mismos datos, en su servidor)
      Cambia el estado del pedido en Pedidos y repite la consulta: cambia la factura.
   3. Parte 3 (mapa + CockroachDB). Menú de cuenta > Sitios de interés: haz clic
      en el mapa, llena el formulario y guarda; aparece en la lista y como
      marcador. Entra como otra persona (no ve el sitio) y luego como admin (ve
      todos y de quién son). Muestra la tabla sitios_interes en la consola web
      de CockroachDB.
