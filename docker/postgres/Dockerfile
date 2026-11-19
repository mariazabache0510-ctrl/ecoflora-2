# Servidor 1: PostgreSQL 16 con mysql_fdw (lee la tabla factura de MySQL como si fuera local).
FROM postgres:16
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-mysql-fdw \
    && rm -rf /var/lib/apt/lists/*
COPY sql/postgres/01-esquema.sql /docker-entrypoint-initdb.d/01-esquema.sql
COPY sql/postgres/02-federacion.sh /docker-entrypoint-initdb.d/02-federacion.sh
COPY sql/federacion.sql /federacion.sql
RUN chmod +x /docker-entrypoint-initdb.d/02-federacion.sh
