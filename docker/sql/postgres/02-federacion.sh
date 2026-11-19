#!/bin/bash
# Enlaza este servidor (PostgreSQL) con el servidor MySQL: la tabla factura de MySQL se ve desde aquí
# como la tabla externa factura_mysql. Espera a que MySQL acepte conexiones (arranque en Render/Docker).
set -euo pipefail

host="${FDW_MYSQL_HOST:?}"
port="${FDW_MYSQL_PORT:?}"

echo "Esperando MySQL en ${host}:${port}..."
for i in $(seq 1 90); do
  if (echo >"/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
    echo "MySQL responde."
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "MySQL no respondió a tiempo; la federación fallará." >&2
    exit 1
  fi
  sleep 2
done
# Un poco más: el puerto abre antes de que el usuario FDW exista.
sleep 5

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v mysql_host="$FDW_MYSQL_HOST" -v mysql_port="$FDW_MYSQL_PORT" \
  -v mysql_user="$FDW_MYSQL_USER" -v mysql_password="$FDW_MYSQL_PASSWORD" \
  -f /federacion.sql
