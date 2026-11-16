-- Ejercicio de enlace entre servidores (equivalente a un db_link), con mysql_fdw:
--   1) la extensión,  2) CREATE SERVER (a dónde),  3) USER MAPPING (con qué usuario),
--   4) FOREIGN TABLE (qué tabla remota se ve como local),  5) una vista que une las dos bases.

CREATE EXTENSION IF NOT EXISTS mysql_fdw;

CREATE SERVER servidor_mysql
    FOREIGN DATA WRAPPER mysql_fdw
    OPTIONS (host :'mysql_host', port :'mysql_port');

CREATE USER MAPPING FOR CURRENT_USER
    SERVER servidor_mysql
    OPTIONS (username :'mysql_user', password :'mysql_password');

-- mysql_fdw toma la PRIMERA columna como llave primaria (id_factura): así Postgres también puede
-- INSERT/UPDATE/DELETE en la tabla de MySQL, no solo leerla.
CREATE FOREIGN TABLE factura_mysql (
    id_factura      INTEGER       NOT NULL,
    numero          VARCHAR(20)   NOT NULL,
    id_pedido       INTEGER       NOT NULL,
    id_cliente      INTEGER       NOT NULL,
    id_producto     INTEGER       NOT NULL,
    cantidad        INTEGER       NOT NULL,
    precio_unitario NUMERIC(12,2) NOT NULL,
    total           NUMERIC(12,2) NOT NULL,
    estado          VARCHAR(20)   NOT NULL,
    fecha           TIMESTAMP     NOT NULL
)
    SERVER servidor_mysql
    OPTIONS (dbname 'ecoflora_facturas', table_name 'factura');

-- Consulta federada: cliente y producto viven en Postgres, factura vive en MySQL, y aquí se leen juntos.
CREATE OR REPLACE VIEW v_ventas_federada AS
SELECT f.id_factura,
       f.numero,
       f.id_pedido,
       f.fecha,
       c.id_cliente,
       c.nombre   AS cliente,
       c.email,
       p.id_producto,
       p.nombre   AS producto,
       p.categoria,
       f.cantidad,
       f.precio_unitario,
       f.total
FROM factura_mysql f
JOIN cliente  c ON c.id_cliente  = f.id_cliente
JOIN producto p ON p.id_producto = f.id_producto;
