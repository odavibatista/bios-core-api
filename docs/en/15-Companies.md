# 15. Companies

🇧🇷 [Português](../15-Empresas.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [14. SDG indexes](14-SDG-Indexes.md) · [16. API keys and public API](16-API-Keys.md) →

> Lookup by CNPJ, full profile, search and XLSX export.

**On this page**

- [Company lookup by CNPJ](#company-lookup-by-cnpj)
  - [Queue consumer and job contract](#queue-consumer-and-job-contract)
- [Full company profile](#full-company-profile)
- [Company search (name and filters)](#company-search-name-and-filters)
- [Exporting the list to XLSX](#exporting-the-list-to-xlsx)

## Company lookup by CNPJ

`GET /companies/:cnpj` returns the registration profile (UC06, RF03, RF05, RF06): legal name, trade
name, registration status, size, address and main and secondary CNAEs with their descriptions. It
requires a session. Data about partners and directors does not exist in the profile (INL02).

- **CNPJ.** Validated by format and check digits; accepts the numeric one and the **alphanumeric** one
  (issued by Receita since July 2026) and is normalized (no punctuation, uppercase) before becoming a
  cache, job and query key. Invalid: `422 INVALID_CNPJ`. The mask's slash must be encoded (`%2F`) or
  left out, because it separates URL segments.
- **The lookup does not talk to the providers: it asks the queue.** Resolution, from cheapest to most
  expensive:
  1. **cache** (Redis, `company-profile` namespace), immediate response (NFDE02);
  2. **database**: a registration stored within the `data_sources.cache_ttl_seconds` window of the
     source that answered it, served without an external query and put back in the cache (NFDE01);
  3. **queue**: publishes the job and waits, with a deadline (`QUEUE_WAIT_TIMEOUT_MS`). It is served by
     `CompanyProfileProcessor`, hosted in the core (described below). The two sides talk only through
     the queue (`14-Projeto-e-Arquitetura.md`, section 2), which makes it possible to move it to its own
     process without touching the lookup.
- **Graceful degradation (NFCO01).** With the providers unavailable (failed job, exceeded deadline,
  Redis down, result outside the contract), the stored registration is served even if expired, with
  `refreshed_at` showing its age, and it does **not** go back to the cache. Without a stored
  registration: `503 COMPANY_DATA_UNAVAILABLE`, which is not to be confused with
  `404 COMPANY_NOT_FOUND` (the providers confirmed that the CNPJ does not exist).
- **One job per CNPJ per minute.** The `jobId` is `company-profile-<cnpj>-<60 s window>`: simultaneous
  requests, and repeated ones within the minute, share the job **and the result**, which saves the
  sources' rate limit (NFPD01). The window exists because BullMQ ignores the publication of a `jobId`
  that already exists and failed jobs are kept: with a fixed id per CNPJ, a single failure would block it
  forever.

### Queue consumer and job contract

`CompanyProfileProcessor` (`companies/infra/queue/`) consumes the `company-profile` queue
(`QueueName.COMPANY_PROFILE`), with up to 5 CNPJs at a time. Per job:

| Item | Value |
| --- | --- |
| Job name | `fetch-company-profile` |
| Payload | `{ "cnpj": "<14 canonical characters>" }` |
| Effect | Goes through the provider chain, completes the CNAEs with IBGE's description, masks CPFs and writes `company_profile` |
| Return | `{ "outcome": "FOUND" }`, `{ "outcome": "NOT_FOUND" }` or `{ "outcome": "SOURCES_UNAVAILABLE" }` |
| Failure | Our error (e.g. database down): propagates, and the queue retries it (3 attempts, exponential backoff) |
| Malformed job | Unknown name or a CNPJ that is not canonical and valid: `UnrecoverableError`, **without retry** |

"Providers unavailable" is a **result**, not an error: the one waiting is a user, and retrying behind
their back does not help. The requester validates the return against the schema
(`CompanyProfileJobResultSchema`): a response outside the contract is treated as an unavailable source.

`RefreshCompanyProfileUseCase` does, in this order:

1. **Provider chain** (`ReceitaDataSource`): registration and the provider that answered.
2. **Official CNAE descriptions** (`ResolveCnaeDescriptionsUseCase`, IBGE): replaces the provider's, so
   the same activity has the same text whatever the source. The descriptions are cached
   (`cnae-description` namespace, the `IBGE_CNAE` window, 30 days in the seed), so a new company with
   known CNAEs does not call IBGE. At the first "unavailable", the round stops querying the remaining
   codes; without the official description, the provider's applies, and the registration is written all
   the same.
3. **Masked CPF (INL02).** Receita records the legal name of sole proprietors and MEIs (individual
   micro-entrepreneurs) as `NAME 12345678901`. Every sequence of 11 digits (with or without CPF
   punctuation) becomes `***` in the legal name and the trade name. The entrepreneur's name is public by
   law; the CPF does not need to be. Only legal entities reach the database: the ownership structure,
   email and phones are never read by the adapters.
4. **Content hash.** `content_hash` is the SHA-256 of name, status, size, address and activities (CNAEs
   in code order). Left **out** of it are the provider, the moment and the municipality's IBGE code (only
   some providers report it), so switching providers does not change the hash. If the content changed,
   the stored hash becomes `previous_content_hash`; refreshing an identical registration preserves the
   history of the last change.
5. **Municipality IBGE code.** OpenCNPJ does not report it; if the municipality is the same as in the
   stored profile, the known code is kept.
6. **Writes and discards the profile cache**, so the next read brings the new data. A field that no
   longer exists in the source (the trade name, for example) is written as `null`, not omitted, so the old
   value does not linger.

The environmental profile (UC07: evidence and index per SDG) accompanies this response since #81; see
"Full company profile".

## Full company profile

`GET /companies/:cnpj` (dashboard, session) and `GET /v1/companies/:cnpj` (public API, key) return the
**full profile** (UC06 + UC07, RF05–RF12, #81): the registration, the environmental evidence and, per
SDG, the index, the confidence and the explanation, in a single response.
`GetCompanyFullProfileUseCase` (`environmental-intelligence` module) composes the three parts; the
profile controllers live there, not in `companies`, because the companies module does not depend on
the environmental orchestration.

```jsonc
{
  "cnpj": "11222333000181",          // registration at the root, with the same fields as before
  "legal_name": "…", "main_cnae": { … }, "refreshed_at": "…",
  "evidences": [                      // by category, with the original source's reference
    { "category": "INFRACAO_AMBIENTAL", "evidences": [ { "source_slug": "IBAMA", "state": "CONFIRMED", "source_reference": "AI-001", … } ] }
  ],
  "ods_scores": [                     // active SDGs, in number order
    {
      "ods_number": 15,
      "calculation_status": "CALCULATED",   // or "PENDING"
      "index_status": "AVAILABLE",
      "score_value": -45, "confidence_value": 0.62,   // side by side, never combined
      "evidence_count": 2, "coverage_status": "HAS_RECORDS", "sources_without_records": [],
      "rules_version": "rf10-rf11-v3", "calculated_at": "…",
      "contributions": [ { "evidence": { … }, "weight": 40, "signal": "NEGATIVE", "points": -40 } ]
    }
  ],
  "provenance": {
    "sources": [
      { "source_slug": "IBAMA", "origin": "PERSISTED", "evidence_state": "CONFIRMED" },
      { "source_slug": "CGU_CEIS", "origin": "PENDING", "evidence_state": null }
    ],
    "scores_pending": true,
    "retry_after_seconds": 30
  }
}
```

- **Order and failure.** Registration, then evidence (which asks for the index recalculation and waits
  within the queue deadline, #80), then indexes. Each step only runs if the previous one succeeded: an
  invalid CNPJ (422), a nonexistent company (404) and an unavailable registration without a stored copy
  (503) respond before any environmental collection. An environmental source that is down degrades on
  its own (`UNKNOWN` evidence, never a low score).
- **Total deadline.** `COMPANY_PROFILE_REQUEST_TIMEOUT_MS` (default 15,000 ms, range 2,000–60,000) bounds
  the wait of both routes. The registration gets the remaining deadline with a reserve for composing the
  response. If the environmental collection is still running, the API returns the persisted snapshot and
  the available indexes; the published jobs may finish later. Without a local registration and without a
  response from the providers within the deadline, the response is still 503, not 404.
- **Provenance.** Each source in `provenance.sources` carries `origin` (`COLLECTION`, `PERSISTED`,
  `PENDING` or `UNAVAILABLE`) and `evidence_state` (`CONFIRMED`, `NOT_FOUND`, `UNKNOWN`, `OUTDATED` or
  `null`). `NOT_FOUND` confirms the absence of a record in the queried source; `UNKNOWN` and `null` do not
  confirm absence. `scores_pending` flags an index not yet calculated, separate from each source's state.
  `retry_after_seconds` suggests 30 s for a pending collection or index, or 900 s for unavailability; it
  is `null` with nothing pending. The origin is a projection of the persisted snapshot and the collection
  dates, without writing new state to the database.
- **Embedded explanation.** `contributions` is the same explanation as
  `GET /companies/:cnpj/scores/:ods/explanation` (RF12), for public API users, who do not have the
  explanation route. The index is not a sustainability verdict (IND01) and SDGs 13 and 15 do not form an
  overall index.
- **`calculation_status = PENDING`.** An SDG without a stored snapshot, or whose snapshot is no longer
  auditable, comes out with every number null and no contributions: pending is never a low score (IND02).
  The recalculation (UC15) restores it. An infrastructure failure, on the other hand, propagates (it does
  not become pending).
- **Cache.** The environmental parts stay in the `company-evidences` and `company-scores` namespaces for
  5 minutes (`ENVIRONMENTAL_PROFILE_CACHE_TTL_SECONDS`), and only together and with every SDG
  calculated; the index recalculation deletes them (`OdsScoringProcessor`). With both cached, the lookup
  neither collects nor recalculates. The registration stays in the `company-profile` namespace.
- **The same snapshot as the evidence route (#334).** The `company-evidences` snapshot lives in the
  consolidation (`GetCompanyEnvironmentalEvidencesUseCase`), which both routes use: with it cached,
  `GET /companies/:cnpj/evidences` responds without collecting or recalculating, and the profile and the
  route show the same evidence until the next recalculation. The evidence route also writes the
  snapshot, but only after waiting for the recalculation to finish (`CALCULATED`), so the index already
  reflects what was stored; a recalculation past the deadline, or a lookup without waiting (public API),
  does not write it. The route still exists: it delivers the evidence with provenance without composing
  the index or the registration.
- **Limit.** The dashboard route has its own per-IP limit, default 60 lookups per minute
  (`THROTTLE_COMPANY_PROFILE_LIMIT`, #335): consolidating can trigger external collections, but a cached
  call is cheap. The public one counts per key (NFSE04).
- **Tests.** The e2e tests that only exercise registration, authentication or limits swap the
  consolidation for one that does not collect (`withoutEnvironmentalCollection`), so as not to download
  IBAMA's dumps; `company-full-profile.e2e-spec.ts` covers the real composition over what is stored.

## Company search (name and filters)

`GET /companies` lists the companies in the local base (UC06 flow 1.1 and UC08; RF04, RF13, RF14) by
name, state, municipality, CNAE and, for a selected SDG, minimum index and confidence, and sorts them by
that SDG's index; the user picks one and opens the profile at `GET /companies/:cnpj`. It requires a
session, like the lookup by CNPJ. The criteria are optional, but **at least one** is required (`name`,
`uf`, `city`, `cnae` or `ods`), and those provided add up: the company must meet all of them. A blank
field counts as not provided.

- **Only the local base.** No registration source (BrasilAPI, OpenCNPJ, Minha Receita) offers a search
  by name, so the search operates **only on profiles already stored**: a company nobody has looked up by
  CNPJ does not show up. The search never calls a provider or publishes a job
  (`SearchCompaniesUseCase`); whoever then opens it by CNPJ triggers the update, if the registration has
  expired.
- **What matches.** Approximation by **start of word**: a company is included when *each* typed word
  starts some word of the legal name or the trade name, in any order. `petro` finds
  `PETROLEO BRASILEIRO S A PETROBRAS`; `limpeza urbana` finds `URBANA LIMPEZA LTDA`; `leo` (middle of a
  word) does not. Case, accents and punctuation (`S.A.`) are ignored on both sides: the typed text is
  normalized (`extractNameTerms`: no accents, uppercase, only `A-Z`/`0-9`) and each letter becomes the
  class that accepts the registration's accented forms. Since the words only contain letters and digits,
  nothing the user types becomes a regular expression metacharacter.
- **Why a regular expression and not MongoDB's text index.** The text index only matches whole words
  (`petro` would not find `PETROBRAS`), which is weak for "name approximation". The `@@fulltext` index the
  schema had was **removed** (schema and DBML), as it was unused. The cost is a collection scan;
  acceptable because the base is only the companies already looked up. If it grows, the way forward is a
  normalized and indexed search field.
- **Query limits.** The text has up to 100 characters, at most 8 words count, and **at least one word with
  3 or more characters** is required (`a b do` is refused): without that, the search would scan the whole
  base. Otherwise: `422 VALIDATION_FAILED`.
- **Registration filters (#83).** They apply to `company_profile`, with or without a name:
  - `uf`: the code of one of the 27 federative units, in any case (`rj` means `RJ`); anything else is 422;
  - `city`: the municipality's **full name**, ignoring accents, case and punctuation (`sao paulo` finds
    `SÃO PAULO`, `santa barbara d oeste` finds `Santa Bárbara d'Oeste`), but not by start of word:
    `sao paulo` does not find `SAO PAULO DO POTENGI`. Without `uf`, it matches the municipality in any
    state; to disambiguate, provide the state;
  - `cnae`: 2 to 7 digits (division, group, class or subclass), with or without the mask (`6201-5/01`),
    treated as a **prefix** of the code of the main CNAE **or** of any secondary one. `62` finds every
    information technology company; `01` does not find `6201501`.
- **Selected SDG, minimum index and confidence (#83).** `ods` (1 to 17) selects the SDG that everything
  about the index refers to (UC08, rule 2). The search joins the `company_ods_scores` document of that SDG
  to the profile (`$lookup` by CNPJ and SDG number) and returns, for each company,
  `ods_score = { ods_number, score_value, confidence_value }`, with both values null when the company has
  no index calculated for that SDG. `min_score` (-100 to 100) and `min_confidence` (0 to 1) filter by
  `>=` and **require `ods`** (422 without it). A company without an index calculated for the SDG, or with a
  null index, does not pass `min_score`; without a document, it does not pass `min_confidence` either.
  The minimum `0` actually filters (it is not the same as "no filter"). Index and confidence come in
  separate fields and are never combined. Nothing that explains the index (contributions, rules, dates)
  comes out in the list: that belongs to the profile.
- **Sorting by the SDG's index (#84).** `order=asc` (lowest to highest index) or `order=desc` (highest to
  lowest), in any case; it requires `ods` (422 without it) and applies to the selected SDG, not to the
  other one. **Those without an index always go to the end, in both directions**: the absence of an index
  (no document or a null score) is neither the lowest nor the highest index, and the index `0` is an
  index, sorted between the negative and the positive ones. Among equal indexes, the highest confidence
  comes first (in both directions) and the CNPJ breaks ties, which makes pagination stable. **Those
  without an index** come after all those with one, by legal name and CNPJ (their confidence does not
  count). Sorting by index takes precedence over the priority of the typed phrase. The auxiliary field
  `score_missing` (and `sort_confidence`/`sort_name`) never comes out in the response.
- **How the search with an SDG runs (#328).** The cost of reading a company's index is that of a
  `$lookup`, and starting from the profile and joining the index of **every** company before paginating
  cost about 0.14 ms per company (2.7 s for 20,000). That is why there are three paths, chosen by what the
  query asks for (`CompanyProfileRepository.search`):
  1. **From the profile** (`company-search.pipeline.ts`): no SDG, with a **name**, or with an SDG that only
     appears in the response (no minimum and no sorting). In this last case the `$lookup` runs **after**
     pagination, only for the page (from ~870 ms to ~20 ms over 6,000 companies);
  2. **From the indexes** (`company-scored-search.pipeline.ts`): SDG with a minimum (no sorting), no name.
     It filters `company_ods_scores` by the denormalized fields (`uf`, `city`, `cnae_codes`) and by the
     minimums, joins the profile and sorts by legal name;
  3. **In two segments**: SDG with sorting, no name. First the companies **with a score**, straight from
     the compound index (`idx_company_ods_scores_ods_*`), paginating before joining the profile; then those
     **without a score**, read from the profile only when the page reaches them. The total is the sum of
     both.
  - **A non-null `uf` separates those with a profile from those with only an index.** The IBAMA ingestion
    recalculates the index of companies nobody looked up; they have no location (`replaceForCompany`
    writes the profile's) and are **not part of the search base** (UC08, rule 1). Without that cut, with
    30,000 orphan indexes the count went from 100 ms to 880 ms. They never enter the list, however high
    the score.
  - **Consistency.** The indexes' location is eventually consistent: the recalculation updates it (the
    profile update asks for it), and that is why a company that changes state only shows up in the new
    state after the recalculation. The `company-search-equivalence.e2e-spec.ts` test compares the three
    paths with an in-memory oracle (over a hundred combinations of criteria, SDGs, minimums, order and
    windows, including the seam between the two segments), and `company-search-performance.e2e-spec.ts`
    fails if the whole-profile scan comes back.
- **Default order.** First those that *start* with the typed phrase (the words in the typed order, at
  the beginning of the legal name or the trade name); then the others. Ties are broken by legal name and
  CNPJ, which makes pagination stable. `ambev` lists `AMBEV S.A.` before `DISTRIBUIDORA AMBEV`. Without a
  name, the list comes by legal name and CNPJ. With `order`, the sorting by the SDG's index applies, as
  described above.
- **Response.** `{ data, pagination }`, with `pagination = { page, page_size, total, total_pages }` (the
  listing standard, in `pagination.dto.ts`; `page_size` up to 100, default 20). Each item is the summary
  needed to recognize the company: `cnpj`, `legal_name`, `trade_name`, `registration_status`, `city`,
  `uf`, the main CNAE and `ods_score` (null when the search does not select an SDG). Nothing found is
  `200` with `data: []`, not `404`; a page past the end brings the empty list and the correct `total`.
- **Personal data (INL02).** The search reads the stored legal name, which has the sole
  proprietor's/MEI's CPF masked (`***`). So typing a CPF does not find the owner, and their name (public by
  law) can still be found.
- **A single aggregation.** The pipeline's `$facet` (`company-search.pipeline.ts`) returns the window and
  the total count in a single round trip to the database; the response is validated against the schema
  before leaving the repository.

## Exporting the list to XLSX

`GET /companies/export/xlsx` (UC09, RF15, #85) returns, in an XLSX file, the list the company search
would return. It requires a session. It accepts the **same criteria and the same sorting** as
`GET /companies` (`name`, `uf`, `city`, `cnae`, `ods`, `min_score`, `min_confidence`, `order`), with the
same rules and the same "at least one criterion" (422), but **without pagination**: `page` and
`page_size` are ignored, and the file carries the whole list. The translation of the criteria for the
repository is a single one (`toSearchInput`), so what is downloaded is what the screen shows.

- **Content.** One line per company, in the search order: CNPJ, legal name, trade name, registration
  status, state, municipality, main CNAE and CNAE description and, **in separate columns for each active
  SDG**, `ODS n - Índice` and `ODS n - Confiança` (index and confidence, RF15). The index columns cover
  **every** SDG, not only the one selected in the search: the spreadsheet is for comparing companies.
  What was not calculated is an **empty cell**, not zero; the index `0` is written as `0`. Index and
  confidence are never combined.
- **No personal data (INL02).** Only the fields above, which already belong to legal entities: the sole
  proprietor's/MEI's name comes out with the CPF masked (`***`), and street address, hashes, registration
  source, internal dates and index rules are not in the file.
- **Text is text.** Text cells are written as text (the XLSX shared strings table), never as a formula: a
  legal name such as `=HYPERLINK(...)` shows up literally and is not executed when opened in Excel. The
  CNPJ, including the alphanumeric one and those with leading zeros, is also text.
- **No result, no file.** No company meets the criteria: `404 NO_RESULTS_TO_EXPORT` (UC09 requires at
  least one result), not an empty spreadsheet.
- **Company ceiling: `EXPORT_MAX_COMPANIES` (default 5000, from 1 to 20000; #336).** Above it,
  `422 EXPORT_TOO_LARGE` with `details = { total, max }`: the file is built in memory, and the base is the
  companies already looked up; refining the criteria solves it. It refuses to export rather than silently
  truncate. The ceiling comes from configuration (NFSE04, h), like the other operational limits.
- **End-to-end measured cost (#336).** HTTP, database (local Mongo 8.3.11), reading the indexes of every
  active SDG and building the spreadsheet, synthetic data, 2 SDGs, best of 3 runs:

  | Companies | Criterion | Time | File | Memory (RSS / heap) |
  | --- | --- | --- | --- | --- |
  | 5,000 | `uf` | 565 ms | 0.25 MB | +28 / +27 MB |
  | 5,000 | `ods=15&order=desc` | 778 ms | 0.24 MB | +42 / +32 MB |
  | 20,000 | `uf` | 2.2 s | 1.00 MB | +83 / +111 MB |
  | 20,000 | `ods=15&order=desc` | 3.1 s | 0.91 MB | +81 / +117 MB |

  The default stays at 5000 out of caution with concurrency: the limit of 10 exports per minute per IP
  allows ten simultaneous exports, and ten of 20,000 companies would add up to more than 1 GB of heap,
  against ~300 MB with 5,000. Whoever raises the ceiling should size the instance's memory. Writing the
  file as a stream (`toStream`) instead of building the buffer is only justified above 20,000, which the
  maximum ceiling does not allow; it stays as a recorded alternative.
- **The indexes are read in blocks of 100 (#336).** The measurement found the cost outside the
  spreadsheet: Prisma's `in` with 5,000 CNPJs took 5.7 s for 10,000 rows (the same query directly on
  MongoDB, 170 ms), which made exporting 5,000 companies take 6.4 s (8.0 s with a sorted `ods`). In blocks
  of 100, read in parallel (`SUMMARY_CHUNK_SIZE`), the read dropped to ~130 ms and the export to the
  numbers in the table. The spreadsheet itself was always cheap (372 ms for 5,000 rows).
- **Response.** `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  `Content-Disposition: attachment; filename="empresas-bios-YYYY-MM-DD.xlsx"` and `Content-Length`. The
  sheet is called `Empresas`, with the header in bold and frozen at the top, columns with widths and index
  and confidence with two decimal places (the stored value is not rounded).
- **Rate limit.** 10 exports per minute per IP (`THROTTLE_COMPANY_EXPORT_LIMIT`), because each call
  builds a file.
- **Only reads the local base.** Like the search, it does not call a source or publish a job. The route
  lives at `/companies/export/xlsx` (and not at `/companies/export`) so it never competes for the path
  with `GET /companies/:cnpj`.
- **Library.** `write-excel-file` (one dependency, `fflate`), which writes the XLSX's ZIP and XML without
  loading the spreadsheet into memory as heavy objects. `fflate` is also a direct development dependency,
  so the tests can open the file and check the cells (`test/support/xlsx-reader.ts`).

---

[Documentation index](README.md) · ← [14. SDG indexes](14-SDG-Indexes.md) · [16. API keys and public API](16-API-Keys.md) →
