# Servidor 1: PostgreSQL 16 con la extensión mysql_fdw (para leer tablas de MySQL como si fueran locales).
# Nota: postgres_fdw solo conecta un Postgres con OTRO Postgres. Para llegar a MySQL se usa mysql_fdw,
# que funciona igual (CREATE SERVER / USER MAPPING / FOREIGN TABLE).
FROM postgres:16
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-mysql-fdw \
    && rm -rf /var/lib/apt/lists/*
