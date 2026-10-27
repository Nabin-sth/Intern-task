import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Message } from '../src/models/Message.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { ensureProviders, getMockProviders } from '../src/providers/ensureProviders.js';

const createdUserIds = [];
let server;
let baseUrl;

function authHeader(user) {
  const token = jwt.sign({ email: user.email }, env.jwtSecret, {
    subject: user.id,
    expiresIn: '1h',
  });
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function seedAccount(credits) {
  const user = await User.create({
    email: `sms-stage7-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    passwordHash: 'not-a-login-hash',
  });
  createdUserIds.push(user._id);
  const wallet = await Wallet.create({ user: user._id, credits });
  return { user, wallet };
}

async function postSend(user, body) {
  const res = await fetch(`${baseUrl}/sms/send`, {
    method: 'POST',
    headers: authHeader(user),
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { res, json };
}

function providers() {
  return getMockProviders();
}

describe('POST /sms/send (integration)', () => {
  before(async () => {
    await connectDb();
    try {
      await mongoose.connection.transaction(async () => undefined);
    } catch (err) {
      throw new Error(
        `SMS send tests need a MongoDB replica set. ${err.message}. See README.`,
      );
    }

    await ensureProviders();

    server = await new Promise((resolve) => {
      const httpServer = app.listen(0, '127.0.0.1', () => resolve(httpServer));
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(() => {
    for (const provider of providers()) {
      provider.clearForcedOutcome();
    }
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

    await disconnectDb();
  });

  it('rejects invalid phone numbers before charging', async () => {
    const { user, wallet } = await seedAccount(10);
    const { res, json } = await postSend(user, {
      to: ['9612345678'],
      message: 'hello',
    });

    assert.equal(res.status, 400);
    assert.equal(json.error.message, 'Invalid phone number');
    assert.equal((await Wallet.findById(wallet._id)).credits, 10);
    assert.equal(await Message.countDocuments({ user: user._id }), 0);
  });

  it('rejects insufficient credits before calling providers', async () => {
    const { user, wallet } = await seedAccount(0);
    const { res, json } = await postSend(user, {
      to: ['9841234567'],
      message: 'hello',
    });

    assert.equal(res.status, 400);
    assert.equal(json.error.message, 'Insufficient credits');
    assert.equal((await Wallet.findById(wallet._id)).credits, 0);
    assert.equal(await Message.countDocuments({ user: user._id }), 0);
  });

  it('sends successfully through the highest-priority provider', async () => {
    const { user } = await seedAccount(5);
    for (const provider of providers()) {
      provider.setForcedOutcome('success');
    }

    const { res, json } = await postSend(user, {
      to: ['+9779801122334'],
      message: 'hello',
    });

    assert.equal(res.status, 200);
    assert.equal(json.data.parts, 1);
    assert.equal(json.data.totalCost, env.smsCostPerPart);
    assert.equal(json.data.results.length, 1);
    assert.equal(json.data.results[0].status, 'sent');
    assert.equal(json.data.results[0].phone, '9801122334');
    assert.equal(json.data.results[0].sentVia, 'ROUTE_A');
    assert.equal(json.data.results[0].refunded, false);
    assert.equal(json.data.wallet.credits, 5 - env.smsCostPerPart);

    const stored = await Message.findById(json.data.results[0].id);
    assert.equal(stored.status, 'sent');
    assert.equal(stored.charged, true);
    assert.equal(stored.refunded, false);
  });

  it('fails over to the next provider when the first route fails', async () => {
    const { user } = await seedAccount(5);
    const [routeA, routeB, routeC] = providers();
    routeA.setForcedOutcome('failure');
    routeB.setForcedOutcome('success');
    routeC.setForcedOutcome('success');

    const { res, json } = await postSend(user, {
      to: ['9841234567'],
      message: 'hello',
    });

    assert.equal(res.status, 200);
    assert.equal(json.data.results[0].status, 'sent');
    assert.equal(json.data.results[0].sentVia, 'ROUTE_B');
    assert.equal(json.data.results[0].refunded, false);

    const attempts = json.data.results[0].providerAttempts;
    assert.equal(attempts[0].providerName, 'ROUTE_A');
    assert.equal(attempts[0].success, false);
    assert.equal(attempts[1].providerName, 'ROUTE_B');
    assert.equal(attempts[1].success, true);
  });

  it('refunds reserved credits when every provider fails', async () => {
    const { user } = await seedAccount(5);
    for (const provider of providers()) {
      provider.setForcedOutcome('failure');
    }

    const { res, json } = await postSend(user, {
      to: ['9841234567'],
      message: 'hello',
    });

    assert.equal(res.status, 200);
    assert.equal(json.data.results[0].status, 'failed');
    assert.equal(json.data.results[0].refunded, true);
    assert.equal(json.data.results[0].sentVia, null);
    assert.equal(json.data.wallet.credits, 5);
    assert.ok(json.data.results[0].providerAttempts.every((attempt) => attempt.success === false));

    const stored = await Message.findById(json.data.results[0].id);
    assert.equal(stored.refunded, true);
    assert.equal(stored.status, 'failed');
  });

  it('supports partial success: refunds only the failed recipient', async () => {
    const { user } = await seedAccount(10);
    const okPhone = '9841234567';
    const failPhone = '9801122334';

    for (const provider of providers()) {
      provider.setForcedOutcomeForPhone(okPhone, 'success');
      provider.setForcedOutcomeForPhone(failPhone, 'failure');
    }

    const { res, json } = await postSend(user, {
      to: [okPhone, failPhone],
      message: 'hello',
    });

    assert.equal(res.status, 200);
    assert.equal(json.data.totalCost, env.smsCostPerPart * 2);
    assert.equal(json.data.results.length, 2);

    const sent = json.data.results.find((item) => item.phone === okPhone);
    const failed = json.data.results.find((item) => item.phone === failPhone);

    assert.equal(sent.status, 'sent');
    assert.equal(sent.refunded, false);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.refunded, true);
    assert.equal(json.data.wallet.credits, 10 - env.smsCostPerPart);
  });
});
