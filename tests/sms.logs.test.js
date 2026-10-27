import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Message } from '../src/models/Message.js';
import { Provider } from '../src/models/Provider.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { ensureProviders } from '../src/providers/ensureProviders.js';

const createdUserIds = [];
let server;
let baseUrl;

function authHeader(user) {
  const token = jwt.sign({ email: user.email }, env.jwtSecret, {
    subject: user.id,
    expiresIn: '1h',
  });
  return { Authorization: `Bearer ${token}` };
}

async function seedAccount() {
  const user = await User.create({
    email: `sms-stage8-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    passwordHash: 'not-a-login-hash',
  });
  createdUserIds.push(user._id);
  const wallet = await Wallet.create({ user: user._id, credits: 50 });
  return { user, wallet };
}

async function insertMessage(user, wallet, overrides = {}) {
  const createdAt = overrides.createdAt ?? new Date();
  const attemptedAt = overrides.attemptedAt ?? createdAt;
  const { createdAt: _createdAt, attemptedAt: _attemptedAt, ...rest } = overrides;
  void _createdAt;
  void _attemptedAt;

  const _id = new mongoose.Types.ObjectId();
  await Message.collection.insertOne({
    _id,
    user: user._id,
    wallet: wallet._id,
    requestId: new mongoose.Types.ObjectId(),
    phone: '9841234567',
    body: 'hello',
    encoding: 'gsm7',
    parts: 1,
    cost: 1,
    status: 'sent',
    charged: true,
    refunded: false,
    sentVia: 'ROUTE_A',
    providerAttempts: [
      {
        providerName: 'ROUTE_A',
        success: true,
        attemptedAt,
      },
    ],
    createdAt,
    updatedAt: createdAt,
    ...rest,
  });

  return Message.findById(_id);
}

async function getLogs(user, query = '') {
  const res = await fetch(`${baseUrl}/sms/logs${query}`, {
    headers: authHeader(user),
  });
  const json = await res.json();
  return { res, json };
}

describe('GET /sms/logs and GET /routes/health', () => {
  before(async () => {
    await connectDb();
    try {
      await mongoose.connection.transaction(async () => undefined);
    } catch (err) {
      throw new Error(
        `Logs/health tests need a MongoDB replica set. ${err.message}. See README.`,
      );
    }

    await ensureProviders();

    server = await new Promise((resolve) => {
      const httpServer = app.listen(0, '127.0.0.1', () => resolve(httpServer));
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }

    if (createdUserIds.length > 0) {
      await Message.deleteMany({ user: { $in: createdUserIds } });
      await Wallet.deleteMany({ user: { $in: createdUserIds } });
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await Provider.deleteMany({ name: { $in: ['AUDIT_A', 'AUDIT_B', 'AUDIT_C'] } });

    await disconnectDb();
  });

  it('requires authentication for logs', async () => {
    const res = await fetch(`${baseUrl}/sms/logs`);
    const json = await res.json();
    assert.equal(res.status, 401);
    assert.equal(json.success, false);
  });

  it('filters by status, phone (normalised), and inclusive date bounds', async () => {
    const { user, wallet } = await seedAccount();
    const t1 = new Date('2026-01-10T10:00:00.000Z');
    const t2 = new Date('2026-01-11T10:00:00.000Z');
    const t3 = new Date('2026-01-12T10:00:00.000Z');

    await insertMessage(user, wallet, {
      phone: '9841234567',
      status: 'sent',
      createdAt: t1,
    });
    await insertMessage(user, wallet, {
      phone: '9801122334',
      status: 'failed',
      sentVia: null,
      charged: true,
      refunded: true,
      createdAt: t2,
      providerAttempts: [{ providerName: 'ROUTE_A', success: false, attemptedAt: t2 }],
    });
    await insertMessage(user, wallet, {
      phone: '9841234567',
      status: 'pending',
      sentVia: null,
      charged: true,
      refunded: false,
      createdAt: t3,
      providerAttempts: [],
    });

    const byStatus = await getLogs(user, '?status=failed');
    assert.equal(byStatus.res.status, 200);
    assert.equal(byStatus.json.data.total, 1);
    assert.equal(byStatus.json.data.items[0].status, 'failed');
    assert.equal(byStatus.json.data.items[0].phone, '9801122334');

    const byPhone = await getLogs(user, '?phone=%2B9779841234567');
    assert.equal(byPhone.json.data.total, 2);
    assert.ok(byPhone.json.data.items.every((item) => item.phone === '9841234567'));

    const byDate = await getLogs(
      user,
      '?from=2026-01-11T00:00:00.000Z&to=2026-01-11T23:59:59.000Z',
    );
    assert.equal(byDate.json.data.total, 1);
    assert.equal(byDate.json.data.items[0].phone, '9801122334');

    const inclusive = await getLogs(
      user,
      '?from=2026-01-10T10:00:00.000Z&to=2026-01-12T10:00:00.000Z',
    );
    assert.equal(inclusive.json.data.total, 3);
  });

  it('paginates newest first', async () => {
    const { user, wallet } = await seedAccount();
    const t1 = new Date('2026-02-01T00:00:00.000Z');
    const t2 = new Date('2026-02-02T00:00:00.000Z');
    const t3 = new Date('2026-02-03T00:00:00.000Z');
    await insertMessage(user, wallet, { body: 'one', createdAt: t1 });
    await insertMessage(user, wallet, { body: 'two', createdAt: t2 });
    await insertMessage(user, wallet, { body: 'three', createdAt: t3 });

    const page1 = await getLogs(user, '?page=1&limit=2');
    assert.equal(page1.json.data.total, 3);
    assert.equal(page1.json.data.totalPages, 2);
    assert.equal(page1.json.data.items.length, 2);
    assert.deepEqual(
      page1.json.data.items.map((item) => item.body),
      ['three', 'two'],
    );

    const page2 = await getLogs(user, '?page=2&limit=2');
    assert.equal(page2.json.data.items.length, 1);
    assert.equal(page2.json.data.items[0].body, 'one');
  });

  it('does not leak another user\'s messages', async () => {
    const a = await seedAccount();
    const b = await seedAccount();
    await insertMessage(a.user, a.wallet, { body: 'secret-a' });
    await insertMessage(b.user, b.wallet, { body: 'secret-b' });

    const logs = await getLogs(a.user);
    assert.ok(logs.json.data.items.every((item) => item.body !== 'secret-b'));
    assert.ok(logs.json.data.items.some((item) => item.body === 'secret-a'));
  });

  it('computes 24h success rate from persisted attempts and handles empty routes', async () => {
    const { user, wallet } = await seedAccount();
    const now = Date.now();
    const inside = new Date(now - 2 * 60 * 60 * 1000);
    const edge = new Date(now - 24 * 60 * 60 * 1000 + 5000);
    const outside = new Date(now - 24 * 60 * 60 * 1000 - 60_000);

    const auditNames = ['AUDIT_A', 'AUDIT_B', 'AUDIT_C'];
    await Provider.deleteMany({ name: { $in: auditNames } });
    await Provider.insertMany(
      auditNames.map((name, index) => ({
        name,
        priority: 100 + index,
        balance: 5000,
        failureRate: 0,
        isActive: true,
      })),
    );

    await insertMessage(user, wallet, {
      createdAt: inside,
      attemptedAt: inside,
      sentVia: 'AUDIT_A',
      providerAttempts: [
        { providerName: 'AUDIT_A', success: true, attemptedAt: inside },
        { providerName: 'AUDIT_A', success: false, error: 'simulated_failure', attemptedAt: inside },
        { providerName: 'AUDIT_A', success: true, attemptedAt: inside },
        {
          providerName: 'AUDIT_A',
          success: false,
          error: 'insufficient_balance',
          attemptedAt: inside,
        },
        { providerName: 'AUDIT_B', success: true, attemptedAt: inside },
        { providerName: 'AUDIT_A', success: false, error: 'simulated_failure', attemptedAt: outside },
        { providerName: 'AUDIT_A', success: true, attemptedAt: edge },
      ],
    });

    const res = await fetch(`${baseUrl}/routes/health`);
    const json = await res.json();
    assert.equal(res.status, 200);

    const routeA = json.data.routes.find((route) => route.name === 'AUDIT_A');
    const routeB = json.data.routes.find((route) => route.name === 'AUDIT_B');
    const routeC = json.data.routes.find((route) => route.name === 'AUDIT_C');

    assert.equal(routeA.attempts, 4);
    assert.equal(routeA.successes, 3);
    assert.equal(routeA.successRate, 0.75);
    assert.equal(routeA.successRatePercent, 75);
    assert.equal(routeA.sample, 'ok');
    assert.equal(typeof routeA.balance, 'number');
    assert.equal(typeof routeA.healthPercent, 'number');

    assert.equal(routeB.attempts, 1);
    assert.equal(routeB.successes, 1);
    assert.equal(routeB.successRate, 1);

    assert.equal(routeC.attempts, 0);
    assert.equal(routeC.successRate, null);
    assert.equal(routeC.successRatePercent, null);
    assert.equal(routeC.sample, 'no_send_attempts');

    const expectedEmptyHealth = Math.round(100 * 0.4 * Math.min(1, 5000 / env.healthyProviderBalance));
    assert.equal(routeC.healthPercent, expectedEmptyHealth);

    await Provider.deleteMany({ name: { $in: auditNames } });
  });
});
