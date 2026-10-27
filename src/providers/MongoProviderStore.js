import { Provider } from '../models/Provider.js';

export class MongoProviderStore {
  async getBalance(name) {
    const doc = await Provider.findOne({ name }).lean();
    return doc?.balance ?? 0;
  }

  async tryDebit(name, amount) {
    const doc = await Provider.findOneAndUpdate(
      { name, isActive: true, balance: { $gte: amount } },
      { $inc: { balance: -amount } },
      { new: true },
    );

    return doc ? doc.balance : null;
  }
}
