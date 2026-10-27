export function buildProviderUpsert(definition) {
  return {
    filter: { name: definition.name },
    update: {
      $setOnInsert: {
        name: definition.name,
        balance: definition.initialBalance,
      },
      $set: {
        priority: definition.priority,
        failureRate: definition.failureRate,
        isActive: true,
      },
    },
    options: { upsert: true },
  };
}
