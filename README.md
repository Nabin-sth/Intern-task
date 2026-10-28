# Mini SMS Gateway

REST API for Nest SMS (backend intern **Part A**): accept SMS requests, charge wallet credits, send through mock providers, fail over, and refund. Part B (queues, rate limits, webhooks, Docker) is **not** implemented.

Providers are seeded on process start (`ensureProviders`). Balances are set only on first insert.

## Requirements

- Node.js 18 or newer
- **MongoDB replica set** (Atlas or local). Transactions will not run on a standalone `mongod`.

## Setup

```bash
npm install
copy .env.example .env
```

On macOS/Linux: `cp .env.example .env`.

Set `MONGODB_URI` (replica set) and `JWT_SECRET` (long random string; never commit the real value).

```bash
npm start
```

```bash
npm test
npm run check
npm run dev
```

`npm run check` only parses JavaScript. `npm test` needs a reachable replica set for wallet, send, logs, and health tests.

Import `postman/Mini-SMS-Gateway.postman_collection.json` into Postman. Set `baseUrl` (default `http://localhost:3000`). Register or login stores `jwt`.

## MongoDB replica set

**Atlas:** a cluster is already a replica set. Use `mongodb+srv://.../mini-sms-gateway`.

**Local example:**

```bash
mongod --replSet rs0 --port 27017 --dbpath ./data/rs0
```

```javascript
rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] })
```

```
MONGODB_URI=mongodb://127.0.0.1:27017/mini-sms-gateway?replicaSet=rs0
```

Do **not** hold a MongoDB transaction open during mock provider calls.

## Endpoints

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| GET | `/health` | no | Process + Mongo readyState |
| POST | `/auth/register` | no | Creates user + wallet (`DEFAULT_WALLET_CREDITS`) |
| POST | `/auth/login` | no | |
| GET | `/auth/me` | JWT | |
| POST | `/sms/send` | JWT | Body `{ "to": string[], "message": string }` |
| GET | `/sms/logs` | JWT | Pagination + filters |
| GET | `/routes/health` | no | Per-route balance, 24h rate, health % |

All JSON: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "message": "..." } }`. Password hashes and JWT secrets are never returned. Stack traces are omitted when `NODE_ENV=production`.

### Auth sample

```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"secret123"}'
```

### Send sample

```bash
curl -s -X POST http://localhost:3000/sms/send \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"to":["9841234567","+9779801122334"],"message":"hello"}'
```

### Logs sample

```bash
curl -s "http://localhost:3000/sms/logs?status=sent&page=1&limit=20&phone=%2B9779841234567" \
  -H "Authorization: Bearer <jwt>"
