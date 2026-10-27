import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Message } from '../src/models/Message.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import {
  reconcileStaleReservations,
  refundMessage,
  reserveSmsRequest,
  settleMessage,
} from '../src/services/wallet.service.js';
import { AppError } from '../src/utils/AppError.js';

const createdUserIds = [];

function recipient(overrides = {}) {
  return {
    phone: '9841234567',
    body: 'hello',
    encoding: 'gsm7',
    parts: 1,
    cost: 1,
    ...overrides,
  };
}

async function seedAccount(credits) {
  const user = await User.create({
    email: `wallet-stage6-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    passwordHash: 'not-a-login-hash',
  });
  createdUserIds.push(user._id);
  const wallet = await Wallet.create({ user: user._id, credits });
  return { user, wallet };
}

describe('wallet reserve / settle / refund (replica set)', () => {
  before(async () => {
    await connectDb();
    try {
      await mongoose.connection.transaction(async () => undefined);
    } catch (err) {
      throw new Error(
        `Wallet tests need a MongoDB replica set. ${err.message}. See README.`,
      );
    }
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await Message.deleteMany({ user: { $in: createdUserIds } });
      await Wallet.deleteMany({ user: { $in: createdUserIds } });
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectDb();
  });

  it('rejects reservation when credits are insufficient and does not debit', async () => {
    const { user, wallet } = await seedAccount(5);

    await assert.rejects(
      () => reserveSmsRequest({ userId: user._id, recipients: [recipient({ cost: 6 })] }),
      (err) => err instanceof AppError && err.statusCode === 400 && err.message === 'Insufficient credits',
    );

    const latest = await Wallet.findById(wallet._id);
    assert.equal(latest.credits, 5);
    assert.equal(await Message.countDocuments({ user: user._id }), 0);
  });

  it('reserves the full cost, persists pending charged messages, and never goes negative', async () => {
    const { user } = await seedAccount(10);
    const result = await reserveSmsRequest({
      userId: user._id,
      recipients: [recipient({ cost: 3, phone: '9841234567' }), recipient({ cost: 2, phone: '9801122334' })],
    });

    assert.equal(result.totalCost, 5);
    assert.equal(result.wallet.credits, 5);
    assert.equal(result.messages.length, 2);
    assert.ok(result.messages.every((msg) => msg.status === 'pending' && msg.charged && !msg.refunded));

    const stored = await Wallet.findOne({ user: user._id });
    assert.equal(stored.credits, 5);
    assert.ok(stored.credits >= 0);
  });

  it('settles a reserved message without changing the wallet', async () => {
    const { user } = await seedAccount(4);
    const reserved = await reserveSmsRequest({
      userId: user._id,
      recipients: [recipient({ cost: 4 })],
    });
    const messageId = reserved.messages[0].id;

    const first = await settleMessage(messageId, { sentVia: 'ROUTE_A' });
    assert.equal(first.alreadySettled, false);
    assert.equal(first.message.status, 'sent');
    assert.equal(first.message.sentVia, 'ROUTE_A');

    const second = await settleMessage(messageId, { sentVia: 'ROUTE_B' });
    assert.equal(second.alreadySettled, true);
    assert.equal(second.message.sentVia, 'ROUTE_A');

    const wallet = await Wallet.findOne({ user: user._id });
    assert.equal(wallet.credits, 0);

    await assert.rejects(
      () => refundMessage(messageId),
      (err) => err instanceof AppError && err.statusCode === 409,
    );
    const afterRefundAttempt = await Wallet.findOne({ user: user._id });
    assert.equal(afterRefundAttempt.credits, 0);
  });

  it('refunds a pending message once and ignores a second refund', async () => {
    const { user } = await seedAccount(8);
    const reserved = await reserveSmsRequest({
      userId: user._id,
      recipients: [recipient({ cost: 3 })],
    });
    const messageId = reserved.messages[0].id;
    assert.equal(reserved.wallet.credits, 5);

    const first = await refundMessage(messageId);
    assert.equal(first.alreadyRefunded, false);
    assert.equal(first.message.status, 'failed');
    assert.equal(first.message.refunded, true);
    assert.equal(first.wallet.credits, 8);

    const second = await refundMessage(messageId);
    assert.equal(second.alreadyRefunded, true);

    const wallet = await Wallet.findOne({ user: user._id });
    assert.equal(wallet.credits, 8);
  });

  it('allows only as many concurrent reservations as the wallet can afford', async () => {
    const { user } = await seedAccount(10);
    const attempts = Array.from({ length: 20 }, () =>
      reserveSmsRequest({ userId: user._id, recipients: [recipient({ cost: 1 })] }),
    );

    const outcomes = await Promise.allSettled(attempts);
    const fulfilled = outcomes.filter((item) => item.status === 'fulfilled');
    const rejected = outcomes.filter((item) => item.status === 'rejected');

    assert.equal(fulfilled.length, 10);
    assert.equal(rejected.length, 10);
    assert.ok(
      rejected.every(
        (item) => item.reason instanceof AppError && item.reason.message === 'Insufficient credits',
      ),
    );

    const wallet = await Wallet.findOne({ user: user._id });
    assert.equal(wallet.credits, 0);
    assert.equal(await Message.countDocuments({ user: user._id, charged: true }), 10);
  });

  it('reconciles stale pending reservations by refunding them once', async () => {
    const { user } = await seedAccount(6);
    const reserved = await reserveSmsRequest({
      userId: user._id,
      recipients: [recipient({ cost: 6 })],
    });
    const messageId = reserved.messages[0].id;

    await Message.updateOne(
      { _id: messageId },
      { $set: { updatedAt: new Date(Date.now() - 60_000) } },
      { timestamps: false },
    );

    const first = await reconcileStaleReservations({ olderThanMs: 1_000 });
    assert.ok(first.refunded >= 1);

    const wallet = await Wallet.findOne({ user: user._id });
    assert.equal(wallet.credits, 6);

    const second = await reconcileStaleReservations({ olderThanMs: 1_000 });
    const thisMessage = second.refunded;
    void thisMessage;
    const latest = await Message.findById(messageId);
    assert.equal(latest.refunded, true);
    assert.equal(latest.status, 'failed');
    assert.equal((await Wallet.findOne({ user: user._id })).credits, 6);
  });
});
