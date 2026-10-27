import mongoose from 'mongoose';
import { env } from './env.js';
import '../models/index.js';

let listenersBound = false;

function bindConnectionListeners() {
  if (listenersBound) {
    return;
  }

  listenersBound = true;

  mongoose.connection.on('connected', () => {
    console.log('MongoDB connected');
  });

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected');
  });
}

export async function connectDb() {
  bindConnectionListeners();

  mongoose.set('strictQuery', true);

  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
    return;
  }

  try {
    await mongoose.connect(env.mongodbUri, {
      serverSelectionTimeoutMS: 5000,
    });
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    console.error(
      'Wallet transactions need a replica set (MongoDB Atlas or a local rs). See README.',
    );
    throw err;
  }
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export function getDbStatus() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const readyState = mongoose.connection.readyState;

  return {
    readyState,
    status: states[readyState] ?? 'unknown',
  };
}
