import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeRouteHealth } from '../src/services/routeHealth.service.js';

describe('computeRouteHealth', () => {
  it('returns a null success rate when there are no send attempts', () => {
    const result = computeRouteHealth({
      balance: 10000,
      successes: 0,
      sendAttempts: 0,
      healthyBalance: 10000,
    });

    assert.equal(result.successRate, null);
    assert.equal(result.successRatePercent, null);
    assert.equal(result.sample, 'no_send_attempts');
    assert.equal(result.healthPercent, 40);
  });

  it('does not treat zero attempts as a 0% success rate', () => {
    const empty = computeRouteHealth({
      balance: 0,
      successes: 0,
      sendAttempts: 0,
      healthyBalance: 10000,
    });
    const failed = computeRouteHealth({
      balance: 0,
      successes: 0,
      sendAttempts: 3,
      healthyBalance: 10000,
    });

    assert.equal(empty.successRate, null);
    assert.equal(failed.successRate, 0);
    assert.equal(failed.successRatePercent, 0);
    assert.equal(failed.sample, 'ok');
  });

  it('weights success rate 60% and balance 40%', () => {
    const result = computeRouteHealth({
      balance: 10000,
      successes: 2,
      sendAttempts: 3,
      healthyBalance: 10000,
    });

    assert.equal(result.successRate, 0.6667);
    assert.equal(result.successRatePercent, 67);
    assert.equal(result.healthPercent, 80);
  });
});
