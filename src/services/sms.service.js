import { env } from '../config/env.js';
import { Message } from '../models/Message.js';
import { Wallet } from '../models/Wallet.js';
import { getMockProviders } from '../providers/ensureProviders.js';
import { PhoneValidationError, normalizeNepaliMobile } from '../utils/phone.js';
import { analyzeSms } from '../utils/smsSegment.js';
import { AppError } from '../utils/AppError.js';
import { refundMessage, reserveSmsRequest, settleMessage } from './wallet.service.js';
import { sendWithFailover } from './routing.service.js';

function uniqueNormalizedPhones(to) {
  const invalid = [];
  const unique = [];
  const seen = new Set();

  to.forEach((value, index) => {
    try {
      const phone = normalizeNepaliMobile(value);
      if (!seen.has(phone)) {
        seen.add(phone);
        unique.push(phone);
      }
    } catch (err) {
      invalid.push({
        index,
        value,
        message: err instanceof PhoneValidationError ? err.message : 'Invalid phone number',
      });
    }
  });

  if (invalid.length > 0) {
    throw new AppError('Invalid phone number', 400, { invalid });
  }

  return unique;
}

function publicResult(message, extra = {}) {
  return {
    id: message.id,
    phone: message.phone,
    status: message.status,
    cost: message.cost,
    charged: message.charged,
    refunded: message.refunded,
    sentVia: message.sentVia ?? null,
    ...extra,
  };
}

export async function sendSms({ userId, to, message }) {
  const phones = uniqueNormalizedPhones(to);
  const analysis = analyzeSms(message);
  const costPerPart = env.smsCostPerPart;
  const costPerRecipient = analysis.parts * costPerPart;
  const totalCost = costPerRecipient * phones.length;

  const providers = getMockProviders();
  if (providers.length === 0) {
    throw new AppError('No SMS providers are configured', 503);
  }

  const reservation = await reserveSmsRequest({
    userId,
    recipients: phones.map((phone) => ({
      phone,
      body: message,
      encoding: analysis.encoding,
      parts: analysis.parts,
      cost: costPerRecipient,
    })),
  });

  const results = [];

  for (const reserved of reservation.messages) {
    const routed = await sendWithFailover({
      to: reserved.phone,
      body: message,
      parts: analysis.parts,
      providers,
    });

    if (routed.success) {
      const settled = await settleMessage(reserved.id, {
        sentVia: routed.sentVia,
        providerAttempts: routed.attempts,
      });
      results.push(publicResult(settled.message, { providerAttempts: routed.attempts }));
    } else {
      const refunded = await refundMessage(reserved.id, {
        providerAttempts: routed.attempts,
      });
      results.push(publicResult(refunded.message, { providerAttempts: routed.attempts }));
    }
  }

  const wallet = await Wallet.findOne({ user: userId });

  return {
    requestId: reservation.requestId,
    encoding: analysis.encoding,
    parts: analysis.parts,
    costPerPart,
    costPerRecipient,
    totalCost,
    wallet: { credits: wallet.credits },
    results,
  };
}

function publicLog(doc) {
  return {
    id: doc.id,
    requestId: String(doc.requestId),
    phone: doc.phone,
    body: doc.body,
    encoding: doc.encoding,
    parts: doc.parts,
    cost: doc.cost,
    status: doc.status,
    charged: doc.charged,
    refunded: doc.refunded,
    sentVia: doc.sentVia ?? null,
    providerAttempts: doc.providerAttempts,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listSmsLogs({
  userId,
  page = 1,
  limit = 20,
  status,
  from,
  to,
  phone,
}) {
  const filter = { user: userId };

  if (status) {
    filter.status = status;
  }

  if (phone) {
    try {
      filter.phone = normalizeNepaliMobile(phone);
    } catch (err) {
      throw new AppError(
        err instanceof PhoneValidationError ? err.message : 'Invalid phone number',
        400,
      );
    }
  }

  if (from || to) {
    filter.createdAt = {};
    if (from) {
      filter.createdAt.$gte = from;
    }
    if (to) {
      filter.createdAt.$lte = to;
    }
  }

  const skip = (page - 1) * limit;
  const [total, rows] = await Promise.all([
    Message.countDocuments(filter),
    Message.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
  ]);

  return {
    items: rows.map(publicLog),
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}
