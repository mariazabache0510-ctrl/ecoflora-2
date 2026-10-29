// Comprueba que actualizar el catálogo (data/ecoflora_full.sql) NO borra el stock que la
// administradora gestiona desde Admin > Inventario.
//
// Uso (solo con una base LOCAL de pruebas, nunca con la de producción):
//   MONGODB_URI=mongodb://127.0.0.1:27018/ecoflora_prueba node scripts/verify-stock-sync.js
const { connect, disconnect } = require('../src/db');
const { importIfEmpty, syncCatalog } = require('../src/importer');
const { Planta, Meta } = require('../src/models');

function assert(condition, message) {
  if (!condition) {
    console.error('FALLO:', message);
    process.exit(1);
  }
  console.log('ok', message);
}

async function main() {
  const uri = process.env.MONGODB_URI || '';
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(uri)) {
    console.error('Por seguridad este script solo corre contra una base local (MONGODB_URI=mongodb://127.0.0.1:...).');
    process.exit(1);
  }
  await connect(uri);
  await importIfEmpty();

  // Situación real: se vendió algo y llegó mercancía nueva.
  await Planta.updateOne({ id_planta: 1 }, { $set: { stock: 40 } });
  await Planta.updateOne({ id_planta: 2 }, { $set: { stock: 0 } });
  const dump = await Planta.findOne({ id_planta: 3 }).lean();
  // Una planta cuyo id ahora corresponde a otra distinta no debe heredar el stock de la anterior.
  await Planta.updateOne({ id_planta: 3 }, { $set: { nombre: 'Planta que ya no es la misma', stock: 77 } });

  // Simula que el archivo SQL cambió: borra la huella guardada para forzar la sincronización.
  await Meta.deleteOne({ _id: 'dump_hash' });
  const sincronizo = await syncCatalog();
  assert(sincronizo === true, 'el catálogo se vuelve a sincronizar cuando cambia el SQL');

  assert((await Planta.countDocuments()) === 22, 'el catálogo sigue con 22 plantas');
  const uno = await Planta.findOne({ id_planta: 1 }).lean();
  const dos = await Planta.findOne({ id_planta: 2 }).lean();
  const tres = await Planta.findOne({ id_planta: 3 }).lean();
  assert(uno.stock === 40, 'la Monstera conserva el stock repuesto desde el panel (40, no el 15 del SQL)');
  assert(dos.stock === 0, 'una planta agotada sigue agotada tras sincronizar');
  assert(tres.nombre === dump.nombre && tres.stock === dump.stock, 'si el id pasa a ser otra planta, toma el stock del SQL y no el de la anterior');

  await disconnect();
  console.log('Sincronización de catálogo con stock conservado: correcta.');
}

main().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
