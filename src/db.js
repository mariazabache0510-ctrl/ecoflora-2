const mongoose = require('mongoose');

async function connect(uri) {
  if (!uri) {
    throw new Error('Falta MONGODB_URI');
  }
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  await mongoose.connect(uri);
  return mongoose.connection;
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = { connect, disconnect };
