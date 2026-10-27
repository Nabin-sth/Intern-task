import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemoryProviderStore } from '../src/providers/InMemoryProviderStore.js';
import { MockSmsProvider } from '../src/providers/MockSmsProvider.js';
import { buildProviderUpsert } from '../src/providers/upsert.js';

function makeProvider(overrides = {}) {
  const store = overrides.store ?? new InMemoryProviderStore({ ROUTE_A: 100 });
  const provider = new MockSmsProvider({
    name: 'ROUTE_A',
    priority: 1,
    failureRate: 0.3,
    store,
    rng: overrides.rng ?? (() => 1),
  });
  return { provider, store };
}

describe('buildProviderUpsert', () => {
  it('sets balance only on insert so restarts do not reset it', () => {
    const upsert = buildProviderUpsert({
      name: 'ROUTE_A',
      priority: 1,
      failureRate: 0.3,
      initialBalance: 10000,
    });

    assert.equal(upsert.filter.name, 'ROUTE_A');
    assert.equal(upsert.update.$setOnInsert.balance, 10000);
    assert.equal(Object.hasOwn(upsert.update.$set, 'balance'), false);
    assert.equal(upsert.update.$set.priority, 1);
    assert.equal(upsert.update.$set.failureRate, 0.3);
    assert.equal(upsert.options.upsert, true);
  });
});

describe('MockSmsProvider', () => {
  it('exposes unique name, priority, failure rate, and getBalance()', async () => {
    const { provider } = makeProvider();
    assert.equal(provider.name, 'ROUTE_A');
    assert.equal(provider.priority, 1);
    assert.equal(provider.failureRate, 0.3);
    assert.equal(await provider.getBalance(), 100);
  });

  it('succeeds when forceResult is success and decrements provider balance by parts', async () => {
    const { provider } = makeProvider();
    const result = await provider.send(
      { to: '9841234567', body: 'hi', parts: 2 },
      { forceResult: 'success' },
    );

    assert.equal(result.success, true);
    assert.equal(result.providerName, 'ROUTE_A');
    assert.equal(result.balance, 98);
    assert.equal(await provider.getBalance(), 98);
  });

  it('fails when forceResult is failure and does not change balance', async () => {
    const { provider } = makeProvider();
    const result = await provider.send(
      { to: '9841234567', body: 'hi', parts: 2 },
      { forceResult: false },
    );

    assert.equal(result.success, false);
    assert.equal(result.error, 'simulated_failure');
    assert.equal(await provider.getBalance(), 100);
  });

  it('honours setForcedOutcome for repeatable tests', async () => {
    const { provider } = makeProvider();
    provider.setForcedOutcome('failure');
    const failed = await provider.send({ to: '9841234567', body: 'hi', parts: 1 });
    assert.equal(failed.success, false);

    provider.setForcedOutcome('success');
    const sent = await provider.send({ to: '9841234567', body: 'hi', parts: 1 });
    assert.equal(sent.success, true);
    assert.equal(await provider.getBalance(), 99);

    provider.clearForcedOutcome();
  });

  it('skips charging the provider when balance is too low', async () => {
    const store = new InMemoryProviderStore({ ROUTE_A: 1 });
    const { provider } = makeProvider({ store });
    const result = await provider.send(
      { to: '9841234567', body: 'hi', parts: 2 },
      { forceResult: 'success' },
    );

    assert.equal(result.success, false);
    assert.equal(result.error, 'insufficient_balance');
    assert.equal(await provider.getBalance(), 1);
  });

  it('uses failureRate with rng when no forceResult is set', async () => {
    const failing = makeProvider({ rng: () => 0.29 });
    const failed = await failing.provider.send({ to: '9841234567', body: 'hi', parts: 1 });
    assert.equal(failed.success, false);
    assert.equal(await failing.provider.getBalance(), 100);

    const passing = makeProvider({ rng: () => 0.3 });
    const sent = await passing.provider.send({ to: '9841234567', body: 'hi', parts: 1 });
    assert.equal(sent.success, true);
    assert.equal(await passing.provider.getBalance(), 99);
  });
});
