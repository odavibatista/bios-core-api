# 12. IBAMA

🇧🇷 [Português](../12-IBAMA.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [11. Evidence](11-Evidence.md) · [13. GHG Protocol inventory](13-GHG-Protocol.md) →

> IBAMA dumps: download, reading, normalization, daily job and on-demand lookup by CNPJ.

**On this page**

- [Daily batch: IBAMA (downloading and reading the dumps)](#daily-batch-ibama-downloading-and-reading-the-dumps)
- [Normalizing the IBAMA evidence](#normalizing-the-ibama-evidence)
- [IBAMA daily job (consumer, runs, retry)](#ibama-daily-job-consumer-runs-retry)
- [Local lookup and on-demand IBAMA job by CNPJ](#local-lookup-and-on-demand-ibama-job-by-cnpj)

## Daily batch: IBAMA (downloading and reading the dumps)

IBAMA (the Brazilian federal environmental agency) has no lookup by CNPJ: it publishes the entire dump
of each resource, and the MVP ingests two (UC14): the **infraction notices** (`.zip` with one CSV per
year, currently 48 files and about 720 MB uncompressed) and the **embargo terms** (one `.csv` of about
210 MB). `IbamaDataSource` (`ibama/`, slug `IBAMA`) **downloads** the dump and delivers an `IbamaDump`,
which reads the records as a stream. The adapter writes nothing: normalization into evidence is the
next subsection, and the daily job that schedules, repeats and records all of this (checksum, runs,
retry) is the one after it.

- **Where the files are.** IBAMA's `data_sources.base_url` points to the storage where IBAMA publishes
  them (the CKAN portal only points to it), and the adapter appends each resource's path
  (`IBAMA_RESOURCES`). A database created before this delivery keeps the old `base_url` (the seed does
  not change existing sources) and starts getting 404: adjust the source's `base_url` and
  `request_timeout_ms` (600,000 ms) in the database.
- **Download to disk, as a stream.** `RequestDataSourceUseCase` gained the `download` mode (same limit
  per minute, the catalog's maximum time and the request log): the body goes to a temporary file, with a
  **size limit** (1 GiB), a **maximum time for the whole call**, without following redirects, and the
  **SHA-256 is computed while writing**. A failure, the limit or a timeout delete what was written. The
  checksum exists so that ingestion can stop on a dump identical to the last run's without reprocessing
  it.
- **404 is not "no record".** For a file, it means the dump is out of place (wrong catalog URL or IBAMA
  moved it): the result is `UNAVAILABLE`, with the message pointing to the `base_url`, never
  `NOT_FOUND`.
- **Streamed reading.** CSV with a `;` separator, quoted free text with line breaks and, in the
  embargo file, a byte order mark (BOM): read with `csv-parse`; the `.zip`, with `yauzl`, **straight
  from the file, without extracting**. Reading the 712 thousand records of the infraction notices takes
  about 1 minute and uses a little over 120 MB of memory. The sum of the `.zip`'s CSVs is limited to
  2 GiB, and each one's real size is checked against the declared size (decompression bomb). A
  malformed line is skipped and counted; a **column missing** from the header, or a `.zip` without a
  CSV or truncated, is `IbamaDumpFormatError`: IBAMA changed the dump, and the job must fail, not
  silently ingest nothing.
- **Individuals never leave the adapter (INL02).** Each line goes through `classifyIbamaDocument`
  **before** any persistence, including the raw layer. **The document decides, not the label**: only a
  valid CNPJ gets in (format and check digits, numeric or alphanumeric). In the October 2026 dumps there
  are lines labeled `PJ` (legal entity) with a CPF (individual's tax ID) in the document, and the
  embargo term does not even have the label; a `PF` (individual) label discards the line even with a
  document that looks like a CNPJ. Discards are counted by reason (`PESSOA_FISICA`, `SEM_DOCUMENTO`,
  `DOCUMENTO_INVALIDO`, `REGISTRO_MALFORMADO`) and the sum is the run's `records_discarded`. In today's
  dumps: of the 712,288 lines of infraction notices, 220,108 are companies, 458,677 individuals, 32,955
  have no document and 548 an invalid document; of the 116,865 embargo lines, 17,737 are companies and
  88,727 individuals.
- **What the record carries.** `IbamaRecord` carries the canonical CNPJ, the public reference (number
  and series: `1092-A`; new documents have an alphanumeric number and no series), the internal
  identifier (`SEQ_*`, empty in the new ones) and a payload with **allowed columns**
  (`payloadColumns`). Left out are the **name** of the fined/embargoed party, free text and geometries
  (WKT, which can weigh megabytes per line): the company is already identified by the CNPJ, and the
  name is the only field through which a person's name could reach the database.
- **The public reference is not unique.** The same number shows up on more than one line (in today's
  dumps, 425 CNPJ and reference pairs repeat among the 220 thousand infraction notices). Whoever
  normalizes decides how to handle it; the adapter delivers the lines as they are.
- **Callers must call `dispose()`** when done (including on failure): it deletes the dump's temporary
  folder. `records()` can be called again (it rereads the file), and `stats` starts over.

## Normalizing the IBAMA evidence

`NormalizeIbamaRecordsUseCase` (`ibama/`) turns the `IbamaRecord`s into evidence per CNPJ and writes it,
together with the raw record, through the evidence module's **batch load** (UC14, steps 3 and 4;
RF08). The orchestrator (the job) opens the load, downloads and normalizes each resource and, if **all**
of them succeeded, closes it:

```ts
const batch = await openEvidenceBatch.execute({ sourceSlug: 'IBAMA', collectedAt, ingestionRunId });
for (const resource of [AUTO_INFRACAO, TERMO_EMBARGO]) {
  const downloaded = await ibama.download(resource, context);
  // ... only continues if FOUND
  try { await normalize.execute({ records: downloaded.data.records(), batch }); }
  finally { await downloaded.data.dispose(); }
}
await batch.finish(); // removes what the dump stopped listing
```

- **What becomes evidence.** Each record becomes a `CONFIRMED` evidence with the catalog's category and
  SDG (`INFRACAO_AMBIENTAL`, SDG 15, negative signal), with the document's **public reference**
  (`1092-A`), a **summary in Portuguese** (`Multa simples: Infração da Flora — R$ 6.932,00
  (FORTALEZA/CE)`; `Termo de embargo — Desmatamento — 12,5 ha (Lages/SC)`), **details** with values
  already converted (fine amount, hectares, municipality, state, case number), the **date** of the
  notice or the term (day only, the dump does not state the time zone) and the **link** to the dataset
  on IBAMA's portal (RF09: the dump does not carry a link per record, so the reference identifies the
  record in it).
- **A voided record is not evidence.** A notice or term that was cancelled (`SIT_CANCELADO = S`),
  deleted or replaced by another (`DES_STATUS_FORMULARIO`) is skipped and counted: a voided infraction
  did not happen for index purposes, and a negative evidence that is not valid would be unfair to the
  company (IND01). This also applies to what **becomes** voided: it disappears on the next load.
- **A lifted embargo is still evidence.** The lifted embargo did happen; the summary says
  `desembargado em 01/03/2024` (lifted on 03/01/2024) and `details.lifted` flags it. How much it weighs
  belongs to the index calculation.
- **Evidence identity.** The public number repeats in the dump, but the internal identifier (`SEQ_*`)
  does not: the evidence key is `IBAMA:<cnpj>:AI-<seq>` (notice) or `TE-<seq>` (term) and, for new
  documents, which have no `SEQ`, the number. The prefix avoids a collision between a notice and a term
  with the same `SEQ`. Two records with the same public number and different `SEQ`s are two evidences;
  the same line twice in the dump is one.
- **Raw record (auditing, NFCO02).** Each record is written to `evidence_raw` only once per content
  (`payload_hash`, unique index together with the source): repeating the load reuses the record and
  keeps the date and run of the first collection; if IBAMA **changes** the record, a new raw version is
  born and the evidence starts pointing to it. The payload is the adapter's, **rebuilt from the allowed
  column list** here too (no name of the fined party, free text or geometry).
- **Streamed, without growing memory.** Records are written in batches of 200, with up to 25
  simultaneous writes (each one is the raw record and the evidence). A failed write stops the batch
  without starting new items.
- **Closing the load (`batch.finish()`).** Removes the source's evidence, for any company, collected
  before the load: whatever IBAMA stopped listing, a notice cancelled later, a company that left the
  dump and earlier `NOT_FOUND`s and `UNKNOWN`s. **It is only called after every resource has been
  loaded**: with one of them missing, its valid evidence would be removed. Without calling it (a load
  that failed), nothing is removed, and the earlier evidence remains until it expires (UC14, flow 2.1).
  The validity of everything the load writes is renewed (`cache_ttl_seconds`).

## IBAMA daily job (consumer, runs, retry)

The `0 4 * * *` cron (`QUEUE_SCHEDULES`, id `ibama-daily-ingestion`) publishes the `ingest-ibama-dumps`
job on the `ibama-ingestion` queue, and `IbamaIngestionProcessor` (`ibama/infra/queue/`), hosted in the
core, runs it through `IngestIbamaDumpsUseCase` (UC14). The consumer dispatches by the job's **name**;
an unknown name, a payload that is not an object or a job without an identifier fail without retry
(`UnrecoverableError`). The same consumer serves the on-demand IBAMA lookup by CNPJ. The CGU lookup
triggered by the consolidation has its own queue and consumer (`environmental-evidences`).

**Design decision (#262): its own queue + dump reuse.** The dumps are ~330 MB (829 thousand lines) and
the on-demand job reads them entirely to find one CNPJ. With a single consumer at concurrency 3, three
on-demand jobs took all the workers and the CGU jobs of waiting callers exceeded their deadline
(`UNKNOWN`). Now: (1) batch and on-demand live on the `ibama-ingestion` queue, with concurrency 1 — at
most one download at a time and no competition with CGU; (2) `IbamaDumpLease` keeps both dumps for 10
minutes (`IBAMA_DUMP_REUSE_MS`), so consecutive on-demand jobs for distinct CNPJs share **one**
download, and simultaneous requests wait for the same download in progress (single-flight); reading is
serialized; (3) the on-demand collection is dated by the moment of the download, not of the reading;
(4) a job that waited more than 1 s in the queue logs the delay (`adiado N s`), and
`IbamaDumpLease.stats` exposes `downloads`, `reuses` and `peakDownloads` to measure the
one-download-at-a-time limit. The temporary files are deleted when the window expires (and nobody is
reading), when they are replaced or when the application shuts down.

The flow of one run, in this order:

1. **Opens the run** in `ingestion_runs` (`RUNNING`, `run_type = SCHEDULED`, BullMQ's `job_id`). The
   `started_at` is also the **collection date** of everything the run writes.
2. **Downloads both dumps** (infraction notices and embargo terms) and only then decides. If either one
   does not come, the job fails (`IbamaDumpUnavailableError`, with each one's reason) and the queue
   retries it.
3. **Compares the checksum.** `dump_checksum` is a single one per run, and the batch has two files: what
   is stored is the hash of the map resource → SHA-256 of each file (`combineDumpChecksums`). It changes
   if **either** of the two changes, does not depend on the download order and does not confuse one file
   swapped for the other. The reference is the last **scheduled `SUCCEEDED`** run; a more recent skipped
   or failed run does not count.
4. **Identical dump** → `SKIPPED_UNCHANGED`: nothing is reprocessed, but the **evidence's validity is
   renewed** (`RenewSourceEvidencesUseCase`: `collected_at` = start of the run and `valid_until` =
   start + the source's window, in a single `updateMany`, only for the source's `CONFIRMED` and
   `NOT_FOUND`; `UNKNOWN` does not age and other sources' evidence is not touched). Without this, IBAMA
   republishing the same file over a weekend would leave, after the two days of validity, all evidence
   `OUTDATED` with current data.
5. **Different dump** → opens the load, normalizes and writes both resources as a stream and, **only
   after both**, closes the load (`batch.finish()`), which removes what the dump stopped listing. On no
   failure does `finish` run.
6. **Closes the run** (`SUCCEEDED`) with `records_read` (lines read from both dumps, discarded ones
   included), `records_upserted` (evidence written) and `records_discarded` (lines discarded for being
   individuals, having no document, an invalid document or being malformed, **plus** the voided records
   that did not become evidence).
7. **Deletes the temporary files** of both dumps, always (`finally`), on success, skip or failure.

- **One run per job.** The attempts of the same job (`job_id`) reopen the same `ingestion_runs` line
  (back to `RUNNING`, with the new attempt's start and without the previous error), instead of creating
  one line per attempt. That is why `started_at` is the start of the attempt that actually wrote.
- **`FAILED` only on the last attempt.** The consumer compares `attemptsMade + 1` with the job's
  attempts: in the intermediate ones the run stays `RUNNING`; on the last one, or on an error that
  allows no retry (the `IBAMA` source **disabled** in the catalog, which fails right on the first
  attempt with `UnrecoverableError`), it becomes `FAILED` with the message (up to 500 characters, no
  personal data). Failing the run **deletes no evidence**: the earlier ones remain until the end of
  their validity and then show up as `OUTDATED` (UC14, flow 2.1). If not even writing `FAILED` is
  possible, the original error is what goes up to the queue.
- **Retry and backoff.** The schedule declares 5 attempts with exponential backoff on a 5 min base (5,
  10, 20 and 40 min) — see [Queues](05-Queues.md). Jobs outside the scheduler follow the queue's policy.
- **Concurrency and date.** Batch and on-demand share `ibama-ingestion`, with concurrency 1 per consumer.
  Since the on-demand job may reuse a dump downloaded before the batch, persistence compares
  `collected_at`: an older collection does not replace a newer snapshot, even if it finishes later. A
  job re-run keeps the keys idempotent and the on-demand job only changes the requested CNPJ.
- **Index recalculation stays outside.** Step 5 of UC14 (recalculating the index of the affected CNPJs)
  is the ingestion trigger of the queue-based recalculation (UC15). The set of affected CNPJs is not
  stored: every evidence of the run has `collected_at` equal to its `started_at`, and the raw record
  points to the run.
- **Manual trigger.** There is no endpoint. In development, publish the job on the queue
  (`queue.add('ingest-ibama-dumps', {})`) or use the e2e tests' test policy.
- **Databases created before #69.** The seed does not change existing sources (use
  `npm run catalog:sync` to see and apply the difference): check the `IBAMA` source's `base_url`,
  `request_timeout_ms` (600,000) and `cache_ttl_seconds` (172,800); without that the download gets 404.

**Measured with the real dumps** (10/21/2026, local MongoDB and Redis, both files served by a local HTTP
server): the first run takes **about 10.5 min** (629 s) to read 829,239 lines, write **229,184
evidences** (and the same number of raw records) and discard 600,055 (individuals, missing or invalid
document, and voided); the test process's memory peak was 230 MB. The job was never considered stalled
(`stalledCounter = 0`), so the default `lockDuration` (30 s) is enough while reading is asynchronous.
The second run, with the same files, finished as `SKIPPED_UNCHANGED` in **12 s**: no record read, no new
evidence, and the existing 229,184 with their validity renewed.

## Local lookup and on-demand IBAMA job by CNPJ

`GetIbamaCompanyEvidencesUseCase` queries only IBAMA and publishes the collection without waiting for
its result (UC07, flow 1.1; UC14). The use case is exported by `IbamaModule` for the environmental
consolidation and the full profile; this delivery adds no endpoint and does not change the current
registration response.

- Valid `CONFIRMED` or `NOT_FOUND` evidence is returned without a download.
- If the CNPJ has no local response, the last **scheduled** `SUCCEEDED` or `SKIPPED_UNCHANGED` load that
  is still valid proves the absence: it writes `NOT_FOUND` with that batch's start date and its
  validity window. The lookup does not renew that window. An `ON_DEMAND` run, or a batch that failed or
  is still running, does not vouch for the whole index.
- Without that reference, it writes `UNKNOWN` before publishing the `ingest-ibama-company` job, with
  the canonical `{ cnpj }` payload, on the `ibama-ingestion` queue. A valid `UNKNOWN` prevents another
  publication for 15 minutes. The identifier `ibama-cnpj-<cnpj>-<15-min window>` deduplicates
  concurrent publications in the same window. If publishing reports the queue as unavailable, the lookup
  preserves the local response.
- Earlier expired responses remain available as `OUTDATED` while the update is published;
  unavailability does not replace them with `UNKNOWN`.

The same batch consumer dispatches `IngestIbamaCompanyUseCase`. Each job opens an `ON_DEMAND` run with
`cnpj` and `job_id`; the downloads have the `ON_DEMAND_JOB` trigger and point to that run. It downloads
and reads **both** dumps entirely, including validating each header, but keeps in memory and persists
only the findings of the requested CNPJ. A CSV without a header or with missing required columns fails
even without data lines; a valid header without records confirms an empty resource.

Only after both reads does `RecordEvidenceEntriesUseCase` write the raw records with the same hash the
batch uses and replace that company's snapshot. It does not call `batch.finish()`: evidence of other
CNPJs and other sources stays intact. Without findings, it writes `NOT_FOUND`; a download or format
failure preserves the previous snapshot, or leaves `UNKNOWN` when there was never a response.

The on-demand job records a combined checksum for auditing, but its success is neither a checksum
reference nor proof that the complete batch is current. Its counts include every line read, the
evidence written (including the absence marker) and the parser's discards, voided records and records
of other CNPJs. Retries reopen the same run; `FAILED` only on the last attempt, or immediately if the
source is disabled. It uses the queue's existing policy: 5 attempts, exponential backoff on a 5-second
base.

Local validation with the official dumps already downloaded in the previous delivery (123,095,496 bytes
+ 210,516,004 bytes): both real scenarios passed in about 184 s in total. The present CNPJ produced
2,535 evidences; the absent one ended as `NOT_FOUND`, preserving another company. The complete file
had 829,239 lines. This validation uses the preserved files, without claiming a new query to the public
storage.

Temporary files are discarded in `finally`. Deduplication is per window; the time guard in persistence
also covers jobs from different windows. The on-demand download's moment is compared with that of the
most recent complete or on-demand collection. The queue-based recalculation remains in UC15 (#80).

---

[Documentation index](README.md) · ← [11. Evidence](11-Evidence.md) · [13. GHG Protocol inventory](13-GHG-Protocol.md) →
