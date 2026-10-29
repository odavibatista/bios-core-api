# 01. Getting started

🇧🇷 [Português](../01-Como-Rodar.md) · 🇺🇸 **English**

[Documentation index](README.md) · [02. Architecture and conventions](02-Architecture.md) →

> Prerequisites, first steps and project scripts.

## Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | ≥ 22.22.3 |
| npm | ≥ 11 |
| Docker with Compose | Runs MongoDB 8 (replica set) and Redis 7 from `docker-compose.yml` |

The `.env` needs an SMTP server (the API does not start without one: sign-up confirmation and password
recovery depend on sending email) and, for the CGU sanctions, the `CGU_API_KEY` token, which is optional.
Every variable is commented in `.env.example`.

## How to run

```bash
npm install                 # installs dependencies and generates the Prisma Client
cp .env.example .env        # adjust the variables if needed
npm run keys:generate       # generates the encryption keys; paste them into .env
npm run docker:up           # MongoDB (replica set) and Redis
npm run db:push             # creates collections and indexes from the Prisma schema
npm run start:dev           # API at http://localhost:3000
```

| Address | Content |
| --- | --- |
| `GET /health` | Status of the API, the database and Redis |
| `/docs` | Interactive API reference (Scalar) |
| `/docs/openapi.json` | OpenAPI document (named models, stable `operationId`; see [API contract](03-API-Contract.md)) |

## Scripts

| Script | Purpose |
| --- | --- |
| `start:dev` / `start:debug` / `start:prod` | Runs the API (watch / debug / compiled build) |
| `build` | Compiles to `dist/` |
| `lint` / `lint:check` | ESLint with and without automatic fixes |
| `format` / `format:check` | Prettier with and without rewriting |
| `typecheck` | Type checking without emitting files |
| `test` / `test:watch` / `test:cov` | Unit tests (with a 75% coverage threshold) |
| `test:e2e` | End-to-end tests (HTTP pipeline, real database and queues on Redis) |
| `verify` | Typecheck, tests with coverage and e2e: the full suite, the same as CI |
| `verify:push` | What runs on pre-push: typecheck, ESLint on the whole project and only the unit tests affected by the diff against `origin/develop` |
| `prisma:generate` / `prisma:validate` / `prisma:format` | Operations on the Prisma schema |
| `keys:generate` | Generates the `.env` encryption keys (`-- --version N` to rotate) |
| `db:push` | Syncs MongoDB collections and indexes with the schema |
| `catalog:sync` | Compares the source catalog in the database with the seed (dry run); `-- --apply` writes. See [Source catalog](04-Database.md#source-catalog-loading-and-synchronization) |
| `catalog:bootstrap` | Initial load of SDGs, sources and blocklist into a new database (dry run; `-- --apply` writes). See [Initial load](04-Database.md#initial-load-of-a-new-database-and-first-administrator-329) |
| `account:promote` | Promotes an account to `ADMIN` (`-- --email <email>`; `--demote` demotes; `--apply` writes) and ends its sessions |
| `docker:up` / `docker:down` | Starts/stops the local infrastructure |

---

[Documentation index](README.md) · [02. Architecture and conventions](02-Architecture.md) →
