-- EcoFlora Base de Datos Completa
-- Ejecutar esto en phpMyAdmin (pestaña SQL)

CREATE DATABASE IF NOT EXISTS ecoflora_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ecoflora_db;

CREATE TABLE usuarios (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    telefono VARCHAR(20),
    direccion VARCHAR(255),
    ciudad VARCHAR(100),
    rol ENUM('cliente','admin') DEFAULT 'cliente',
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categorias (
    id_categoria INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL,
    descripcion TEXT,
    icono VARCHAR(50) DEFAULT 'bi-flower1'
);

CREATE TABLE plantas (
    id_planta INT AUTO_INCREMENT PRIMARY KEY,
    id_categoria INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    nombre_cientifico VARCHAR(100),
    descripcion TEXT NOT NULL,
    cuidados TEXT,
    precio DECIMAL(10,2) NOT NULL,
    stock INT NOT NULL DEFAULT 0,
    imagen VARCHAR(255) DEFAULT 'default.jpg',
    destacada TINYINT(1) DEFAULT 0,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_categoria) REFERENCES categorias(id_categoria)
);

CREATE TABLE carrito (
    id_carrito INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT,
    sesion_id VARCHAR(255),
    id_planta INT NOT NULL,
    cantidad INT NOT NULL DEFAULT 1,
    fecha_agregado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    FOREIGN KEY (id_planta) REFERENCES plantas(id_planta) ON DELETE CASCADE
);

CREATE TABLE pedidos (
    id_pedido INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    fecha_pedido TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total DECIMAL(12,2) NOT NULL,
    estado ENUM('pendiente','confirmado','en_camino','entregado','cancelado') DEFAULT 'pendiente',
    direccion_envio TEXT NOT NULL,
    ciudad_envio VARCHAR(100),
    telefono_contacto VARCHAR(20),
    notas TEXT,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
);

CREATE TABLE pedido_detalle (
    id_detalle INT AUTO_INCREMENT PRIMARY KEY,
    id_pedido INT NOT NULL,
    id_planta INT NOT NULL,
    cantidad INT NOT NULL,
    precio_unitario DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido) ON DELETE CASCADE,
    FOREIGN KEY (id_planta) REFERENCES plantas(id_planta)
);

CREATE TABLE historial_navegacion (
    id_historial INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT,
    ip_address VARCHAR(45),
    pagina VARCHAR(100) NOT NULL,
    url TEXT NOT NULL,
    fecha_visita TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
);

CREATE TABLE contactos (
    id_contacto INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    telefono VARCHAR(20),
    asunto VARCHAR(150),
    mensaje TEXT NOT NULL,
    leido TINYINT(1) DEFAULT 0,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar categorías
INSERT INTO categorias (nombre, descripcion, icono) VALUES
('Interior', 'Plantas perfectas para decorar espacios dentro del hogar', 'bi-house-door'),
('Exterior', 'Ideales para jardines, balcones y terrazas', 'bi-tree'),
('Suculentas', 'Plantas resistentes que requieren poco riego', 'bi-droplet'),
('Orquídeas', 'Elegantes y exóticas para ambientes especiales', 'bi-flower1'),
('Herramientas', 'Todo lo que necesitas para el cuidado de tus plantas', 'bi-tools');

-- Insertar plantas de ejemplo
INSERT INTO plantas (id_categoria, nombre, nombre_cientifico, descripcion, cuidados, precio, stock, imagen, destacada) VALUES
(1, 'Pothos Dorado', 'Epipremnum aureum', 'Planta trepadora muy resistente, ideal para principiantes. Purifica el aire.', 'Luz indirecta. Riego cada 7-10 días. No tolera heladas.', 25000, 15, 'pothos.jpg', 1),
(1, 'Monstera Deliciosa', 'Monstera deliciosa', 'Icono del diseño interior. Hojas grandes con agujeros naturales.', 'Luz brillante indirecta. Riego cuando el sustrato seque 2cm.', 85000, 8, 'monstera.jpg', 1),
(2, 'Palma Areca', 'Dypsis lutescens', 'Elegante palma que aporta un toque tropical a cualquier espacio exterior.', 'Sol parcial. Riego regular. Fertilizar en primavera.', 120000, 5, 'areca.jpg', 0),
(3, 'Echeveria Elegans', 'Echeveria elegans', 'Pequeña suculenta en forma de roseta, muy decorativa.', 'Mucha luz. Riego escaso cada 15 días. Buen drenaje.', 18000, 30, 'echeveria.jpg', 1),
(4, 'Orquídea Phalaenopsis', 'Phalaenopsis spp.', 'La orquídea más popular, flores duraderas y elegantes.', 'Luz indirecta. Riego por inmersión cada 10-12 días.', 65000, 12, 'orquidea.jpg', 1),
(2, 'Lavanda', 'Lavandula angustifolia', 'Aromática, ideal para jardines y balcones soleados.', 'Sol directo. Suelo bien drenado. Poda después de florecer.', 22000, 20, 'lavanda.jpg', 0);

-- El admin se crea manualmente con generar_hash.php (ver README.txt)
