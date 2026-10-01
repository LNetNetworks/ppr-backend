# PPR Backend

NestJS API for PPR (Pay-for-Results Program): projects advance through phases, verified
evidence releases funds to the provider, and every movement of money is anchored
on chain and audited.


## Technology Stack

| Layer | Technology | Role |
|-------|------------|------|
| Framework | **NestJS 11** | Modular server with pipes, guards, interceptors and dependency injection. |
| Language | **TypeScript 5** | Strict typing for domain models and DTOs. |
| Database | **MongoDB** via **Mongoose 8** | Schemas, repositories and a sequence service for deterministic identifiers. |
| Auth | **Keycloak 26** (`nest-keycloak-connect`) | OAuth2/OIDC with guards for authentication and roles. |
| API docs | **Swagger (OpenAPI) 11** | REST contract generated from the code, served under `/docs`. |
| Blockchain | **ethers 6 + LNET** | Anchors evidence and transactions; supports relayed transactions through a trusted forwarder. |
| Queue | **`@nestjs/schedule`** | Cron-driven worker that processes deferred transfers. |
| Mail | **Resend** | Outgoing notifications. |
| Observability | **Prometheus** (`@willsoto/nestjs-prometheus`) | Metrics exposed under `/metrics`. |

## Architecture

Hexagonal architecture — ports and adapters — organised in three layers, with
dependencies pointing inwards:

```
  domain            entities, business rules, and the ports: abstract
                    classes that declare what the core needs. No NestJS,
                    Mongoose or ethers imports.
       ^
  application       use cases. Depends on ports, never on a concrete
                    implementation.
       ^
  infrastructure    the adapters: controllers that drive the core, and
                    Mongoose repositories, auth and integrations that the
                    core drives through its ports.
```

A port is an abstract class; the adapter extends it and is wired in by the
module. `UserRepository` lives in `domain` and `UserMongooseRepository`
implements it in `infrastructure`, so swapping the database means writing
another adapter and changing one provider, with no use case touched.

Rules the codebase holds to:

- A controller never touches Mongoose directly.
- Every route that mutates data declares its transaction type, so
  `TransactionAuditInterceptor` records it in the `transactions` collection.
- Deterministic identifiers come from the sequence service, never ad hoc.
- Every environment variable is declared in the validation schema and read
  through its configuration namespace, never by its raw name.
- External integrations live behind their own service, never raw HTTP from a
  use case.

## Domain Modules

```
  asset-token        contributions      organizations      phases
  audit-revisions    evidences          permissions        projects
  revisions          shared             tasks              transactions
  users
```

## Integrations

| Integration | What it is used for |
|---|---|
| **Keycloak** | Authenticates every request and provides the role. `POST /users/sync` reconciles the local user with the token on each login. |
| **LNET / prividium** (ethers) | Anchors evidence and transactions, and runs the synchronous TOKEN transfer path. Supports gas sponsorship through a trusted forwarder. |
| **Bridge** | Executes the deferred USDC transfer path. It offers no idempotency key, which is why a failed transfer is never retried automatically. |
| **POK** | Third-party credential service: titles are imported and queued for synchronisation. |
| **File storage** | Stores the files backing each piece of evidence. |
| **Resend** | Sends phase-review and project-membership notifications. |

## Prerequisites

| | |
|---|---|
| **Node.js** | 22.x — the Docker image pins `22.17.0` |
| **npm** | ships with Node; `package-lock.json` is the committed lockfile |
| **MongoDB** | 7 or later, reachable from the application |
| **Keycloak** | a realm with a confidential client and the four application roles |

The blockchain, bridge, POK, file storage and mail integrations need reachable
endpoints and credentials. There is no offline mode: the application refuses to
start if a required variable is missing.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the environment

```bash
cp .env.example .env
```

