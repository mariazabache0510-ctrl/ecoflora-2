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
