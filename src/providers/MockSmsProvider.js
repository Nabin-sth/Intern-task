function resolveForcedOutcome(forceResult) {
  if (forceResult === true || forceResult === 'success') {
    return true;
  }
  if (forceResult === false || forceResult === 'failure') {
    return false;
  }
  return null;
}

export class MockSmsProvider {
  /**
   * @param {object} options
   * @param {string} options.name
   * @param {number} options.priority lower number is tried first
   * @param {number} options.failureRate probability 0–1 when not forced
   * @param {{ getBalance: Function, tryDebit: Function }} options.store
   * @param {() => number} [options.rng] returns 0–1; used when outcome is random
   */
  constructor({ name, priority, failureRate, store, rng = Math.random }) {
    this.name = name;
    this.priority = priority;
    this.failureRate = failureRate;
    this.store = store;
    this.rng = rng;
    this.forcedOutcome = null;
    this.phoneOutcomes = new Map();
  }

  setForcedOutcome(outcome) {
    this.forcedOutcome = outcome;
  }

  setForcedOutcomeForPhone(phone, outcome) {
    this.phoneOutcomes.set(phone, outcome);
  }

  clearForcedOutcome() {
    this.forcedOutcome = null;
    this.phoneOutcomes.clear();
  }

  async getBalance() {
    return this.store.getBalance(this.name);
  }

  /**
   * Simulated send. Does not touch user wallets.
   * @param {{ to: string, body: string, parts?: number }} payload
   * @param {{ forceResult?: boolean|'success'|'failure', delayMs?: number }} [options]
   */
  async send(payload, options = {}) {
    const parts = payload?.parts ?? 1;
    if (!Number.isInteger(parts) || parts < 1) {
      throw new Error('parts must be a positive integer');
    }

    if (options.delayMs) {
      await new Promise((resolve) => {
        setTimeout(resolve, options.delayMs);
      });
    }

    const balance = await this.getBalance();
    if (balance < parts) {
      return {
        success: false,
        providerName: this.name,
        error: 'insufficient_balance',
        balance,
      };
    }

    const forced = resolveForcedOutcome(
      options.forceResult ?? this.phoneOutcomes.get(payload.to) ?? this.forcedOutcome,
    );
    const succeeds = forced === null ? this.rng() >= this.failureRate : forced;

    if (!succeeds) {
      return {
        success: false,
        providerName: this.name,
        error: 'simulated_failure',
        balance,
      };
    }

    const remaining = await this.store.tryDebit(this.name, parts);
    if (remaining === null) {
      const latest = await this.getBalance();
      return {
        success: false,
        providerName: this.name,
        error: 'insufficient_balance',
        balance: latest,
      };
    }

    return {
      success: true,
      providerName: this.name,
      balance: remaining,
    };
  }
}
