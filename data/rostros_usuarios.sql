-- Estructura de REFERENCIA para el inicio de sesión con rostro de EcoFlora.
--
-- EcoFlora usa MongoDB: la colección `rostros_usuarios` se crea sola (ver RostroUsuario en
-- src/models.js) y NO hace falta ejecutar este archivo. Está aquí para documentar la tabla
-- equivalente si alguna vez se migra a una base SQL (PostgreSQL / Neon / MySQL).
--
-- Este archivo es distinto de data/ecoflora_full.sql a propósito:
--   * el importador del catálogo solo lee ecoflora_full.sql y lo vuelve a aplicar cuando cambia;
--   * los rostros son datos personales sensibles (Ley 1581 de 2012) y NUNCA deben guardarse
--     en el repositorio: aquí solo va la estructura, jamás datos.

CREATE TABLE rostros_usuarios (
  id_rostro              SERIAL PRIMARY KEY,
  id_usuario             INT NOT NULL UNIQUE REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  -- Hasta 5 descriptores faciales (128 números cada uno) cifrados con AES-256-GCM,
  -- guardados como texto "v1.iv.tag.datos" (base64url). Nunca la foto.
  descriptores_cifrados  TEXT[] NOT NULL,
  algoritmo              VARCHAR(40) NOT NULL DEFAULT 'face-api-128',
  -- Autorización del tratamiento de datos biométricos (Ley 1581 de 2012).
  consentimiento_fecha   TIMESTAMP NOT NULL,
  consentimiento_version VARCHAR(30) NOT NULL,
  fecha_registro         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_uso             TIMESTAMP NULL
);