```

Query: `page` (default 1), `limit` (default 20, max 100), `status` (`pendingsentfailed`), `from` / `to` (ISO, inclusive `createdAt`), `phone` (normalised). Newest first. Only the caller’s messages.

### Route health sample

```bash
curl -s http://localhost:3000/routes/health
```

## Phone numbers

Valid Nepali mobile: **10 digits starting with 97 or 98**. Optional `+977` or `977` prefix is stripped to 10 digits.

| Input | Result |
| ----- | ------ |
| `9841234567` | `9841234567` |
| `+9779801122334` | `9801122334` |
| `9779761234567` | `9761234567` |
| `9612345678` | rejected |
| `984123456` | rejected |

Invalid numbers on send: **400**, request rejected as a whole, **no charge**.

## SMS segmentation

| Encoding | When | 1 SMS | Concatenated |
| -------- | ---- | ----- | ------------ |
| GSM-7 | Only GSM-7 characters | 160 septets | 153 per part |
| Unicode | Any other character (Nepali, emoji, …) | 70 chars | 67 per part |

One Unicode character (including an emoji) makes the **whole** message Unicode.

GSM-7 extension-table characters `{ } [ ] \ ~ | ^ €` count as **two septets**.

PDF examples: 200 English characters → 2 parts (153+47). 100 Nepali characters → 2 parts (67+33).

## Cost calculation

```
parts            = segmentation of `message` (same for every recipient)
costPerRecipient = parts × SMS_COST_PER_PART
totalCost        = costPerRecipient × unique normalised recipients
```

Default `SMS_COST_PER_PART` is `1`. Example: 200 English characters (2 parts) to two numbers → `totalCost = 4`. The full amount is reserved **before** any provider is called.

## Mock providers

| Name | Priority | Default fail rate | Initial balance (first insert only) |
| ---- | -------- | ----------------- | ----------------------------------- |
| ROUTE_A | 1 | 30% | 10000 |
| ROUTE_B | 2 | 10% | 10000 |
| ROUTE_C | 3 | 5% | 10000 |

Each has `getBalance()` and a simulated `send()`. Startup upsert: `$setOnInsert.balance` so **restarts do not reset** spent provider balance. A successful mock send decrements **provider** balance (not the user wallet) by `parts`. Routes with `balance < parts` are skipped (`insufficient_balance`), then the next priority is tried.

## Wallet, failover, refunds

Integer credits only. Debit:

```
findOneAndUpdate({ credits: { $gte: totalCost } }, { $inc: { credits: -totalCost } })
```

inside a short transaction, then insert `pending` messages (`charged: true`). Parallel requests cannot drive the wallet negative. Twenty equivalent cost-1 reservations against 10 credits: **exactly 10 succeed**.

Send flow:

1. Validate JWT/body; normalise phones.
2. Compute `totalCost`; reserve in a short transaction.
3. Per recipient, try providers by priority **outside** any session.
4. Short transaction: settle (`sent`) or refund once (`failed`).

| State | Meaning |
| ----- | ------- |
| `pending`, charged, not refunded | Credits held |
| `sent`, charged, not refunded | Delivered; credits stay deducted |
| `failed`, charged, refunded | All routes failed or abandoned; credits returned **once** |

## Crash recovery

On startup, `reconcileStaleReservations` refunds `pending`+`charged` rows older than `PENDING_RECONCILE_MS` (default 10 minutes). Sends are **not** retried (retry could double-deliver).

**Limitation:** if the process dies after a provider accepted the SMS but before `settleMessage`, a later reconcile may refund a delivered message. That is preferred over locking credits forever.

## Route health formula

Counts come from persisted `message.providerAttempts` in the last **24 hours**.

- A **send attempt** excludes `error=insufficient_balance` (skip, not a failed send).
- `successRate = successes / sendAttempts`. If `sendAttempts` is 0, `successRate` is `null` (not `0%`). `sample` is `no_send_attempts`.

```
balanceFactor = min(1, providerBalance / HEALTHY_PROVIDER_BALANCE)

if sendAttempts == 0:
  healthPercent = round(100 * 0.4 * balanceFactor)
else:
  healthPercent = round(100 * (0.6 * successRate + 0.4 * balanceFactor))
```

Default `HEALTHY_PROVIDER_BALANCE` is `10000`. Zero attempts never look like a 100% send rate.

## Environment

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | `production` hides stacks |
| `MONGODB_URI` | required | Replica-set URI |
| `JWT_SECRET` | required | Token signing key |
| `JWT_EXPIRES_IN` | `1d` | Token lifetime |
| `BCRYPT_ROUNDS` | `10` | Password hash cost |
| `DEFAULT_WALLET_CREDITS` | `100` | New-user credits |
| `SMS_COST_PER_PART` | `1` | Credits per SMS part |
| `HEALTHY_PROVIDER_BALANCE` | `10000` | 100% balance term |
| `PENDING_RECONCILE_MS` | `600000` | Stale-hold refund |
| `ROUTE_*_FAILURE_RATE` | 0.3 / 0.1 / 0.05 | Mock fail probability |
| `ROUTE_*_INITIAL_BALANCE` | `10000` | First insert only |
| `ROUTE_*_PRIORITY` | 1 / 2 / 3 | Lower is tried first |

## Data models

| Collection | Purpose |
| ---------- | ------- |
| `users` | Email + `passwordHash` (`select: false`) |
| `wallets` | One per user; integer `credits` |
| `providers` | Mock routes; persistent `balance` |
| `messages` | Per-recipient log + `providerAttempts` |

## Known limitations

- Mock providers, not real SMS networks.
- No Part B: no Redis/BullMQ, rate limiting, DLR webhooks, or Docker.
- Random provider failures in live traffic unless tests force outcomes.
- Startup reconcile can refund an SMS that was already accepted if settle never ran.
- `GET /routes/health` is unauthenticated (read-only operational stats).
- No GitHub remote or demo recording is included in this repo by default.

## License

UNLICENSED — intern take-home assignment.
