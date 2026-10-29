# 14. SDG indexes

🇧🇷 [Português](../14-Índices-por-ODS.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [13. GHG Protocol inventory](13-GHG-Protocol.md) · [15. Companies](15-Companies.md) →

> Adherence index and confidence, queue-based recalculation, explanation, SDG catalog and sector trends.

In the code and in the API, the Sustainable Development Goals (SDGs) are called by their Portuguese
acronym, **ODS** (`ods`, `ods_number`, `GET /ods`).

**On this page**

- [Adherence index per SDG (RF10)](#adherence-index-per-sdg-rf10)
- [Recalculating the indexes through a queue (UC15, #80)](#recalculating-the-indexes-through-a-queue-uc15-80)
- [Explanation of the index per SDG (RF12)](#explanation-of-the-index-per-sdg-rf12)
- [SDGs that BIOS calculates (GET /ods)](#sdgs-that-bios-calculates-get-ods)
- [Sector trends (UC10, RF30, #89/#90)](#sector-trends-uc10-rf30-8990)

## Adherence index per SDG (RF10)

`CalculateCompanyOdsScoresUseCase` recalculates, per CNPJ, every active SDG loaded from the catalog and
atomically replaces the company's documents in `company_ods_scores`. Each document stores
`score_value`, `confidence_value`, `evidence_count`, contributions by evidence ID,
`rules_version = rf10-rf11-v3`, the calculation date and, when there is a registration profile, state,
city and CNAEs. The recalculation preserves the ID and the creation date of existing documents and
removes the score of a deactivated SDG. An active SDG without an explicit rule stops the calculation
before writing.

The scale is signed, from −100 to 100, with no overall index: SDG 13 gets +60 per confirmed and
traceable GHG inventory, with a +100 cap; SDG 15 gets −40 per IBAMA infraction (cap −80) and −5 per
CEIS/CNEP sanction (cap −20). The sum of the contributions' `points` reproduces `score_value` exactly;
the caps keep many administrative sanctions from outweighing the direct environmental signal. A
CEIS/CNEP sanction whose `endDate` is earlier than the current calendar day in São Paulo weighs −1.25;
an embargo term with `details.lifted = true` weighs −10. The reduced weight and the reason are kept in
the snapshot and in the explanation; infraction notices and records in force keep the full weight. The
collection's validity remains independent of the end of the sanction. The two indexes are neither
comparable with each other nor sustainability verdicts.

Only a current `CONFIRMED` evidence, with a non-empty identifier or a valid HTTPS URL, produces a
contribution. `NOT_FOUND` gives no bonus; `UNKNOWN`, `OUTDATED`, an inconsistent signal and a
confirmation without a reference do not score. Without contributions, `score_value` is null. The RF11
confidence lives in a separate field, between 0 and 1, and is zero without a confirmed contribution.
With contributions, it is `cap × (S/M) × (N/(N+1)) × ((1+Q)/(2+Q)) × (S/(S+U+O))`: `N` is the number of
contributions; `M` is the number of sources expected for the SDG; `S` are the sources that answered with
a traceable `CONFIRMED` or a current `NOT_FOUND`; `Q` adds up the quality of the confirmed findings
(IBAMA 1, CEIS/CNEP 0.25, GHG 1); `U` and `O` count sources with `UNKNOWN` and `OUTDATED`, respectively.
The cap is 0.25 for SDG 13, because of its low structural coverage, and 1 for SDG 15. `NOT_FOUND` only
widens coverage when a finding already exists, without scoring. A source without a response does not
widen coverage; a wrong signal or a finding without traceability adds no quality. The composition in the
profile and the complete public API were delivered in #81 (see [Full company profile](15-Companies.md#full-company-profile)).

## Recalculating the indexes through a queue (UC15, #80)

The engine above runs inside a job on the `ods-scoring` queue, `recalculate-scores(cnpj)`, consumed by
`OdsScoringProcessor` (`scoring/`). Whoever needs a new index **asks** for it; nothing calls the engine
directly in the ingestion or query flow. `RequestScoreRecalculationUseCase` publishes the request and
`RequestScoreRecalculationBatchUseCase` the one for several companies (in batches of 25 publications at a
time; a repeated CNPJ counts as one request).

**Triggers** (the three in the issue):

| Trigger | When it asks | Does it wait? |
| --- | --- | --- |
| IBAMA ingestion (UC14, step 5) | The daily batch, after `batch.finish()` and **before** marking the run `SUCCEEDED`: one job per **affected** company (written or with evidence removed by the load). The on-demand collection by CNPJ too. An identical dump (`SKIPPED_UNCHANGED`) asks for nothing. | no |
| On-demand query (UC07, diagram 3) | `GetCompanyEnvironmentalEvidencesUseCase`, with the sources consolidated and before rereading the evidence. | **yes**, up to `QUEUE_WAIT_TIMEOUT_MS`: an exceeded deadline or a failed job **degrade** (the query responds, the index stays as it was) |
| Registration profile update | `RefreshCompanyProfileUseCase`, after writing the registration: the state, city and CNAEs denormalized into the indexes are rewritten by the recalculation. | no |

Asking **never fails** the requester's flow: queue down, deadline or failed job become `DEGRADED` and a
warning (only the error type, without the CNPJ). The index is derived and reproducible.

**Coalescing and ordering.** The `jobId` is `scores-<cnpj>` with `coalesce` (see [Queues](05-Queues.md)):
simultaneous requests become a single job, and a request made after the job finished creates another one
(it never returns a stale result). Since the active job and its follow-up can exist at the same time,
**the index never regresses**: `calculatedAt` is the moment the evidence was **read** (taken before
reading), and `replaceForCompany` does not write if there is already an index for the company calculated
after that moment (it returns `false`).

**Idempotency.** Re-running without changes in the evidence produces the same result (only the
calculation moment moves forward).

**Rules version.** `ODS_SCORE_RULES_VERSION` is stored in each index. Changing it leaves the old indexes
on the old version, and the scheduled job `recalculate-stale-scores` (every day at 05:30, after the IBAMA
ingestion; `ods-stale-rules-sweep`) re-enqueues, by CNPJ cursor and in pages of 200, the companies with an
index from another version. It can be resumed (the company leaves the list when its index is rewritten)
and, if the queue refuses any request, it fails at the end so BullMQ retries it. To bring it forward,
publish the same job on the `ods-scoring` queue (`recalculate-stale-scores`, no payload).

**Cache.** At the end of each recalculation, `company-profile`, `company-evidences` and `company-scores`
are deleted for the CNPJ. The source snapshots (`cgu-ceis`, `cgu-cnep`, `ghg-inventory`) **stay**: they do
not depend on the index, and deleting them (as `CacheProvider.invalidate`, which clears everything of the
CNPJ, would) would force new external queries on every recalculation.

**Failures.** A malformed job and an environment without an active SDG (or an SDG without rules,
`ScoringNotConfiguredError`) are **unrecoverable**: they fail right away, without the queue's 3 attempts,
and whoever is waiting is notified without waiting for the deadline. Other failures are retried (3
attempts, exponential backoff of 1 s).

**Known limitations.** Evidence that arrives **after** the query's deadline (GHG or CGU finishing in the
worker after the query has already responded) only enters the index on the next query or the next
recalculation; those workers do not ask for a recalculation on their own. Evidence that becomes
`OUTDATED` merely because time passes does not trigger a recalculation either.

## Explanation of the index per SDG (RF12)

`GET /companies/{cnpj}/scores/{odsNumber}/explanation` requires a JWT session and reads the snapshot
already stored in `company_ods_scores`, without collecting from the sources or recalculating the index.
The response carries `score_value` and `confidence_value` separately, `rules_version`, the calculation
date and the contributions in deterministic order. Each contribution links the evidence ID to the
source's public name and slug, category, original reference or HTTPS URL, signal, weight and effective
points. `state` is `CONFIRMED` at the time of the calculation; `current_state` tells whether the evidence
has become `OUTDATED` since then. The sum of the points reproduces the index. CEIS/CNEP sanctions keep
the `CONDUTA_ADMINISTRATIVA` category.

An index calculated without contributions responds 200 with `index_status = UNAVAILABLE`,
`score_value = null` and an empty list. A company/SDG without a stored score responds 404. The response
also carries `coverage_status` (`HAS_RECORDS`, `NO_RECORDS_IN_ALL_SOURCES`, `NO_RECORDS_IN_SOME_SOURCES`
or `NO_DATA`; null in snapshots from before the recalculation) and `sources_without_records`, which tell
"queried and without records" apart from "no data" without scoring or creating confidence for the
absence (decision of #253, in bios-docs 14 §4.2). A `coverage_status` inconsistent with the
contributions responds 409. An orphan or inconsistent contribution, or one without auditable provenance,
responds 409, so as not to present a partial explanation as complete. The response does not classify the
company as sustainable or unsustainable.

## SDGs that BIOS calculates (`GET /ods`)

`GET /ods` (RF10, #332) lists the **active** SDGs in the `ods` collection, ordered by number, with
`ods_number`, `title` and `description` (currently 13 and 15). It requires a session. This is where the
front end's selector gets its options: a list from 1 to 17 would "work" and show nothing, because BIOS
only calculates the reference SDGs.

- **The same set applies to search and export.** `ods` in `GET /companies` and in
  `GET /companies/export/xlsx` is checked against the active SDGs (`EnsureActiveOdsUseCase`). A
  nonexistent or deactivated SDG responds **422 `ODS_NOT_AVAILABLE`**, with `details.ods` and the list of
  valid ones in `details.valid_ods`. Before, `?ods=7` responded 200 with a null index and
  `?ods=7&min_score=50` responded 200 with an empty list, indistinguishable from "no company matches".
  Deactivating an SDG (`is_active = false`) removes it from `GET /ods` and makes the search refuse it,
  without restarting the API (the check reads the collection on every request with `ods`; the collection
  has at most 17 documents).
- **An active SDG without an index for the company is still 200.** `?ods=13` returns `ods_score` with
  null values for a company that does not have an index on 13 yet: it is the absence of a calculation
  *for the company*, and a search by an active SDG never stops accepting the criterion.
- **pt-BR labels for the enums (recorded decision).** The contract keeps returning the enum values
  (`EvidenceCategory`, `EvidenceState`, `EvidenceSignal`, `coverage_status`, `calculation_status`,
  `weight_reason`) and **not** a dictionary of labels: the Angular app is the only consumer with
  user-facing text, and the client generated from OpenAPI (#330) types each enum, so a
  `Record<EvidenceState, string>` in the front end fails to compile if BIOS gains a new value. A
  dictionary in the API would create a second source to keep in step with the enums and would not serve
  the other consuming APIs, which work with the codes. If a second client with a UI comes to exist, the
  decision is reopened.

## Sector trends (UC10, RF30, #89/#90)

The time series is **only for sectors** (`sector_score_snapshots`, indicator IA05): no company index is
stored over time or exposed here.

- **`aggregate-sector-scores` job** (`ods-scoring` queue, `sector-score-snapshots` schedule): aggregates
  `company_ods_scores` by SDG and **division of the main CNAE** (2 digits, read from the registration
  profile; companies without a profile are left out), only with the indexes of the current rules
  version. It writes, in the window of the **current month** (UTC), the average index (of companies with
  an index), the average confidence (of all of them), the counts and the rules version. Re-running in the
  same month overwrites that month's snapshot (unique index per SDG, sector and window start), and a
  sector that no longer has companies leaves the window. Once the month turns, the previous one stays as
  it was.
- **Schedule:** `SECTOR_SNAPSHOT_CRON` (default `0 6 * * *`, after the 05:30 rules sweep). A schedule's
  `cronSetting` field makes the registration read the cron from the variable instead of the default.
- **Minimum sample** (`SECTOR_SNAPSHOT_MIN_COMPANIES`, default 5): with fewer companies with an index, the
  average index is null; with fewer companies in the sector, the average confidence too. The counts stay.
- **`GET /sectors`** (`[P08]`): UC10's sector selector (normal flow 1). It lists the CNAE divisions with at
  least one stored window, in ascending order, with the official description (`{ data: [{ cnae_division,
  description }] }`). Only sectors, never companies.
- **`GET /sectors/{cnae}/evolution?ods=`** (`[P08]`, any user with a session): the CNAE may be the
  division, the group, the class or the subclass, with or without a mask, and becomes the division, which
  must exist in CNAE 2.3 (division `04`, for example, does not exist). It returns the division with the
  official description (`cnae_division_description`, RF06) and the windows from oldest to newest; with
  fewer than two, `history_status: INSUFFICIENT` (flow 2.1). The SDG is required; an SDG that BIOS does not
  calculate, `422 ODS_NOT_AVAILABLE` with the valid ones; an invalid CNAE or a nonexistent division,
  `422`.
- **Division descriptions:** the 87 divisions of CNAE 2.3, with IBGE's description
  (`servicodados.ibge.gov.br/api/v2/cnae/divisoes`), live in the code (`scoring/domain/cnae-divisions.ts`).
  The taxonomy only changes in a CNAE revision, so it is not queried on every request; the `IBGE_CNAE`
  source still describes the subclass in the company profile.

---

[Documentation index](README.md) · ← [13. GHG Protocol inventory](13-GHG-Protocol.md) · [15. Companies](15-Companies.md) →
