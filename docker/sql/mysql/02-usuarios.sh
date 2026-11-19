#!/bin/bash
# Crea el usuario que usa Postgres (mysql_fdw) con permisos SOLO sobre la tabla factura.
# La clave llega por variable de entorno (docker/.env): no está escrita en ningún archivo del repositorio.
set -euo pipefail
# En local docker/.env usa MYSQL_APP_PASSWORD; en Render la clave del usuario app es MYSQL_PASSWORD.
APP_PASS="${MYSQL_APP_PASSWORD:-${MYSQL_PASSWORD:?define MYSQL_APP_PASSWORD o MYSQL_PASSWORD}}"
mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS 'ecoflora_app'@'%' IDENTIFIED WITH mysql_native_password BY '${APP_PASS}';
GRANT SELECT, INSERT, UPDATE, DELETE ON ecoflora_facturas.* TO 'ecoflora_app'@'%';
CREATE USER IF NOT EXISTS '${FDW_MYSQL_USER}'@'%' IDENTIFIED WITH mysql_native_password BY '${FDW_MYSQL_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON ecoflora_facturas.factura TO '${FDW_MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
