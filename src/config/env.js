import dotenv from 'dotenv';

dotenv.config();

function optionalInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`${name} must be a number`);
  }

  return value;
}

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required. Copy .env.example to .env and set it.`);
  }

  return value.trim();
}

function optionalRate(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number.parseFloat(raw);
  if (Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }
  return value;
}

const defaultWalletCredits = optionalInt('DEFAULT_WALLET_CREDITS', 100);
if (defaultWalletCredits < 0) {
  throw new Error('DEFAULT_WALLET_CREDITS must be a non-negative integer');
}

const smsCostPerPart = optionalInt('SMS_COST_PER_PART', 1);
if (smsCostPerPart < 1) {
  throw new Error('SMS_COST_PER_PART must be a positive integer');
}

function providerDefinition(name, defaults) {
  const initialBalance = optionalInt(`${name}_INITIAL_BALANCE`, defaults.initialBalance);
  if (initialBalance < 0) {
    throw new Error(`${name}_INITIAL_BALANCE must be a non-negative integer`);
  }

  return {
    name,
    priority: optionalInt(`${name}_PRIORITY`, defaults.priority),
    failureRate: optionalRate(`${name}_FAILURE_RATE`, defaults.failureRate),
    initialBalance,
  };
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: optionalInt('PORT', 3000),
  isProduction: (process.env.NODE_ENV ?? 'development') === 'production',
  mongodbUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN?.trim() || '1d',
  bcryptRounds: optionalInt('BCRYPT_ROUNDS', 10),
  defaultWalletCredits,
  pendingReconcileMs: optionalInt('PENDING_RECONCILE_MS', 10 * 60 * 1000),
  smsCostPerPart,
  healthyProviderBalance: optionalInt('HEALTHY_PROVIDER_BALANCE', 10000),
  providers: [
    providerDefinition('ROUTE_A', { priority: 1, failureRate: 0.3, initialBalance: 10000 }),
    providerDefinition('ROUTE_B', { priority: 2, failureRate: 0.1, initialBalance: 10000 }),
    providerDefinition('ROUTE_C', { priority: 3, failureRate: 0.05, initialBalance: 10000 }),
  ],
};
