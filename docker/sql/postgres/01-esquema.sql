-- Servidor 1 (PostgreSQL 16): base ecoflora_pg, tablas cliente y producto.
-- id_cliente = id_usuario de la colección usuarios de MongoDB; id_producto = id_planta del catálogo.

CREATE TABLE IF NOT EXISTS cliente (
    id_cliente   INTEGER      PRIMARY KEY,
    nombre       VARCHAR(100) NOT NULL,
    email        VARCHAR(150) NOT NULL,
    telefono     VARCHAR(30)  NOT NULL DEFAULT '',
    direccion    VARCHAR(200) NOT NULL DEFAULT '',
    ciudad       VARCHAR(100) NOT NULL DEFAULT '',
    creado       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS producto (
    id_producto        INTEGER       PRIMARY KEY,
    nombre             VARCHAR(150)  NOT NULL,
    nombre_cientifico  VARCHAR(150)  NOT NULL DEFAULT '',
    categoria          VARCHAR(100)  NOT NULL DEFAULT '',
    precio             NUMERIC(12,2) NOT NULL CHECK (precio >= 0),
    stock              INTEGER       NOT NULL DEFAULT 0 CHECK (stock >= 0),
    actualizado        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cliente_email ON cliente (email);
CREATE INDEX IF NOT EXISTS ix_producto_categoria ON producto (categoria);
