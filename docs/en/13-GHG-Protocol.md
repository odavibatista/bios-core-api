# 13. GHG Protocol inventory

🇧🇷 [Português](../13-GHG-Protocol.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [12. IBAMA](12-IBAMA.md) · [14. SDG indexes](14-SDG-Indexes.md) →

> Emissions inventories from the GHG Protocol Public Registry (UC07).

`GhgModule` exports `GetGhgCompanyEvidencesUseCase.execute(cnpj)`. It reuses the valid local evidence or
publishes `fetch-ghg-inventory` on the exclusive `ghg-inventory` queue and waits for
`data_sources.request_timeout_ms` (default 10 s). A timeout, a failed job or Redis being unavailable
preserve the previous response; without one, `UNKNOWN`. The job may finish after the caller's timeout.
The consolidation already gathers GHG since #75; exposure in the profile was delivered in #81. There is
no new endpoint or score.

The processor reads the legal name/trade name from the local profile to find up to three candidates in
the public catalog. The services used by the portal itself were checked in `assets/appconfig.json` and
in the public JavaScript: ABP JSON at
`registropublicodeemissoesapi.fgv.br/api/services/app/EstatisticaPublica/`
(`SearchAllOrganizations` and `GetReportedInventories?organizationId=...`) and PDF at
`sistema-registropublicodeemissoesapi.fgv.br/GenerateReport/GenerateInventoryReport/<org>/<cycle>/true`.
These are portal resources without a stable official REST contract. An error HTML page with HTTP 200,
HTTP 206/404, an envelope error, a report without identity or a mismatching year are accepted neither as
data nor as proof of absence.

**The organization registry is paginated.** The only route that lists it is `SearchAllOrganizations`, a
`POST` with the JSON body `{ maxResultCount, skipCount }` that responds `{ total, organizations }`.
Without `maxResultCount` it returns only **10** organizations, the maximum accepted is **1000** (above
that, HTTP 400) and a page past the end comes back empty, with the `total`. The `GetAllOrganizations`
route, which the first version used, is **not** the registry: it returns the same sample of 10
organizations, and taking it for the registry left the collection blind to almost every company (on
10/22/2026, the portal had 1029 organizations). An empty page before the total, a total above 20,000 or
a page outside the contract are an abnormal response (`UNKNOWN`), never data.

**The registry is synchronized once a day, and each CNPJ's collection reads it ready-made.** Each call to
the search takes about 3 s of fixed latency plus ~5 ms per item (a page of 1000 took ~7 s and weighs
~1.5 MB): the complete listing took ~11 s, more than the catalog's 10 s, and was redone for every
company. Today:

- **Synchronization.** The `sync-ghg-organizations` job (`ghg-inventory` queue, `ghg-organizations-sync`
  schedule, every day at 03:30) reads the registry in pages of **500** (each call takes ~5 s, well below
  the catalog's maximum time) with its own 120 s budget for the whole listing, and stores it in Redis
  (`GhgOrganizationDirectory`, `ghg-organizations` namespace: each organization's id and name, plus the
  date). Retry: 5 attempts, exponential backoff on a 1 min base (1, 2, 4 and 8 min); a disabled source
  fails on the first one, without retrying. The calls enter the request log as `SCHEDULED_JOB`, without
  a CNPJ.
- **It only writes when complete.** The new registry replaces the previous one only after every page has
  been read and is valid; a failure, a response outside the contract or an empty page before the total
  write nothing, and the previous registry stays in force.
- **It is valid for seven days.** Consecutive failures of the daily synchronization do not blind the
  collection right away. It is a cache, not a source of truth: it lives in Redis and can be rebuilt from
  the source, so **there is no collection or migration**. If it is missing (first run, Redis cleared), the
  first collection that needs it synchronizes it on the spot, before that collection's deadline starts
  counting, and the following ones reuse it; since the collection may then exceed the waiting caller's
  deadline, the result shows up on the next query, without repeating the listing.
- **A CNPJ's collection does not list the portal.** It finds the candidates in the stored registry and
  only then fetches the inventories and the report (2 calls). A company without an organization in the
  registry makes **no** external call and stays `UNKNOWN` (15 min window): that is why there is no
  separate negative cache.
- **Catalog deadline.** The 10 s `request_timeout_ms` is now enough: it applies to each call and to the
  CNPJ's flow (inventories + PDF), without the listing. **Measured against the real portal (10/22/2026),
  with the catalog's default 10 s deadline, without raising it:** the synchronization job, through the
  real worker, took **13.8 s** and stored the **1029** organizations (three calls, of 4.9 s, 5.7 s and
  3.0 s, all below 10 s); collecting two companies from organizations outside the first 10 (ids 5979 and
  8119, 2025 inventory) took **1.9 s and 1.1 s**, `CONFIRMED`, with two calls each and none to the
  listing; a company without an organization in the registry came back `UNKNOWN` in 0.2 s and **without
  any external call**.

The catalog carries no CNPJ. The name is only a hint: the exact CNPJ and the PDF's year must match the
company and the listed inventory. The most recent year is checked, without inferring historical coverage
or a link between companies of a group. Without a local registration, a candidate or a verifiable
inventory, `UNKNOWN` is recorded, with a new attempt after 15 minutes. An earlier expired response stays
`OUTDATED`.

Each collection uses a total deadline; each call also respects the common infrastructure's limit,
timeout and log. The PDF (at most 5 MiB) is read in its first three pages by `pdfjs-dist` in a
disposable thread, with a 128 MiB limit on the V8 heap and the remaining deadline. Only CNPJ,
organization, cycle and year come out of the extraction. The raw record is this reduced snapshot, without
contacts, the name of a responsible person or the full text; the temporary file is removed.
`published_at` stays null: the inventoried year is not a publication. The per-CNPJ cache keeps the same
snapshot for 30 days (the catalog's TTL), preserving `collectedAt`. A disabled source uses neither this
cache nor the network. Persistence applies the time guard per source/CNPJ; a portal failure does not
delete an earlier response.

The new seed points to the JSON host. Existing catalogs that still use
`https://registropublicodeemissoes.fgv.br` remain compatible: the adapter resolves both official hosts,
as the portal does. The seed does not overwrite configurations; to align an old database with the seed,
use `npm run catalog:sync` ([Source catalog](04-Database.md#source-catalog-loading-and-synchronization)).
No environment variable or schema migration was added.

**Hosts fixed in code (documented exception, #256).** The portal uses two hosts for the same service: one
for the API (`registropublicodeemissoesapi.fgv.br`) and another for the report download
(`sistema-registropublicodeemissoesapi.fgv.br`), and the catalog has a single `base_url`. That is why
`ghgBaseUrl` translates the two known official hosts to the right host for each call, and the report's
public link (`toGhgEvidence`) is also fixed. **In practice, the catalog only decides the address when it
is not one of the official hosts** (that is how the tests point to a local server). Moving the report
host into the catalog would require a new column in `data_sources` (schema and DBML) only for a value
the portal fixes; if the portal ever changes host, the change is one line in `ghgBaseUrl` and in
`toGhgEvidence`, covered by the contract test (`npm run test:contract`), which flags the host that
stopped responding.

---

[Documentation index](README.md) · ← [12. IBAMA](12-IBAMA.md) · [14. SDG indexes](14-SDG-Indexes.md) →
