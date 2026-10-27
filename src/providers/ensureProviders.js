import { Provider } from '../models/Provider.js';
import { getProviderDefinitions } from './config.js';
import { MockSmsProvider } from './MockSmsProvider.js';
import { MongoProviderStore } from './MongoProviderStore.js';
import { buildProviderUpsert } from './upsert.js';

let instances = [];

export async function ensureProviders() {
  const definitions = getProviderDefinitions();
  const store = new MongoProviderStore();

  for (const definition of definitions) {
    const { filter, update, options } = buildProviderUpsert(definition);
    await Provider.updateOne(filter, update, options);
  }

  instances = definitions
    .map(
      (definition) =>
        new MockSmsProvider({
          name: definition.name,
          priority: definition.priority,
          failureRate: definition.failureRate,
          store,
        }),
    )
    .sort((a, b) => a.priority - b.priority);

  const summary = instances
    .map((provider) => `${provider.name}(p${provider.priority})`)
    .join(', ');
  console.log(`Mock providers ready: ${summary}`);

  return instances;
}

export function getMockProviders() {
  return instances;
}
