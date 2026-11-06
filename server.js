require('dotenv').config();
const { connect } = require('./src/db');
const { importIfEmpty, syncCatalog, ensureAdmin, advertirSiAdminTieneClaveDeFabrica, borrarRostrosDeAdmins } = require('./src/importer');
const { createApp } = require('./src/app');
const { secretoDeSesion, esProduccion } = require('./src/entorno');

async function main() {
  // En producción el servidor no arranca sin un SESSION_SECRET real (falla aquí, antes de abrir nada).
  secretoDeSesion();
  const uri = process.env.MONGODB_URI
    || (process.env.NODE_ENV === 'production' ? '' : 'mongodb://127.0.0.1:27017/ecoflora');
  if (!uri) {
    console.error('Define MONGODB_URI para conectar con MongoDB.');
    process.exit(1);
  }
  await connect(uri);
  const imported = await importIfEmpty();
  if (imported) {
    console.log('Base vacía: se importó el catálogo y se creó el administrador.');
  } else if (await syncCatalog()) {
    await ensureAdmin();
    console.log('Catálogo actualizado desde data/ecoflora_full.sql.');
  }
  try {
    // El admin entra solo con contraseña: no se conserva ningún rostro de una cuenta admin.
    const borrados = await borrarRostrosDeAdmins();
    if (borrados) console.log(`Se borró el rostro guardado de ${borrados} cuenta(s) admin (el admin entra solo con contraseña).`);
  } catch (error) {
    console.error('No se pudo revisar los rostros de las cuentas admin:', error.message);
  }
  if (esProduccion()) {
    try {
      await advertirSiAdminTieneClaveDeFabrica();
    } catch (error) {
      console.error('No se pudo revisar la contraseña del admin:', error.message);
    }
  }
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  app.listen(port, '0.0.0.0', () => {
    console.log(`EcoFlora escuchando en 0.0.0.0:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
