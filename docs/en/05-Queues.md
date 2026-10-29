# 05. Queues (BullMQ)

🇧🇷 [Português](../05-Filas.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [04. Database and initial load](04-Database.md) · [06. Authentication and accounts](06-Authentication-and-Accounts.md) →

> Queues, consumers, schedules and retry policies.

All communication between whoever asks and whoever processes goes through BullMQ queues on Redis —
there are no HTTP calls between services. Ingestion is **not** a separate service: each source is a
core module (`ibama/`, `receita/`…), and the consumer of each queue is a `@Processor` hosted in the
module that owns the flow. One consumer per queue: two on the same queue would compete for the jobs.

| Queue | Content | Consumer |
| --- | --- | --- |
| `company-profile` | Registration data by CNPJ | `CompanyProfileProcessor` (`companies/`) |
| `environmental-evidences` | Conduct evidence from CGU (CEIS/CNEP) | `EnvironmentalEvidencesProcessor` (`evidences/`), concurrency 3: CGU lookups by CNPJ, short jobs for callers waiting on the response |
| `ibama-ingestion` | IBAMA dumps (daily batch and on-demand collection by CNPJ) | `IbamaIngestionProcessor` (`ibama/`), exclusive, concurrency 1: one dump download at a time |
| `ghg-inventory` | Emissions inventory (GHG Protocol fallback) | `GhgInventoryProcessor` (`ghg/`), exclusive, concurrency 1: collection by CNPJ and daily synchronization of the organization registry |
| `ods-scoring` | Recalculation of index and confidence per SDG (UC15) and sweep by rules version | `OdsScoringProcessor` (`scoring/`), concurrency 3 ([Recalculating the indexes through a queue](14-SDG-Indexes.md#recalculating-the-indexes-through-a-queue-uc15-80)) |
| `email-dispatch` | Transactional emails | consumed in this API (`mailing/`) |

The contract is `QueueProvider`, with three operations:

```ts
await queues.enqueue(QueueName.EMAIL_DISPATCH, 'send-confirmation', { userId });
const profile = await queues.enqueueAndWait(QueueName.COMPANY_PROFILE, 'fetch', { cnpj });
await queues.schedule({ queue, id: 'ibama-daily-ingestion', jobName, cron: '0 4 * * *' });
```

- **Exact coalescing (`coalesce: true` + `jobId`).** Several requests for the same work become one
  **while it has not started**, without ever losing a change. BullMQ treats the same `jobId` as the
  same job while the record exists, and completed jobs are kept for one hour and failed ones forever:
  without handling, a request made after the job finished would be ignored and would return the stale
  result. With `coalesce`: a **pending** job (waiting or delayed) absorbs the request (it will still read
  the newest data); a **completed or failed** job is removed and a new one is published; an **active**
  job (which may have already read the old data) hands the request to a follow-up `<jobId>~next`, into
  which the following requests merge while it is pending; if the follow-up has also started, the
  request goes to the next link (`~next~next`...), so that no request is ignored for having the same id
  as a running job (the chain is as long as the number of jobs active at the same time, bounded by the
  consumer's concurrency). Callers tolerate two jobs with the same `jobId` at the same time: the work
  must be idempotent and must not regress a newer result (see the index recalculation). Used by the
  `ods-scoring` queue; the others keep using a `jobId` per time window.
- **Waiting with a deadline.** `enqueueAndWait` returns the consumer's result or throws
  `QueueTimeoutException` after `QUEUE_WAIT_TIMEOUT_MS` (adjustable per call). This is what supports
  graceful degradation: once a non-blocking source's deadline is exceeded, the caller shows the
  evidence as `UNKNOWN` instead of failing the whole query. The job **remains** in the queue — the
  deadline belongs to whoever waits, not to the processing.
- **Failure distinct from timeout.** Once the attempts are exhausted, the job is recorded as failed
  (`removeOnFail: false`) and the wait throws `QueueJobFailedException` with the reason in `details`.
  That record is precisely what makes it possible to tell the two situations apart.
- **Retry per queue.** Attempts and exponential backoff live in `src/shared/config/queue.config.ts`:
  queues serving a user's query fail fast; background ones insist more.
- **Repeatable jobs.** `QUEUE_SCHEDULES` declares the schedules (cron), registered on every boot by
  `QueueSchedulesInitializer`. Registration is idempotent by `id`: restarting the API does not
  duplicate the trigger. Turn it off with `QUEUE_SCHEDULES_SYNC_ON_BOOT=false`.
- **Retry per schedule.** A schedule can bring its own policy (`retry`), instead of the queue's. The
  daily IBAMA batch (minutes per attempt, a source that is often down for hours) declares **5 attempts
  with exponential backoff on a 5 min base** (5, 10, 20 and 40 min between them); the per-CNPJ jobs on
  the same `ibama-ingestion` queue keep the queue's short policy (5 attempts, 5 s base). The batch's old
  scheduler, which lived in `environmental-evidences`, is removed on every boot
  (`QUEUE_RETIRED_SCHEDULES`).
- **The API starts without Redis.** The connection is `lazyConnect` and `/health` reports
  `checks.redis`. For the same reason, the wait polls the job's state at short intervals instead of
  using `QueueEvents`: `QueueEvents` opens a blocking connection when it is constructed and, without
  Redis, brings the process down with a rejection that does not go through the error event. Publishing
  also has a deadline (`QUEUE_PUBLISH_BUDGET_MS`): without it, the client would hold the command until
  it reconnected, hanging the request that originated it — once the deadline is exhausted, the
  response is `DEPENDENCY_UNAVAILABLE`.

---

[Documentation index](README.md) · ← [04. Database and initial load](04-Database.md) · [06. Authentication and accounts](06-Authentication-and-Accounts.md) →
