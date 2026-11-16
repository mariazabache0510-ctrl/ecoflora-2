// Carga inicial (o repetida) de la base federada: copia clientes y plantas de MongoDB a PostgreSQL y las facturas
// de los pedidos a MySQL. Se puede repetir sin duplicar nada.
//
// Uso (con los dos servidores de docker/ encendidos y PG_URL, MYSQL_URL y MONGODB_URI en tu .env):
//   node scripts/federada-sync.js

require('dotenv').config();
const { connect, disconnect } = require('../src/db');
const federada = require('../src/federada');

async function main() {
  if (!federada.habilitada()) {
    console.error('Define PG_URL y MYSQL_URL en tu .env (ejemplos en .env.example) y enciende docker/ (docker compose up -d).');
    process.exit(1);
  }
  await connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecoflora');
  try {
    const r = await federada.sincronizarTodo();
    console.log(`Listo: ${r.clientes} clientes y ${r.productos} productos -> PostgreSQL; ${r.facturas} líneas de factura -> MySQL.`);
    if (r.omitidas) console.log(`(${r.omitidas} pedidos omitidos: su cliente ya no existe como cuenta.)`);
  } finally {
    await federada.cerrar();
    await disconnect();
  }
}

main().catch((error) => {
  console.error('Falló la sincronización:', error.message);
  process.exit(1);
});
