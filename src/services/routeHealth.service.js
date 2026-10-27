import { env } from '../config/env.js';
import { Message } from '../models/Message.js';
import { Provider } from '../models/Provider.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SKIP_ERRORS = ['insufficient_balance'];

function roundRate(value) {
  return Math.round(value * 10000) / 10000;
}

function roundPercent(value) {
  return Math.round(value);
}

/**
 * Count send attempts from persisted `providerAttempts`.
 * `insufficient_balance` rows are eligibility skips, not send attempts.
 */
export function computeRouteHealth({
  balance,
  successes,
  sendAttempts,
  healthyBalance = env.healthyProviderBalance,
}) {
  const safeHealthy = healthyBalance > 0 ? healthyBalance : 1;
  const balanceFactor = Math.min(1, Math.max(0, balance / safeHealthy));

  if (sendAttempts === 0) {
    return {
      attempts: 0,
      successes: 0,
      successRate: null,
      successRatePercent: null,
      healthPercent: roundPercent(100 * 0.4 * balanceFactor),
      sample: 'no_send_attempts',
    };
  }

  const successRate = successes / sendAttempts;
  const health = 0.6 * successRate + 0.4 * balanceFactor;

  return {
    attempts: sendAttempts,
    successes,
    successRate: roundRate(successRate),
    successRatePercent: roundPercent(100 * successRate),
    healthPercent: roundPercent(100 * health),
    sample: 'ok',
  };
}

export async function getRouteHealth({ now = new Date() } = {}) {
  const since = new Date(now.getTime() - WINDOW_MS);
  const providers = await Provider.find({ isActive: true }).sort({ priority: 1, name: 1 });

  const grouped = await Message.aggregate([
    { $unwind: '$providerAttempts' },
    {
      $match: {
        'providerAttempts.attemptedAt': { $gte: since, $lte: now },
      },
    },
    {
      $match: {
        'providerAttempts.error': { $nin: SKIP_ERRORS },
      },
    },
    {
      $group: {
        _id: '$providerAttempts.providerName',
        attempts: { $sum: 1 },
        successes: {
          $sum: { $cond: [{ $eq: ['$providerAttempts.success', true] }, 1, 0] },
        },
      },
    },
  ]);

  const byName = new Map(grouped.map((row) => [row._id, row]));

  return {
    windowHours: 24,
    since,
    until: now,
    formula: {
      successRate: 'successes / sendAttempts over the last 24 hours, or null if sendAttempts is 0',
      sendAttempts: 'providerAttempts in the window excluding error=insufficient_balance (skipped for low provider balance)',
      healthPercent:
        'round(100 * (0.6 * successRate + 0.4 * min(1, balance / HEALTHY_PROVIDER_BALANCE))); if no send attempts, successRate is null and only the 40% balance term is used',
      healthyProviderBalance: env.healthyProviderBalance,
    },
    routes: providers.map((provider) => {
      const stats = byName.get(provider.name) ?? { attempts: 0, successes: 0 };
      const computed = computeRouteHealth({
        balance: provider.balance,
        successes: stats.successes,
        sendAttempts: stats.attempts,
      });

      return {
        name: provider.name,
        priority: provider.priority,
        balance: provider.balance,
        windowHours: 24,
        ...computed,
      };
    }),
  };
}
