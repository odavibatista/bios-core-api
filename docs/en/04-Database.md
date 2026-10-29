# 04. Database and initial load

🇧🇷 [Português](../04-Banco-de-Dados.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [03. API contract (OpenAPI and CORS)](03-API-Contract.md) · [05. Queues (BullMQ)](05-Queues.md) →

> Prisma on top of MongoDB, retention through TTL indexes and loading the catalogs into a new database.

**On this page**

- [Database (Prisma)](#database-prisma)
- [Data retention (TTL indexes)](#data-retention-ttl-indexes)
- [Source catalog: loading and synchronization](#source-catalog-loading-and-synchronization)
- [Initial load of a new database and first administrator (#329)](#initial-load-of-a-new-database-and-first-administrator-329)

## Database (Prisma)

The schema spans multiple files, spread across the modules:

- `src/shared/infra/database/schema.prisma` — only `generator` and `datasource`;
- `src/modules/<module>/entity/*.prisma` — the module's models, composite types and enums.

`prisma.config.ts` points the schema root to `src/`, and Prisma gathers every `.prisma` file
recursively. To create an entity, add the file to the `entity/` folder of the owning module and run
`npm run prisma:generate` (and `npm run db:push` to create indexes).

Conventions: primary key `id_<entity>` (ObjectId in `_id`), foreign key `<entity>_id`, snake_case
fields, plural collections with `@@map` and indexes named `idx_<collection>_<fields>`. Companies are
referenced by the natural key `cnpj`, without a Prisma relation, because evidence can exist before the
registration profile.

MongoDB has to run as a **replica set** (`docker-compose.yml` already sets it up): Prisma uses
transactions for the emulated referential actions, such as the cascade when an account is deleted.

## Data retention (TTL indexes)

Tokens, sessions, blocks and logs are removed automatically by MongoDB after a period configurable by
environment variable:

| Variable | Collection | Counted from | Default |
| --- | --- | --- | --- |
| `DATA_RETENTION_USER_TOKENS` | `user_tokens` | `expires_at` | `7d` |
| `DATA_RETENTION_USER_SESSIONS` | `user_sessions` | `expires_at` | `30d` |
| `DATA_RETENTION_ACCESS_BLOCKS` | `access_blocks` | `blocked_until` (blocks with no end date never expire) | `90d` |
| `DATA_RETENTION_LOGIN_ATTEMPTS` | `login_attempts` | `attempted_at` | `90d` |
| `DATA_RETENTION_HONEYPOT_HITS` | `honeypot_hits` | `hit_at` | `180d` |
| `DATA_RETENTION_EMAIL_DISPATCH_LOGS` | `email_dispatch_logs` | `created_at` | `180d` |
| `DATA_RETENTION_DATA_SOURCE_REQUEST_LOGS` | `data_source_request_logs` | `requested_at` | `90d` |

Durations require a unit (`m`, `h`, `d`, `w`; minimum `1m`) and are validated at boot.

Since Prisma does not declare TTL indexes, each field above has a plain index in the schema of the
module that owns the collection (created by `db push`), and the API turns it into a TTL index on every
startup (`DataRetentionModule`):

- missing index → created already with TTL;
- plain index or TTL with another period → adjusted through `collMod`, without recreating it;
- index with the configured period → no operation.

The synchronization runs in the background and does not block boot; with the database unavailable, it
is postponed to the next startup. Disable it with `DATA_RETENTION_SYNC_ON_BOOT=false`. The rules live in
`src/shared/config/data-retention.config.ts`, and a test ensures that every index mentioned there exists
in the corresponding Prisma schema.

## Source catalog: loading and synchronization

The source seeder only **creates** what is missing: an empty `update`, on purpose, so that a new seed
never undoes adjustments made in production. The price is that a database created before a seed
adjustment (IBAMA's `base_url` and timeout, the GHG host) never receives it. The `catalog:sync` command
(#256) closes that gap **on demand and without surprises**:

```bash
npm run catalog:sync              # dry run: shows what would change; writes nothing
npm run catalog:sync -- --apply   # writes what the dry run showed
```

- **It never runs on its own.** It is not part of the API boot, the tests or any hook. The target
  database is the one in `DATABASE_URL`; the command prints only the database **name** (never the
  connection string) and, without `--apply`, writes nothing.
- **Diff before applying.** For each source: `CRIAR` (create), `ATUALIZAR` (update, field by field,
  `from -> to`) or `igual` (unchanged); sources that are in the database but unknown to the code are
  only listed.
- **What it synchronizes:** the source contract (`name`, `base_url`, `role`, `ingestion_mode`,
  `evidence_category`, `request_timeout_ms`, `cache_ttl_seconds`) and the creation of missing sources.
  **What it never changes:** what operations adjust (`is_enabled`, `rate_limit_per_minute`,
  `fallback_priority`); when the database differs from the seed in these fields, the dry run flags it
  with `(mantido)` (kept), and the difference remains a deliberate decision.
- **Prerequisite for creating sources:** the SDGs must exist (the command refuses, writing nothing, if
  they are missing). In a **new** database, the SDGs, the sources and the blocklist are loaded by
  `catalog:bootstrap` (section "Initial load of a new database and first administrator");
  `PrismaService.seed` still refuses outside `NODE_ENV=test` and `*_test` databases.
- **Idempotent:** running it again converges to the same state and, when in sync, reports
  "O catálogo já está em sincronia com o código" (the catalog is already in sync with the code).

**Runbook (existing database after updating the API):**

1. `npm run catalog:sync` and read the diff, especially the `(mantido)` lines;
2. if you agree, `npm run catalog:sync -- --apply`;
3. run `npm run catalog:sync` again: it should say it is already in sync;
4. for a value you want different from the seed, adjust it in the database and leave the seed as it
   is; diverging contract fields show up in the diff again on every run, on purpose.

## Initial load of a new database and first administrator (#329)

A new database has nothing: without an active SDG the calculation produces no index, without sources
no adapter queries anything, and without the blocklist RF22 (b) is not met. The seeders only run in the
tests, so there are two commands for production. Both follow the same pattern as `catalog:sync`:
**dry run by default**, `-- --apply` writes, nothing runs on API boot, they run outside Nest and they
never print the connection string.

```bash
npm run catalog:bootstrap              # shows what would be loaded
npm run catalog:bootstrap -- --apply   # loads SDGs, data sources and blocklist
npm run account:promote -- --email adm@example.com            # dry run
npm run account:promote -- --email adm@example.com --apply    # promotes to ADMIN
```

**`catalog:bootstrap`.** Runs the catalog seeders in dependency order (SDGs, sources, blocklist), the
same ones the tests use. It is **idempotent** and **only creates what is missing**: a source that
already exists is never changed (operational adjustments, such as `rate_limit_per_minute` and
`is_enabled`, prevail; to align the contract of an existing source, use `catalog:sync`), and a
blocklisted domain removed by the administrator is not recreated. The SDGs, with official title and
description, are reapplied. The summary shows, per catalog, how many items would be created and how
many already exist; it exits with `0` when everything is fine, `1` if something fails or items remain
to be loaded and `2` for an unknown option.

**`account:promote`.** Switches an account's role between `USER` and `ADMIN`: the administrator is the
same entity as a regular account, and promotion has no interface in the MVP (`11-Permissões.md`,
§11.3).

- **Finds the account by email** with the same blind index as login (`BLIND_INDEX_KEY`), normalized
  (case and spaces), so `  Adm@Example.COM ` finds the account. The environment is validated the way
  the API validates it; the key is never printed, and the command shows only the account's identifier
  and role, never the email or the name.
- **Ends the account's open sessions** (`revocation_reason = ROLE_CHANGE`), in the same transaction as
  the change. The role travels in the access token, and the token only expires within up to 15
  minutes: without this, a **demoted** administrator would remain an administrator until then, and a
  newly promoted one would not see the new role. With the revocation, the old token and the refresh
  token start returning `401`, and the next login already carries the right role.
- **Only promotes an account with a confirmed email** (`is_active`): an ADMIN with an unverified email
  would be privileged access without a proven owner.
- **`--demote`** turns an `ADMIN` back into `USER` and **refuses to demote the last active
  administrator**, so that blocklist management (RF29) is never left without someone to run it.
- An account that already has the requested role: nothing changes and the sessions stay as they are
  (exit `0`).

**New database runbook:** (1) `npm run docker:up` or the target MongoDB up, with `DATABASE_URL` pointing
to it; (2) `npm run db:push`; (3) `npm run catalog:bootstrap`, reading the summary, and then
`-- --apply`; (4) the person who will be the administrator signs up and confirms the email through the
API; (5) `npm run account:promote -- --email ...` and then `-- --apply`.

---

[Documentation index](README.md) · ← [03. API contract (OpenAPI and CORS)](03-API-Contract.md) · [05. Queues (BullMQ)](05-Queues.md) →