`.env.example` is the template: it documents the shape of every value and holds
no real ones. Variables that are commented out have a default in the validation
schema — uncomment only to override. Every other variable is required and the
application does not start without it. See
[Environment Variables](#environment-variables).

### 3. Run the application

```bash
npm run start:dev     # watch mode
npm run start:prod    # from dist/, after npm run build
```

### 4. Access the API

```
  http://localhost:3000/ppr        base URL, under GLOBAL_PREFIX
  http://localhost:3000/ppr/docs   Swagger
  http://localhost:3000/ppr/health health check
  http://localhost:3000/ppr/metrics Prometheus, behind METRICS_TOKEN
```

## Environment Variables

Register these before starting, for example in a `.env` file loaded by
`@nestjs/config`.

| Variable                    | Description                                | Example |
|----------                   |-------------                               |---------|
| `NODE_ENV`                  | Runtime environment mode                   | `development` |
| `PORT`                      | HTTP port. Defaults to `3000`              | `3000` |
| `GLOBAL_PREFIX`             | API prefix applied to every route. Defaults to `ppr` | `ppr` |
| `CORS_ORIGINS`              | Comma-separated browser origins allowed by CORS. No limit on how many; each entry must be scheme + host (+ optional port), with no trailing slash or path | `https://app.example.com,http://localhost:5173` |
| `MONGODB_URI`               | Connection string to MongoDB               | `mongodb://user:pass@host:27017/ppr` |
| `MONGODB_DB`                | Database name                              | `ppr` |
| `KEYCLOAK_AUTH_SERVER_URL`  | Base URL of Keycloak server                | `https://auth.example.com` |
| `KEYCLOAK_REALM`            | Keycloak realm                             | `ppr-realm` |
| `KEYCLOAK_CLIENT_ID`        | Confidential client ID                     | `ppr-api-client` |
| `KEYCLOAK_SECRET`           | Client secret                              | (opaque secret) |
| `KEYCLOAK_REALM_PUBLIC_KEY` | Realm RSA public key                       | `MIIBIjANBgkq...` |
| `KEYCLOAK_LOG_LEVEL`        | Level filters for Keycloak logs. Defaults to `warn,debug` | `warn,debug` |
| `ZK_KEYCLOAK_TOKEN_URL`     | Keycloak token URL for Zero-Knowledge flows | `https://zk-auth.example.com/protocol/openid-connect/token` |
| `ZK_PERMISSION_SERVICE_URL` | Prividium permission service that exchanges the Keycloak id_token for a network token. Optional: only the prividium path uses it | `https://permissions.example.com/token` |
| `ZK_RPC_NODE_URL`           | RPC endpoint for ZK network                | `https://zk-node.example.com` |
| `ZK_USER_PRIVATE_KEY`       | Wallet private key for ZK user             | `0xabc123...` |
| `ZK_KEYCLOAK_CLIENT_ID`     | ZK Keycloak client                         | `ppr-zk-client` |
| `ZK_KEYCLOAK_CLIENT_SECRET` | Secret for ZK client                       | (opaque secret) |
| `ZK_KEYCLOAK_USERNAME`      | Service account username                   | `batch-sync` |
| `ZK_KEYCLOAK_PASSWORD`      | Service account password                   | (opaque secret) |
| `ZK_TOKEN_REFRESH_MARGIN_MS` | Milliseconds of remaining life below which the cached prividium token is replaced instead of reused. Defaults to `30000` | `30000` |
| `TRUSTED_FORWARDER`         | Gas relayer address. Required: no default  | `0x...` |
| `RPC_URL`                   | Public RPC URL for blockchain interactions | `https://rpc.example.com` |
| `BLOCKCHAIN_NETWORK`        | Name of the blockchain network             | `prividium` |
| `PRIVATE_KEY`               | Wallet used for signing transactions       | `0x0123...` |
| `GAS_NODE_ADDRESS`          | Optional gas sponsor address               | `0xfeedface...` |
| `GAS_EXPIRATION`            | Expiration window in **milliseconds** for sponsored gas. Defaults to `300000` (5 minutes) | `300000` |
| `ADDRESS_CONTRACT`          | Deployed smart contract address            | `0xabcdef...` |
| `ADDRESS_TOKEN`             | Deployed token contract address            | `0xabcdef...` |
| `ADDRESS_TOKEN_USDC`        | USDC token contract address used in payouts | `0xabcdef...` |
| `ADDRESS_GAS_PRIVIDIUM`     | Prividium native gas token contract address. Same across the platform | `0x000000000000000000000000000000000000800A` |
| `GSPONSOR_SEED`             | BIP-39 mnemonic the in-app signer derives every project and sponsor wallet from. Validated at startup, checksum included | (12- or 24-word mnemonic) |
| `GSPONSOR_TRANSFER_CONTRACT` | Contract used for sponsored transfers     | `0xabcdef...` |
| `WALLET_DERIVATION_NAMESPACE` | Namespace used to derive project wallets by environment | `dev` |
| `FILE_STORE_API_URL`        | Endpoint for file storage service          | `https://filestore.example.com/api` |
| `FILE_STORE_API_KEY`        | API key for file storage                   | (opaque key) |
| `FILE_STORE_TIMEOUT_MS`     | Upload request timeout in milliseconds. Defaults to `60000` | `60000` |
| `HTTP_CLIENT_TIMEOUT_MS`    | Global timeout in milliseconds for the shared HTTP client used by external integrations. Defaults to `10000` | `10000` |
| `POK_API_URL`               | Endpoint for POK integration               | `https://pok.example.com/api` |
| `POK_APIKEY`                | High-privilege API key                     | (opaque key) |
| `BRIDGE_API_URL`            | Endpoint for the bridge integration        | `https://bridge.example.com/api` |
| `BRIDGE_API_KEY`            | API key for the bridge integration         | (opaque key) |
| `BRIDGE_TIMEOUT_MS`         | Bridge request timeout in milliseconds. Defaults to `60000` | `60000` |
| `RESEND_API_KEY`            | API key for the Resend mail provider       | (opaque key) |
| `MAIL_FROM`                 | Sender address used on outgoing mail       | `noreply@example.com` |
| `SYNC_WORKER_ENABLED`       | Whether this instance processes the queue. Defaults to `true` | `true` |
| `SYNC_TASK_BATCH_SIZE`      | Tasks the worker claims per tick. Defaults to `3` | `3` |
| `SYNC_LOCK_SECONDS`         | Seconds a claimed task stays reserved for its worker. Defaults to `120` | `120` |
| `SYNC_TASK_CONCURRENCY`     | Tasks processed in parallel within a batch. Defaults to `1` | `1` |
| `SYNC_MAX_ATTEMPTS`         | Attempts a retryable task gets before it is recorded as failed. Defaults to `3` | `3` |
| `SYNC_RETRY_BACKOFF_SECONDS` | Comma-separated waits, in seconds, applied between retries. Defaults to `30,120` | `30,120` |
| `NEST_LOG_LEVEL`            | Comma-separated Nest log levels. Defaults to `log,error,warn` | `log,error,warn` |
| `METRICS_TOKEN`             | Token used to secure Prometheus metrics    | (16+ characters) |

### Queue worker parameters

The `SYNC_*` variables all have defaults, so an installation that sets none of
them behaves exactly as before they existed.

**`SYNC_LOCK_SECONDS` must be greater than `BRIDGE_TIMEOUT_MS`.** When a worker
claims a task it reserves it for that many seconds; if the lock expires and the
worker never came back, the task is treated as abandoned and closed as failed —
it is never re-executed, because the bridge offers no idempotency key and
repeating a transfer would move funds twice. So a lock shorter than the longest
possible bridge call would close as failed a transfer that is still in flight.
The application checks this relationship at startup and refuses to boot if it
does not hold; the schema also enforces a minimum of `61` seconds, which covers
the default bridge timeout of `60000` ms.

**`SYNC_WORKER_ENABLED` defaults to `true`.** Set it to `false` on instances
that should serve the API without processing the queue — the cron runs in every
replica, and while the lock keeps that correct, only one of them does useful
work. Disabling it everywhere stops the queue silently: tasks stay pending and
no transfer is emitted, which is why the default is on rather than off.

**The retry policy is `SYNC_MAX_ATTEMPTS` plus `SYNC_RETRY_BACKOFF_SECONDS`, and
they are read together.** In the backoff list, the position is the attempt
number: with the default `30,120` a task that fails once waits 30 seconds before
it can be claimed again, one that fails twice waits 120, and from the third
failure on it waits nothing. An attempt with no declared value does not wait —
the list does not have to be as long as `SYNC_MAX_ATTEMPTS`, and a longer list
simply has its tail ignored. Once a task reaches `SYNC_MAX_ATTEMPTS` it is
recorded as failed with the last error and is not claimed again.

This policy governs only the tasks the system may retry. A task that moves funds
through the bridge is recorded as failed on its first failure regardless of what
the policy declares, because the bridge offers no idempotency key and repeating
a transfer would move the money twice.

`SYNC_TASK_BATCH_SIZE` and `SYNC_TASK_CONCURRENCY` are throughput knobs with no
correctness constraint beyond being at least `1`.

## API Endpoints

The REST contract is generated from the code and served by Swagger:

```
  http://localhost:3000/ppr/docs           Swagger UI
  http://localhost:3000/ppr/openapi.json   the same contract as JSON
```

The JSON is what a client generator consumes.

That page is the reference: it lists every route with its parameters, its body,
its responses and the roles it requires. This README does not duplicate it,
because a hand-written copy drifts from the code.

A snapshot of the surface, useful for reviewing it without starting the
application, lives in [docs/API_SURFACE.md](docs/API_SURFACE.md).

## Docker

```bash
docker build -t ppr-backend .
docker run -p 3000:3000 --env-file .env ppr-backend
```

`docker compose up` starts MongoDB and the API together. The API takes the rest
of its configuration from your local `.env` and reaches the database through the
compose network rather than `localhost`. The host port comes from `PORT`,
defaulting to `3000`.

```bash
docker compose up --build
```

## Scripts

| Script | What it does |
|---|---|
| `npm run start` | Starts the application |
| `npm run start:dev` | Starts in watch mode |
| `npm run start:debug` | Watch mode with the inspector attached |
| `npm run start:prod` | Runs the compiled build from `dist/` |
| `npm run build` | Compiles to `dist/` |
| `npm run lint` | ESLint over `src`, `apps`, `libs` and `test`, **with `--fix`** |
| `npm run format` | Prettier over `src` and `test` |
| `npm run test` | Jest |
| `npm run test:watch` | Jest in watch mode |
| `npm run test:debug` | Jest with the inspector attached |
| `npm run test:cov` | Jest with coverage |
| `npm run test:e2e` | End-to-end suite |
| `npm run seed:project-wallets` | Aligns the project wallet counter, from `dist/` |
| `npm run seed:project-wallets:local` | The same, through `ts-node`, for local development |

### Project wallet seeding

`WALLET_DERIVATION_NAMESPACE` must be a short environment value, not a full
command. Each namespace maps to a fixed numeric derivation index:

| Namespace | Derivation index |
|-----------|------------------|
| `local`   | `1` |
| `dev`     | `1` |
| `stage`   | `2` |
| `prod`    | `3` |
| `production` | `3` |

Any non-negative integer is also accepted and used as the index directly.

| Environment | `WALLET_DERIVATION_NAMESPACE` | Seed command |
|-------------|-------------------------------|--------------|
| Local       | `local`                       | `npm run seed:project-wallets:local` |
| Dev         | `dev`                         | `WALLET_DERIVATION_NAMESPACE=dev npm run seed:project-wallets` |
| Stage       | `stage`                       | `WALLET_DERIVATION_NAMESPACE=stage npm run seed:project-wallets` |
| Prod        | `prod`                        | `WALLET_DERIVATION_NAMESPACE=prod npm run seed:project-wallets` |

Run it once per environment after deployment, or after restoring a database, so
the `project_wallets` counter matches the highest historical wallet index
already stored in `projects`.

## User Roles

The application recognises four roles, and Keycloak is the authority on which
one a person has:

```
  verifier    sponsor    provider    user
```

**A person has exactly one role.** Whoever needs two uses two Keycloak users,
one per role. A token carrying none, or more than one, is rejected with `403`
when synchronising.

The role travels in the token and is refreshed on every synchronisation: what
Keycloak says prevails over what is stored. Changing a role in Keycloak reaches
the database on the person's next login.

## Production Notes

- **CORS**: the allowed origins come from `CORS_ORIGINS`. Adding one is an
  environment change, not a code change.
- **Observability**: metrics under `/metrics`, protected by `METRICS_TOKEN`.
  Log levels are governed by `NEST_LOG_LEVEL`.
- **Audit trail**: every route that mutates data attaches a transaction type to
  the request, so the operation is stored in the `transactions` collection with
  a deterministic identifier.
- **Queue**: the worker runs in every replica. Set `SYNC_WORKER_ENABLED=false`
  on the ones that should only serve the API.

## Technical Debt

**Missing Back Office**

The platform currently has no administration Back Office. That module is where
organizations, along with their own configuration, and the catalogs of phases
(stages) and tasks should be created. The platform would then only select them
and add them to each project.

Since it does not exist, these functions are handled through the same endpoints
as the operational platform, without an administrator role to control them. As a
temporary solution, part of the configuration, such as the blockchain network,
contracts, tokens and external integrations, was moved to environment variables.
That configuration is global to the whole instance rather than per organization,
and any change requires technical intervention and a new deployment.

The proposal is to build the Back Office with an administrator role and move the
per-organization configuration to the database. Environment variables would then
hold only infrastructure settings and secrets.
