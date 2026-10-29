# 11. Evidence

🇧🇷 [Português](../11-Evidências.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [10. External sources (adapters)](10-External-Sources.md) · [12. IBAMA](12-IBAMA.md) →

> Model and persistence, consolidation by CNPJ, references to the sources, UNKNOWN reasons and the CGU.

**On this page**

- [Evidence (model and persistence)](#evidence-model-and-persistence)
- [Consolidating evidence by CNPJ (RF07)](#consolidating-evidence-by-cnpj-rf07)
- [References to the original sources (RF09)](#references-to-the-original-sources-rf09)
- [UNKNOWN reasons of the evidence sources (observability)](#unknown-reasons-of-the-evidence-sources-observability)
- [CGU: CEIS and CNEP (administrative conduct)](#cgu-ceis-and-cnep-administrative-conduct)

## Evidence (model and persistence)

> **Changing a summary's text does not duplicate anything (#258).** Evidence is written by *upsert* on
> the key `<source>:<cnpj>:<reference>`, which does not contain the summary, and the raw record's hash
> covers only `{ key, raw }` (the payload comes from the source, never from the text BIOS writes).
> Fixing the accents of a summary updates the existing row. Evidence already stored keeps the old text
> until that CNPJ's next collection: GHG and CGU, when the validity expires and the collection repeats;
> IBAMA, on the next changed dump (an identical dump only renews the validity). There is no migration:
> the old text is correct as to content and goes away on its own. The `evidences.e2e-spec.ts` e2e test
> proves that collecting again with the new summary leaves a single evidence and a single raw record.

`EvidencesModule` stores the result of querying each evidence source for each company (RF08, UC14).
There is no route yet: the ingestions of each source (IBAMA, CGU, GHG) write, and the environmental
profile (UC07) reads. The module exports two use cases.

**States (`EvidenceState`).** Never a boolean (IND02):

| State | Means | Scores? |
| --- | --- | --- |
| `CONFIRMED` | the source has a record of the company | yes, with the category's signal |
| `NOT_FOUND` | the source was queried and **has no** record | it is not a negative signal |
| `UNKNOWN` | **it was not possible to know** (source down, job in progress) | no; it only lowers the confidence |
| `OUTDATED` | past its validity; waiting for a new collection | decided in the index calculation |

- **`OUTDATED` is derived on read**, not stored: `ListCompanyEvidencesUseCase` returns `OUTDATED` for
  `CONFIRMED` or `NOT_FOUND` evidence whose `valid_until` has passed. No job flips the state, and a
  source that is down does not keep evidence "alive" beyond its deadline. `UNKNOWN` does not age (there
  is no data to grow old) and has its own retry window of **15 minutes**
  (`UNKNOWN_RETRY_WINDOW_SECONDS`), so as not to hammer a source that has just failed.
- **Validity.** `valid_until = collected at + the source's data_sources.cache_ttl_seconds`; without a
  window in the catalog, `CACHE_DEFAULT_TTL` applies. The IBAMA seed got 2 days (the daily job renews
  it; one missed run does not expire the data). The seed does not change sources that already exist: an
  old database keeps its window until it is adjusted in `data_sources` (or by `npm run catalog:sync`).
- **Category and SDG come from the catalog** (`data_sources.evidence_category` and `ods_id`, through
  `ResolveEvidenceSourceUseCase`), and the **signal comes from the category** (`signalForCategory`: GHG
  emissions positive; infraction and sanction negative). Whoever normalizes a record only states the
  source and what was found; it never chooses category, SDG or signal.

**Writing: `RecordEvidenceCollectionUseCase`.** It receives `{ cnpj, sourceSlug, result }`, where
`result` is `COLLECTED` (with zero or more records) or `UNAVAILABLE`. The result is a **snapshot of the
source for the company**:

- with records: each one becomes a `CONFIRMED` evidence; whatever the source had before and no longer
  lists (including an old `NOT_FOUND` or `UNKNOWN`) is removed. Without that, the company would have a
  confirmed infraction and a "nothing found" at the same time;
- without records: a `NOT_FOUND` evidence replaces the source's previous ones;
- source unavailable: **nothing is deleted**. If there is an earlier collection that answered, it stays
  and ages until `OUTDATED`; if not, `UNKNOWN` is written.

**Idempotency.** The `evidence_key` is deterministic: `<source>:<cnpj>:<reference>` for a record and
`<source>:<cnpj>#NOT_FOUND` / `#UNKNOWN` for the query's result. The CNPJ is part of the key so that the
same reference in two companies (an infraction notice with more than one party) never overwrites the
other company's evidence. Repeating a collection updates instead of duplicating, preserves
`created_at`, renews the date and the validity and **clears** a field the source stopped reporting
(writes `null` rather than omitting it). The snapshot of a company and source uses a MongoDB
transaction and a clock per source/CNPJ in `evidence_collection_clocks`. That way, insertion, update
and removal obey the same collection date, including when the new snapshot is empty. An `UNAVAILABLE`
collection only writes `UNKNOWN` when the transaction confirms there is no earlier response. The
streaming load also uses a clock for the source's complete dump. An older collection is ignored; an
equal date may reprocess the same collection. The unique index still guarantees each evidence's
identity. Before activating this version on an existing database, run `npm run db:push` to create the
unique index on `scope_key`; without it, simultaneous instances do not compete for the same clock.

When the reference the source displays **is not unique** (IBAMA repeats an infraction notice's number
across different records), the record provides an `identity`, which then makes up the key instead of
the reference; the reference is still what is shown to the user (RF09).

**Batch load: `OpenEvidenceBatchUseCase`.** For batch sources (IBAMA's daily dump, with hundreds of
thousands of records from many companies), the per-company snapshot does not work: the load is
**streamed**. `batch.write(entries)` writes each record as it arrives, the raw one (`evidence_raw`, once
per content) and the evidence, without accumulating anything in memory; `batch.finish()` removes, at
the end, the source's evidence the load did not renew (`collected_at` earlier than the load). The
source and the validity are read from the catalog once, when the batch is opened. Failing halfway
deletes nothing, because whoever did not call `finish` removed no evidence.

Configuration errors (a source that is not an evidence source, a non-canonical CNPJ, a record without a
reference) are programming failures, not domain exceptions: `EvidenceSourceNotFoundError` and
`InvalidEvidenceError`.

## Consolidating evidence by CNPJ (RF07)

`EnvironmentalIntelligenceModule` (the `environmental-intelligence` module) exports
`GetCompanyEnvironmentalEvidencesUseCase`, besides the `EnvironmentalEvidencesProcessor` consumer, the
`RequestCguCompanyEvidencesUseCase` producer, the CGU job contract and the controller of
`GET /companies/:cnpj/evidences`. It receives a CNPJ (formatted or canonical), validates it before any
side effect and starts, in parallel, the local IBAMA read, the CGU producer and the GHG producer.

**Direction of dependencies (#254).** Storage (`evidences`: writing, reading, collection clock, model
and consolidation by category) knows neither the sources that feed it nor who gathers them: `ibama`,
`cgu` and `ghg` depend on `evidences` (they write and read snapshots), and
`environmental-intelligence` depends on all of them, **never the other way around**. This undoes the
cycle that existed when the orchestrator lived inside `evidences`. The rule is enforced by ESLint
(`no-restricted-imports` in `eslint.config.mjs` for `src/modules/evidences/**`, which refuses imports
from `ibama`, `cgu`, `ghg` and `environmental-intelligence`, by alias or by relative path). What is
specific to a source (e.g. `CGU_SLUGS`) stays with it; what belongs only to orchestration stays in
`environmental-intelligence`. A new source module becomes a dependency of the latter, not of
`evidences`.

- IBAMA keeps the lookup in the valid index/batch and the on-demand job without waiting.
- CGU reuses each valid registration already persisted. When it needs to collect, it publishes
  `fetch-cgu-evidences` on the `environmental-evidences` queue, deduplicated per CNPJ/15-minute window,
  and waits up to `QUEUE_WAIT_TIMEOUT_MS`. The single `EnvironmentalEvidencesProcessor` serves only
  CGU, with concurrency 3; IBAMA jobs use their own `ibama-ingestion` queue. The CGU worker queries
  CEIS/CNEP in parallel and persists the results independently.
- GHG keeps its own queue, concurrency and deadline; its failure does not cancel the other queries.
  Jobs may finish after the waiting caller's deadline.
- At the end, a local re-read includes results completed during the wait. The Zod-validated response
  has `cnpj` and `categories`, always with the three categories. Each evidence carries `source_slug`,
  SDG, state, publication, collection, validity, summary, details and the original reference/link. The
  order is stable by category, source and key. There is no score, weight or sustainability verdict.
- Only `CONFIRMED` carries `signal`; `NOT_FOUND`, `UNKNOWN` and `OUTDATED` carry `null`, preserving the
  historical signal in the database. Unavailability preserves the previous response and its dates;
  without a previous response, it records `UNKNOWN`. CEIS/CNEP fall under `CONDUTA_ADMINISTRATIVA`.
  A missing GHG inventory never becomes `NOT_FOUND`. A global database failure is still an
  infrastructure error.

## References to the original sources (RF09)

`GET /companies/:cnpj/evidences` requires a JWT session and returns the consolidation by category,
validated and documented in OpenAPI. The route accepts a numeric or alphanumeric CNPJ; leave the
formatting slash out of the URL. An invalid CNPJ responds 422 and a missing session responds 401 before
any source is queried. A valid CNPJ without a local `company_profile` responds 404 (`COMPANY_NOT_FOUND`)
before any evidence read, write or job publication. The route has its own per-IP limit (default 20
queries per minute, `THROTTLE_COMPANY_EVIDENCES_LIMIT`), instead of the global limit.

Each evidence carries `source` (the catalog's current public name), `source_slug`, `source_reference`
and `source_url`, besides the publication/collection/validity dates. The link, when present, must be an
absolute HTTPS URL and must not contain credentials. IBAMA points to the official dataset because the
dump does not offer an individual link; the identifier makes it possible to find the record. CGU
resources may require a key at the agency itself, without the BIOS credential being included in the
response. A reference without a URL is preserved: the API does not invent an address to complete it.

A legacy `CONFIRMED` evidence without a non-empty identifier or a valid HTTPS link is projected as
`UNKNOWN`, with null signal, summary and details. The rule is also enforced by the response schema. The
projection preserves the record in the database and its dates; invalid URLs are removed from the
response, without changing the history. `UNKNOWN`, `NOT_FOUND` and `OUTDATED` do not become
confirmations and may have null provenance fields. A missing GHG inventory is still `UNKNOWN`.

The composition of the full profile and the public API was delivered in #81 (see [Full company profile](15-Companies.md#full-company-profile)). There is no change to the Prisma schema, environment variables or queue configuration.

## UNKNOWN reasons of the evidence sources (observability)

The CGU and GHG adapters return `UNAVAILABLE` (and the evidence becomes `UNKNOWN`) without throwing,
and that used to be silent: a rejected credential, a reached limit, a new format and a program defect
all looked the same. Now every exit without data records **a reason from a closed set** (`UnknownReason`,
in `data-sources/domain/unknown-reason.ts`), through a structured line (`logSourceUnknown`):

```json
{ "event": "source_unknown", "source": "CGU_CEIS", "reason": "CREDENTIAL_REJECTED" }
```

| Reason | When |
| --- | --- |
| `INVALID_INPUT` | unusable CNPJ or search name |
| `CREDENTIAL_MISSING` / `CREDENTIAL_REJECTED` | no `CGU_API_KEY` in this environment / the source answered 401 or 403 |
| `SOURCE_NOT_CONFIGURED` / `SOURCE_DISABLED` | source missing / disabled in `data_sources` |
| `RATE_LIMITED` / `TIMEOUT` | limit (ours or HTTP 429) / deadline exhausted |
| `ENDPOINT_NOT_FOUND` / `UNEXPECTED_STATUS` | 404 where only 200 is valid / 2xx other than 200 |
| `SOURCE_ERROR` | 5xx, connection refused, unreadable response |
| `CONTRACT_MISMATCH` | the response does not have the format read (the source changed its contract) |
| `PAGINATION_LIMIT` | endless pagination (repeated page or page ceiling) |
| `NO_CONFIRMED_MATCH` | the source answered, but nothing was confirmed as the company's (absence not proven) |
| `UNEXPECTED_ERROR` | program defect: logged as an **error**, with the exception's name and the stack lines |

The record never carries the credential, the headers, the response body, the exception message or the
CNPJ. Expected failures are logged as warnings; only `UNEXPECTED_ERROR` is logged as an error, so that a
program defect stays visible without dragging along text coming from the source. A counter per source
and reason was not created: the structured line already makes counting possible in the log aggregator.
A new reason value is a decision of this file, not free text from the adapter. IBAMA is left out: its
failures become exceptions and `ingestion_runs` with status `FAILED`.

## CGU: CEIS and CNEP (administrative conduct)

`CguModule` exports `CeisDataSource`, `CnepDataSource` and `GetCguCompanyEvidencesUseCase`. The use case
receives a CNPJ and a `SourceCallContext`, queries the two registries separately and writes each
source's snapshot. The environmental consumer dispatches the CGU collection through the queue during
consolidation (#75). The profile composition was delivered in #81; this delivery added no endpoint or
index calculation.

- `CGU_API_KEY` is optional at bootstrap. Without a token, the API stays available, `/health` reports
  `checks.cgu_credentials = missing` without returning an error, and CEIS/CNEP stay `UNKNOWN` without
  publishing a collection or calling CGU. Earlier evidence is preserved. Configure the token in the
  local `.env` or in the environment's secret to enable new queries; when provided, it must come without
  spaces/control characters and not be the example's placeholder. Get it at
  <https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email>. Provide only the value: the
  adapter builds the `chave-api-dados` header; never send the headers JSON as the variable, and never
  log or commit the token.
- The endpoints' full URLs come from the catalog. The query uses `codigoSancionado=<CNPJ>` and
  `pagina=1,2,...`, without filtering by sanctioning agency. Only an empty page with HTTP 200 ends the
  query; a short page or one containing only CPFs does not. A repeated page, an invalid format or the
  100-page limit makes the collection unavailable, without persisting the partial result.
- Separate cache per registry/CNPJ, with the catalog's TTL (seed: one day), only for complete queries.
  The cache contains only the sanitized allowlist and keeps the original collection date: reading it
  does not renew the validity. Whether the source is enabled in the catalog is checked before the cache.
  Limit per minute, timeout and the log of each page use the common infrastructure (seed: 90/min and
  5 s).
- **The limit per minute is a single one for CEIS and CNEP.** Both sources use the same key and CGU's
  ceiling is per token, so the two registries share a single counter (`CGU_RATE_LIMIT_GROUP`, passed as
  `rateLimitGroup` to the common infrastructure): the sum of the calls to both never exceeds the
  catalog's `rate_limit_per_minute` (seed: 90 in total, not 90 each). The ceiling applied is that of the
  source making the call; keep the same value in both `data_sources` records (with different values,
  the sum is bounded by the larger one). A reached limit, ours or HTTP 429, becomes `UNKNOWN` with the
  reason `RATE_LIMITED`, without repeating the request or writing the cache. **Official value to be
  confirmed:** CGU's page could not be read automatically; a (third-party) copy of the documentation
  mentions 400/min during business hours and 700/min between midnight and 6 a.m., with 180/min on eight
  restricted endpoints, which do not include CEIS or CNEP, and the token suspended for 8 hours when
  exceeded. The seed's 90 is conservative in light of that and can be adjusted in the database, without
  a deploy, once checked against the official documentation.
- Each sanction becomes a `CONFIRMED` evidence, category `CONDUTA_ADMINISTRATIVA`, SDG 15 and negative
  signal. ID, agency, type and dates are preserved; the link points to the resource by ID in the
  official API, whose access also requires a key. A confirmed absence becomes `NOT_FOUND` and yields no
  bonus. The scoring engine comes later.
- CPF, names of the sanctioned party/PessoaDTO, contacts, links provided in the response and free texts
  go into neither the cache nor the raw record. Sanctions whose end date has already passed but are
  still returned by the source remain as historical records; confirming that the record exists does not
  assert that it is legally in force.
- Failure, timeout, 401/403/404/429 or a partial response do not prove absence. Without a previous
  response, the source stays `UNKNOWN`; previous responses are preserved and age into `OUTDATED`. One
  source may answer even when the other fails. Without a job, the raw record has no `ingestion_run_id`;
  each call remains audited by source, CNPJ and origin in the request log.

---

[Documentation index](README.md) · ← [10. External sources (adapters)](10-External-Sources.md) · [12. IBAMA](12-IBAMA.md) →
