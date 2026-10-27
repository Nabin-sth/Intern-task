import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Message } from '../models/Message.js';
import { Wallet } from '../models/Wallet.js';
import { AppError } from '../utils/AppError.js';

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw new AppError(`${field} must be a positive integer`, 400);
  }
}

function toPublicMessage(doc) {
  return {
    id: doc.id,
    requestId: String(doc.requestId),
    phone: doc.phone,
    encoding: doc.encoding,
    parts: doc.parts,
    cost: doc.cost,
    status: doc.status,
    charged: doc.charged,
    refunded: doc.refunded,
    sentVia: doc.sentVia ?? null,
  };
}

/**
 * Short transaction: debit the full request cost if credits >= cost, then
 * insert pending messages with charged=true. Never call providers here.
 */
export async function reserveSmsRequest({ userId, recipients }) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new AppError('At least one recipient is required', 400);
  }

  const totalCost = recipients.reduce((sum, item) => {
    requirePositiveInteger(item.cost, 'cost');
    requirePositiveInteger(item.parts, 'parts');
    return sum + item.cost;
  }, 0);

  return mongoose.connection.transaction(async (session) => {
    const wallet = await Wallet.findOne({ user: userId }).session(session);
    if (!wallet) {
      throw new AppError('Wallet not found for this account', 500);
    }

    const updated = await Wallet.findOneAndUpdate(
      { _id: wallet._id, credits: { $gte: totalCost } },
      { $inc: { credits: -totalCost } },
      { new: true, session },
    );

    if (!updated) {
      throw new AppError('Insufficient credits', 400, {
        required: totalCost,
        available: wallet.credits,
      });
    }

    const requestId = new mongoose.Types.ObjectId();
    const docs = recipients.map((item) => ({
      user: userId,
      wallet: wallet._id,
      requestId,
      phone: item.phone,
      body: item.body,
      encoding: item.encoding,
      parts: item.parts,
      cost: item.cost,
      status: 'pending',
      charged: true,
      refunded: false,
    }));

    const created = await Message.create(docs, { session, ordered: true });
    const messages = Array.isArray(created) ? created : [created];

    return {
      requestId: String(requestId),
      totalCost,
      wallet: { credits: updated.credits },
      messages: messages.map(toPublicMessage),
    };
  });
}

/**
 * Mark a reserved message as sent. No wallet change (credits already held).
 * Idempotent if the message is already sent.
 */
export async function settleMessage(messageId, { sentVia, providerAttempts } = {}) {
  const existing = await Message.findById(messageId);
  if (!existing) {
    throw new AppError('Message not found', 404);
  }

  if (existing.status === 'sent' && existing.charged && !existing.refunded) {
    return { message: toPublicMessage(existing), alreadySettled: true };
  }

  if (existing.refunded || existing.status === 'failed') {
    throw new AppError('Cannot settle a refunded or failed message', 409);
  }

  const updated = await Message.findOneAndUpdate(
    {
      _id: messageId,
      status: 'pending',
      charged: true,
      refunded: false,
    },
    {
      $set: {
        status: 'sent',
        sentVia,
        ...(providerAttempts ? { providerAttempts } : {}),
      },
    },
    { new: true },
  );

  if (!updated) {
    throw new AppError('Cannot settle this message', 409);
  }

  return { message: toPublicMessage(updated), alreadySettled: false };
}

/**
 * Short transaction: refund once if the message is still charged and not sent.
 * Parallel refunds: only the first matching update increments the wallet.
 */
export async function refundMessage(messageId, { providerAttempts } = {}) {
  const existing = await Message.findById(messageId);
  if (!existing) {
    throw new AppError('Message not found', 404);
  }

  if (existing.status === 'sent') {
    throw new AppError('Cannot refund a sent message', 409);
  }

  if (existing.refunded) {
    return {
      message: toPublicMessage(existing),
      alreadyRefunded: true,
      wallet: null,
    };
  }

  return mongoose.connection.transaction(async (session) => {
    const claimed = await Message.findOneAndUpdate(
      {
        _id: messageId,
        charged: true,
        refunded: false,
        status: { $in: ['pending', 'failed'] },
      },
      {
        $set: {
          refunded: true,
          status: 'failed',
          ...(providerAttempts ? { providerAttempts } : {}),
        },
      },
      { new: true, session },
    );

    if (!claimed) {
      const latest = await Message.findById(messageId).session(session);
      if (latest?.refunded) {
        return {
          message: toPublicMessage(latest),
          alreadyRefunded: true,
          wallet: null,
        };
      }

      throw new AppError('Cannot refund this message', 409);
    }

    const wallet = await Wallet.findByIdAndUpdate(
      claimed.wallet,
      { $inc: { credits: claimed.cost } },
      { new: true, session },
    );

    return {
      message: toPublicMessage(claimed),
      alreadyRefunded: false,
      wallet: { credits: wallet.credits },
    };
  });
}

/**
 * Crash recovery: pending+charged+!refunded rows older than the timeout are
 * treated as abandoned holds and refunded once. This does not retry sending
 * (retry could double-deliver). If a provider already accepted the SMS but
 * settle never ran, this can refund a delivered message — documented tradeoff.
 */
export async function reconcileStaleReservations({
  olderThanMs = env.pendingReconcileMs,
} = {}) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await Message.find({
    status: 'pending',
    charged: true,
    refunded: false,
    updatedAt: { $lte: cutoff },
  }).select('_id');

  const results = [];
  for (const row of stale) {
    results.push(await refundMessage(row._id));
  }

  return {
    cutoff,
    scanned: stale.length,
    refunded: results.filter((item) => !item.alreadyRefunded).length,
  };
}
