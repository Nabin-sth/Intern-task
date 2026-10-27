import app from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { ensureProviders } from './providers/ensureProviders.js';
import { reconcileStaleReservations } from './services/wallet.service.js';

let server;

async function start() {
  try {
    await connectDb();
    await ensureProviders();
    const recovered = await reconcileStaleReservations();
    if (recovered.refunded > 0) {
      console.log(
        `Reconciled ${recovered.refunded} stale pending message(s) (credits refunded)`,
      );
    }
  } catch {
    process.exit(1);
  }

  server = app.listen(env.port, () => {
    console.log(`Mini SMS Gateway listening on http://localhost:${env.port}`);
    console.log(`Health check: GET http://localhost:${env.port}/health`);
  });
}

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);

  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }

  try {
    await disconnectDb();
  } catch (err) {
    console.error('Error closing MongoDB:', err.message);
  }

  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

start();
