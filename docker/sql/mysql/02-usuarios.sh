#!/bin/bash
# Crea el usuario que usa Postgres (mysql_fdw) con permisos SOLO sobre la tabla factura.
# La clave llega por variable de entorno (docker/.env): no está escrita en ningún archivo del repositorio.
set -euo pipefail
mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS '${FDW_MYSQL_USER}'@'%' IDENTIFIED WITH mysql_native_password BY '${FDW_MYSQL_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON ecoflora_facturas.factura TO '${FDW_MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
