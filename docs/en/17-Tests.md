# 17. Tests

🇧🇷 [Português](../17-Testes.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [16. API keys and public API](16-API-Keys.md) · [18. Quality and continuous integration](18-Quality-and-CI.md) →

> Coverage, parallel e2e tests and test data.

**On this page**

- [Coverage](#coverage)
- [E2E tests](#e2e-tests)
  - [Parallel e2e (#368)](#parallel-e2e-368)
- [Test data](#test-data)

Vitest, with a mock API equivalent to Jest's (`vi.fn`, `vi.spyOn`). Dependencies are replaced through the
Nest container with `Test.createTestingModule(...).overrideProvider()`, without mocking whole modules.
Mocks are cleared and restored automatically between tests. In the unit tests,
`test/setup/validation-messages.setup.ts` applies the Portuguese validation messages (#398), as the
application does: a schema tested in isolation produces the same text the API returns. In the e2e tests
the `SharedModule` itself applies them.

## Coverage

`npm run test:cov` measures the coverage of the code under `src/` and fails the run below 75% in lines,
functions, branches or statements (NFR NFPD03). The report goes to `coverage/`: `index.html` for
browsing, `coverage-summary.json` and `lcov.info` for tools. It is generated even when a test fails.

Left out of the measurement, by file name suffix (`COVERAGE_EXCLUDE` in `vitest.config.ts`):

| Suffix | Reason |
| --- | --- |
| `.spec.ts`, `main.ts` | The tests themselves and the application bootstrap |
| `seeder.ts` | Catalog seeders, exercised against the real database in the e2e tests |
| `config.ts` | Application configuration, validated at startup |
| `.exception.ts`, `.protocol.ts`, `.decorator.ts`, `.module.ts` | Declarations: domain exceptions, contracts, decorators and Nest modules |

The tests of these files still run; they are just not part of the threshold calculation.

## E2E tests

| Folder | Scope |
| --- | --- |
| `test/http/` | HTTP pipeline over the `AppModule`, with dependencies replaced through `overrideProvider` |
| `test/database/` | Full `AppModule` against a real, disposable MongoDB |
| `test/integration/` | Infrastructure modules against the real service (e.g. queues against Redis) |

The test infrastructure is set up and torn down by the global setup
(`test/setup/infrastructure.global-setup.ts`) on every run of `npm run test:e2e`:

1. syncs the collections and indexes of each worker's database with the Prisma schema
   (`prisma db push`, in parallel);
2. clears each worker's Redis database (`FLUSHDB`), so jobs from a previous run do not interfere with the
   next one;
3. creates each worker's temporary folder empty;
4. makes the infrastructure available to the suites, which prepare the database with
   `PrismaService.reset()` and `PrismaService.seed(seeders)`;
5. removes the databases (`dropDatabase`) and the folders at the end.

The base addresses are `bios_test` in MongoDB and database `1` in the Redis from `docker-compose.yml`;
others can be provided in `E2E_DATABASE_URL` and `E2E_REDIS_URL`. Each has disposal safeguards: `seed`
and `reset` only run with `NODE_ENV=test` **and** on a database with the `_test` suffix (otherwise they
throw `UnsafeDatabaseOperationException`); on Redis, the setup refuses database `0`, which is the
general-purpose one, and refuses to clear a database containing a key outside the project's prefixes
(`bios:`, `bull:`) — which protects against another Redis occupying port 6379 on the same machine.

A job still in the queue when a test ends would be processed during the next one. That is why the suites
wait for the queue to drain **before** cleaning up (`test/support/database-testing-app.ts`):

- `waitForEmailQueue(app)`: in the suites that record emails in a test double of the transport. Without
  the wait, one test's notice showed up in the next test's double; and, with `email_dispatch_logs`
  already deleted, the attempt failed and BullMQ resent the same email later. It also comes before
  asserting that **no** email went out, since sending is asynchronous;
- `waitForScoringQueue(app)`: before clearing `company_ods_scores`, and always on `app.close()`.

### Parallel e2e (#368)

The e2e files run in parallel, and each Vitest worker has its own infrastructure. Within a worker the
files still run one at a time, so each file is still alone on its database and its queue, as in the
serial run:

| Resource | Worker 1 | Worker 2 | Worker *n* |
| --- | --- | --- | --- |
| MongoDB | `bios_w1_test` | `bios_w2_test` | `bios_w<n>_test` (the `_test` suffix stays at the end) |
| Redis | database `1` | database `2` | index of `E2E_REDIS_URL` + *n* − 1, up to `15` |
| Temporary folder | `<tmp>/bios-e2e/w1` | `<tmp>/bios-e2e/w2` | `<tmp>/bios-e2e/w<n>` |

- **Number of workers:** `E2E_WORKERS` (default 4, capped at the machine's cores; CI pins 4, one per
  runner vCPU). `E2E_WORKERS=1` goes back to the serial run.
- **How the suites reach the worker's infrastructure:**
  - `test/setup/worker-infrastructure.setup.ts` points the process's `DATABASE_URL`, `REDIS_URL` and
    `TMPDIR`/`TEMP`/`TMP` to the worker's resources before each file;
  - the suites that build the configuration by hand use `testDatabaseUrl()`, `testRedisUrl()` and
    `testDatabaseName()` (`test/support/infrastructure.ts`), not an `inject` shared by every worker;
  - `buildTestEnvironment()` already returns the worker's database and Redis;
  - the `env` in `vitest.config.e2e.ts` carries nonexistent addresses (`*.invalid`) for database and
    Redis: if the worker setup does not replace them, the application fails to connect, instead of
    reading the development `.env` or sharing another worker's resources.
- **Isolation tested:** `test/integration/worker-infrastructure.e2e-spec.ts` checks that the process,
  `os.tmpdir()` and `buildTestEnvironment()` point to the worker's own resources, that they are distinct
  across workers, and the naming and `E2E_WORKERS` rules.
- **Global state, reviewed:**
  - BullMQ queues and schedules, cache and throttler counters live in Redis, so each worker has its own;
  - the fake source servers and the app itself listen on a free port (`listen(0)`);
  - the suites that check whether an adapter deleted the temporary folder read the worker's own folder,
    without seeing another's.
- **Measured time** (Windows, 12 logical cores; 58 files and 915 tests, plus the isolation suite in the
  last two rounds, with 59 and 928; all passing in every round):

  | Run | Time |
  | --- | --- |
  | Serial (before) | 642 s |
  | 2 workers | 314 s |
  | **4 workers (default)** | **187 to 206 s** (five rounds) |
  | 6 workers | 197 s |
  | 8 workers | 211 s |

  Above 4 workers the gain stops because the floor is a single file:
  `company-search-equivalence.e2e-spec.ts` takes ~175 s on its own (the others, at most 29 s), and the
  other 57 files fit in the remaining workers while it runs. More workers only increase CPU contention
  while importing the `AppModule`. Going below that requires splitting that file.

**Listener leak warning (#259).** Node emits `MaxListenersExceededWarning` when more than 10 listeners pile
up on an emitter. In the e2e tests it came from simultaneous requests through supertest (`Promise.all` of
10 or more calls) against the app's HTTP server not yet `listen`ing: supertest starts the server on each
request and queues the others on `once('listening' | 'error' | 'close')`. The fix is at the root, without
`setMaxListeners`: `createDatabaseTestingApp` does `app.listen(0)` (free port) once, and the requests go
straight through. So the warning does not come back, `test/setup/listener-leak.setup.ts` (registered in
`vitest.config.e2e.ts`) **fails the e2e file** that emits it. To find the origin of a new warning, run
with `NODE_OPTIONS=--trace-warnings` (it shows the stack of whoever added the listener).

Without MongoDB or Redis reachable, the corresponding suites are skipped locally (with a warning) and the
others carry on; in CI their absence fails the run. To run them locally, start the infrastructure first:
`npm run docker:up`.

The reference catalogs (SDGs, data sources and the domain blocklist) have idempotent seeders in the
modules themselves (`infra/db/seeders/`), gathered in `src/app/database/catalog.seeders.ts` in
dependency order.

## Test data

Every suite, unit and e2e, generates its data with Faker (pt-BR locale). Arbitrary values are not fixed
by hand; only values that are the rule under test are fixed, such as the reference SDGs, the
configuration defaults or the error messages.

- **Single instance**: tests import `faker` from `test/support/faker.ts`. ESLint blocks the direct import
  of `@faker-js/faker` in tests; production code (e.g. the honeypot, RF21) is still free to use it.
- **Factories**: records and domain objects come from `test/factories/<module>/`, created with
  `defineFactory`. `build(overrides)` generates a complete object and fixes only the scenario's fields;
  `buildMany(n, overrides)` generates several.
- **Respect the schema's limits**: the drawn value must fit for any seed. An example:
  `faker.lorem.word()` sometimes returns just `"a"`, below the 2-character minimum of an API key's name,
  and the test failed in about one run out of a thousand. For that field, `faker.lorem.words(2)`.
- **Reproducible seed**: each test file gets a random seed (`test/setup/faker.setup.ts`). When a test
  fails, the seed shows up in the output; to repeat exactly the same data:

```bash
FAKER_SEED=<seed> npx vitest run <file>        # bash
$env:FAKER_SEED=<seed>; npx vitest run <file>  # PowerShell
```

```ts
import { odsFactory } from '@test/factories/scoring/ods.factory.js';

const ods = odsFactory.build({ ods_number: 15 }); // other fields random
```

---

[Documentation index](README.md) · ← [16. API keys and public API](16-API-Keys.md) · [18. Quality and continuous integration](18-Quality-and-CI.md) →
