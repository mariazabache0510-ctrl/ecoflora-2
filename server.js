require('dotenv').config();
const { connect } = require('./src/db');
const { importIfEmpty } = require('./src/importer');
const { createApp } = require('./src/app');

async function main() {
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
