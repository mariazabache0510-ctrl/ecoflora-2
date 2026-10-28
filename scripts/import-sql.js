require('dotenv').config();
const path = require('path');
const { connect, disconnect } = require('../src/db');
const { importFile, ensureAdmin, resolveSqlPath } = require('../src/importer');

async function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : resolveSqlPath();
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecoflora';
  await connect(uri);
  await importFile(file);
  const admin = await ensureAdmin();
  console.log(`Importación lista: ${file}`);
  console.log(`Administrador: ${admin.usuario} (${admin.email})`);
  await disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
