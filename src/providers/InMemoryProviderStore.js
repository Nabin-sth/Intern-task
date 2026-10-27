export class InMemoryProviderStore {
  constructor(balances = {}) {
    this.balances = { ...balances };
  }

  async getBalance(name) {
    return this.balances[name] ?? 0;
  }

  async tryDebit(name, amount) {
    const current = this.balances[name] ?? 0;
    if (current < amount) {
      return null;
    }

    this.balances[name] = current - amount;
    return this.balances[name];
  }
}
