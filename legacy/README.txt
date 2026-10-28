ECOFLORA - VIVERO WEB
======================

1. COPIAR CARPETA
   Copia la carpeta 'ecoflora' dentro de C:\xampp\htdocs\

2. CREAR BASE DE DATOS
   Abre http://localhost/phpmyadmin
   Ve a la pestaña SQL y pega TODO el contenido de 'ecoflora_db.sql'
   Ejecuta (botón Continuar/Go)

3. CREAR ADMINISTRADOR
   Abre en navegador: http://localhost/ecoflora/generar_hash.php
   Copia el hash que aparece (ej: $2y$10$...)
   Ve a phpMyAdmin → tabla 'usuarios' → Insertar
   O ejecuta este SQL (reemplaza AQUI_EL_HASH):

   INSERT INTO usuarios (nombre, usuario, email, password, telefono, direccion, ciudad, rol)
   VALUES ('Administrador EcoFlora', 'admin', 'admin@ecoflora.com', 'AQUI_EL_HASH', '3000000000', 'Calle Principal 123', 'Bogotá', 'admin');

   LUEGO BORRA el archivo generar_hash.php

4. ACCESO AL SISTEMA
   Página principal: http://localhost/ecoflora/
   Login: http://localhost/ecoflora/login.php
   Admin: http://localhost/ecoflora/admin/panel_admin.php
   Cliente: http://localhost/ecoflora/usuario/panel.php

5. CREDENCIALES DE PRUEBA
   Admin:  usuario: admin  /  password: Admin123
   Cliente: registrarse en /registro.php

6. IMAGENES
   Para usar fotos reales, sube imágenes a ecoflora/assets/img/
   y cambia las URLs de placehold.co por la ruta de tu imagen.

NOTA: Si usas puerto 8080, accede con http://localhost:8080/ecoflora/
