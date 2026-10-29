DROP TABLE IF EXISTS pedido_detalle CASCADE;
DROP TABLE IF EXISTS pedidos CASCADE;
DROP TABLE IF EXISTS carrito CASCADE;
DROP TABLE IF EXISTS historial_navegacion CASCADE;
DROP TABLE IF EXISTS contactos CASCADE;
DROP TABLE IF EXISTS plantas CASCADE;
DROP TABLE IF EXISTS categorias CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;

CREATE TABLE usuarios (
    id_usuario      SERIAL PRIMARY KEY,
    nombre          VARCHAR(100) NOT NULL,
    usuario         VARCHAR(50)  NOT NULL UNIQUE,
    email           VARCHAR(100) NOT NULL UNIQUE,
    password        VARCHAR(255) NOT NULL,
    telefono        VARCHAR(30),
    direccion       VARCHAR(200),
    ciudad          VARCHAR(100),
    rol             VARCHAR(20)  NOT NULL DEFAULT 'cliente',
    fecha_registro  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categorias (
    id_categoria SERIAL PRIMARY KEY,
    nombre       VARCHAR(100) NOT NULL UNIQUE,
    descripcion  TEXT
);


CREATE TABLE plantas (
    id_planta          SERIAL PRIMARY KEY,
    id_categoria       INTEGER NOT NULL REFERENCES categorias(id_categoria),
    nombre             VARCHAR(150) NOT NULL,
    nombre_cientifico  VARCHAR(150),
    descripcion        TEXT,
    cuidados           TEXT,
    precio             NUMERIC(12,2) NOT NULL DEFAULT 0,
    stock              INTEGER NOT NULL DEFAULT 0,
    imagen             VARCHAR(255),
    destacada          SMALLINT NOT NULL DEFAULT 0
);


CREATE TABLE carrito (
    id_carrito  SERIAL PRIMARY KEY,
    id_usuario  INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    id_planta   INTEGER NOT NULL REFERENCES plantas(id_planta) ON DELETE CASCADE,
    cantidad    INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
    UNIQUE (id_usuario, id_planta)
);



CREATE TABLE pedidos (
    id_pedido          SERIAL PRIMARY KEY,
    id_usuario         INTEGER NOT NULL REFERENCES usuarios(id_usuario),
    total              NUMERIC(12,2) NOT NULL DEFAULT 0,
    direccion_envio    VARCHAR(200),
    ciudad_envio       VARCHAR(100),
    telefono_contacto  VARCHAR(30),
    notas              TEXT,
    estado             VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    fecha_pedido       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE pedido_detalle (
    id_detalle       SERIAL PRIMARY KEY,
    id_pedido        INTEGER NOT NULL REFERENCES pedidos(id_pedido) ON DELETE CASCADE,
    id_planta        INTEGER NOT NULL REFERENCES plantas(id_planta),
    cantidad         INTEGER NOT NULL,
    precio_unitario  NUMERIC(12,2) NOT NULL
);



CREATE TABLE contactos (
    id_contacto   SERIAL PRIMARY KEY,
    nombre        VARCHAR(100) NOT NULL,
    email         VARCHAR(100) NOT NULL,
    telefono      VARCHAR(30),
    asunto        VARCHAR(150),
    mensaje       TEXT NOT NULL,
    fecha_envio   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE historial_navegacion (
    id_historial  SERIAL PRIMARY KEY,
    id_usuario    INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
    ip_address    VARCHAR(45),
    pagina        VARCHAR(100),
    url           TEXT,
    fecha_visita  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


INSERT INTO usuarios (nombre, usuario, email, password, telefono, ciudad, rol) VALUES
('Administrador EcoFlora', 'admin', 'admin@ecoflora.com',
 '$2y$10$XVjg4OvV8.rJy.fIG5686.MKBS.wJN0QEnsUGvU3/.H8kwqhMlkkC',
 '3000000000', 'Villavicencio', 'admin');


 INSERT INTO categorias (nombre, descripcion) VALUES
('Interior', 'Plantas ideales para espacios internos'),
('Exterior', 'Plantas para jardín y terraza'),
('Suculentas', 'Bajo mantenimiento y poca agua'),
('Aromáticas', 'Hierbas y plantas aromáticas'),
('Florales', 'Plantas y flores ornamentales');



INSERT INTO plantas (id_categoria, nombre, nombre_cientifico, descripcion, cuidados, precio, stock, imagen, destacada) VALUES
(1, 'Monstera deliciosa', 'Monstera deliciosa', 'Planta tropical de hojas grandes y perforadas, perfecta para interiores luminosos.', 'Luz indirecta, riego moderado, evitar encharcamiento.', 85000, 15, 'monstera_deliciosa.webp', 1),
(1, 'Costilla de Adán', 'Monstera adansonii', 'Variedad compacta con hojas fenestradas, muy decorativa.', 'Luz media-indirecta y sustrato bien drenado.', 65000, 12, 'costilla_adan.jpg', 1),
(1, 'Lengua de suegra', 'Sansevieria trifasciata', 'Resistente y purificadora de aire, ideal para principiantes.', 'Poca agua, tolera poca luz.', 35000, 25, 'lengua_suegra.webp', 1),
(1, 'Pothos dorado', 'Epipremnum aureum', 'Enredadera fácil de cuidar, crece rápido.', 'Riego cuando la tierra esté seca.', 28000, 30, 'pothos_dorado.webp', 0),
(1, 'Palma areca', 'Dypsis lutescens', 'Palmera de interior que aporta frescura y volumen.', 'Luz brillante indirecta y humedad ambiental.', 95000, 8, 'palma_areca.webp', 1),
(3, 'Echeveria elegans', 'Echeveria elegans', 'Suculenta en forma de roseta, ideal para escritorios.', 'Mucha luz y riego escaso.', 18000, 40, 'echeveria_elegans.webp', 1),
(3, 'Aloe vera', 'Aloe barbadensis', 'Planta medicinal de gel regenerador.', 'Sol suave y riego poco frecuente.', 22000, 20, 'aloe_vera.jpeg', 0),
(4, 'Lavanda', 'Lavandula angustifolia', 'Aroma relajante y flores violetas.', 'Sol directo y suelo drenado.', 30000, 18, 'lavanda.jpg', 1),
(4, 'Menta', 'Mentha spicata', 'Hierba aromática para cocina e infusiones.', 'Luz abundante y riego regular.', 15000, 35, 'menta.jpg', 0),
(4, 'Manzanilla', 'Matricaria chamomilla', 'Clásica planta para infusiones calmantes.', 'Sol y riego moderado.', 16000, 22, 'manzanilla.jpg.webp', 0),
(4, 'Toronjil', 'Melissa officinalis', 'Aromática con notas cítricas.', 'Suelo húmedo y sol parcial.', 17000, 20, 'toronjil.jpg', 0),
(4, 'Ruda', 'Ruta graveolens', 'Planta tradicional de huerta y jardín.', 'Sol pleno, riego moderado.', 14000, 15, 'ruda.png.webp', 0),
(4, 'Salvia', 'Salvia officinalis', 'Aromática culinaria y ornamental.', 'Sol directo y buen drenaje.', 18000, 16, 'salvia.jpg.webp', 0),
(5, 'Orquídea Phalaenopsis', 'Phalaenopsis sp.', 'Elegante flor de larga duración.', 'Luz filtrada y riego semanal.', 75000, 10, 'Orquideas_phalaenopsis.jpg', 1),
(5, 'Rosas', 'Rosa sp.', 'Clásicas flores para regalo y jardín.', 'Sol y riego constante.', 40000, 14, 'rosas.jpeg', 0),
(5, 'Girasol', 'Helianthus annuus', 'Flor alegre que sigue la luz del sol.', 'Mucho sol y riego frecuente.', 25000, 20, 'girasol.jpeg', 0),
(5, 'Tulipanes', 'Tulipa sp.', 'Flores de temporada con gran colorido.', 'Clima fresco y suelo fértil.', 32000, 12, 'tulipanes.jpg', 0),
(5, 'Hortensia', 'Hydrangea macrophylla', 'Arbusto de flores grandes y vistosas.', 'Sombra parcial y suelo ácido.', 55000, 9, 'hortencia.jpg', 0),
(5, 'Claveles', 'Dianthus caryophyllus', 'Flores aromáticas y duraderas.', 'Sol y riego moderado.', 20000, 25, 'claveles.jpg', 0),
(2, 'Heliconia', 'Heliconia rostrata', 'Tropical de inflorescencias llamativas.', 'Calor, humedad y buen riego.', 60000, 7, 'heliconia.jpg', 0),
(2, 'Ceiba', 'Ceiba pentandra', 'Árbol emblemático de gran porte.', 'Espacio amplio y sol pleno.', 45000, 5, 'ceiba.jpg', 0),
(2, 'Eucalipto', 'Eucalyptus sp.', 'Aromático y de crecimiento rápido.', 'Sol pleno y suelo drenado.', 38000, 10, 'eucalipto.jpg', 0);

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';


