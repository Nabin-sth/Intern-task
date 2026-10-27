import { env } from '../config/env.js';

export function getProviderDefinitions() {
  return env.providers;
}
