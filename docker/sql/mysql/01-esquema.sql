-- Servidor 2 (MySQL 8): base ecoflora_facturas, tabla factura.
-- Cada fila es UNA LÍNEA de factura: una planta de un pedido. Las líneas de un mismo pedido comparten
-- numero (F-000012) e id_pedido. Los id_cliente e id_producto son los mismos de la base de Postgres
-- (cliente.id_cliente y producto.id_producto): esa es la relación que une las dos bases.
USE ecoflora_facturas;

CREATE TABLE IF NOT EXISTS factura (
    id_factura      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    numero          VARCHAR(20)   NOT NULL,
    id_pedido       INT UNSIGNED  NOT NULL,
    id_cliente      INT UNSIGNED  NOT NULL,
    id_producto     INT UNSIGNED  NOT NULL,
    cantidad        INT UNSIGNED  NOT NULL,
    precio_unitario DECIMAL(12,2) NOT NULL,
    total           DECIMAL(12,2) NOT NULL,
    estado          VARCHAR(20)   NOT NULL DEFAULT 'emitida',
    fecha           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_factura),
    UNIQUE KEY uq_pedido_producto (id_pedido, id_producto),
    KEY ix_factura_cliente (id_cliente),
    KEY ix_factura_producto (id_producto),
    CONSTRAINT ck_factura_cantidad CHECK (cantidad > 0),
    CONSTRAINT ck_factura_total CHECK (total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
