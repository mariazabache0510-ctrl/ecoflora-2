#!/bin/bash
# Enlaza este servidor (PostgreSQL) con el servidor MySQL: la tabla factura de MySQL se ve desde aquí
# como la tabla externa factura_mysql. La clave del enlace llega por variable de entorno (docker/.env).
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v mysql_host="$FDW_MYSQL_HOST" -v mysql_port="$FDW_MYSQL_PORT" \
  -v mysql_user="$FDW_MYSQL_USER" -v mysql_password="$FDW_MYSQL_PASSWORD" \
  -f /federacion.sql
