# 10. External sources (adapters)

🇧🇷 [Português](../10-Fontes-Externas.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [09. Transactional emails](09-Emails.md) · [11. Evidence](11-Evidence.md) →

> Adapters for the public sources, the registration fallback chain and the CNAE descriptions.

**On this page**

- [Registration: CadastralRecord and the BrasilAPI adapter](#registration-cadastralrecord-and-the-brasilapi-adapter)
- [Registration fallback chain](#registration-fallback-chain)
- [CNAE descriptions: IBGE](#cnae-descriptions-ibge)

Each external source sits behind its own adapter, which implements the `DataSourceInterface` contract
(`data-sources/domain/data-source.interface.ts`, NFPD02). The adapter says **what** to query and how to
read the response; what is common to every source lives in `RequestDataSourceUseCase`, exported by
`DataSourcesModule`.

- **Everything comes from the catalog** (`data_sources`), read on every call: base URL, `is_enabled`,
  `rate_limit_per_minute` and `request_timeout_ms`. Disabling a source or changing its limit applies on
  the next call, without a new deploy.
- **Limit per minute (NFPD01).** A **sliding** 1-minute window in Redis, atomic (Lua script) and shared
  by every instance and worker. A fixed window would allow a burst at the end of one minute added to
  another at the start of the next, twice what the source accepts. Once the ceiling is reached, the
  source is not called (`RATE_LIMITED`). **Without the counter (Redis down), it is not called either**:
  unlike the API's own limit, which lets the request through, here the cost of getting it wrong is the
  source blocking BIOS.
- **Maximum time.** The source's `request_timeout_ms` (10 s by default) applies to the whole call, body
  included; once exhausted, `TIMEOUT`.
- **HTTP client.** Node's `fetch`, without redirects (the address comes from the catalog, and following a
  `Location` would take the call wherever the source pointed) and with the body limited to 5 MiB, read
  as a stream (the batch dumps, which exceed that, use the `download` mode, described in the IBAMA
  section). Path segments are encoded when the URL is built: a value such as `../admin` does not escape
  the source's path. The query is a `GET`, except when the request provides `body`: then it is a `POST`
  with that body as JSON (`content-type: application/json`), with the same guarantees (deadline, limit
  per minute, no redirects, bounded response). It only exists for sources whose search has no `GET`,
  such as the GHG organization listing; the body, like the headers, never goes to the log.
- **Request log.** Each call becomes a line in `data_source_request_logs`: source, CNPJ, origin
  (`trigger`), result, HTTP status and duration. Those refused by the limit are recorded too, with no
  status. Headers (the source's API key, for example) are never stored. Failing to write the log does
  not lose the call.
- **Failures are responses, not exceptions.** The use case returns `SUCCESS`, `NOT_FOUND` (HTTP 404, a
  valid response), `FAILURE`, `TIMEOUT`, `RATE_LIMITED` or `DISABLED`, and the caller (the fallback
  chain, the job) decides what to do. The exception is a source missing from the catalog, which is a
  programming error (`UnknownDataSourceError`).
- **`toLookupResult`.** Converts the response into the adapter's result (`FOUND`, `NOT_FOUND` or
  `UNAVAILABLE`, with the reason). A 2xx body outside the expected format becomes `UNAVAILABLE`, never
  data.

## Registration: `CadastralRecord` and the BrasilAPI adapter

The three registration providers (BrasilAPI, OpenCNPJ, Minha Receita) deliver the same
`CadastralRecord` (`data-sources/domain/dtos/providers/cadastral-record.dto.ts`): canonical CNPJ, legal
name, trade name, uppercase status and size, address, main and secondary CNAEs. The common normalizers
(`cadastral-normalizers.ts`) make the same registration come out identical from any of them: CNAE and
IBGE codes with 7 digits and CEP with 8 (the leading zeros the provider lost by sending a number come
back), state in 2 letters, empty becomes `null`.

`BrasilApiDataSource` (`brasil-api/`, slug `BRASIL_API`, priority 1 in the chain) queries
`GET {base_url}/{cnpj}` through `RequestDataSourceUseCase` and converts the response:

- **Allowlist of fields.** The schema only reads what the profile uses. The ownership structure (`qsa`:
  names and CPFs of partners and representatives), email, phone, tax regime and share capital are never
  read, so there is no way for them to reach BIOS (INL02).
- **A response for another CNPJ is rejected.** If the CNPJ in the body is not the one queried, the
  result is `UNAVAILABLE`: storing another company's registration under the requested CNPJ would be
  worse than having no data. The same goes for a body without legal name, status, main CNAE,
  municipality or state.
- **Provider quirks.** A secondary CNAE item with code `0` means "no secondaries" and is discarded (as
  are duplicates and one equal to the main CNAE). The street type (`AVENIDA`) comes separately from the
  name (`PAULISTA`) and is joined to it. The status comes from the description or, failing that, from
  the Receita code. The CNAE description may come empty: IBGE fills it in (RF06).

`OpenCnpjDataSource` (`opencnpj/`, slug `OPEN_CNPJ`, priority 2, first fallback) follows the same
pattern: `GET {base_url}/{cnpj}`, allowlist of fields (the `QSA`, email and phones are never read) and
rejection of a response for another CNPJ. Provider differences:

- **An anonymized record is rejected.** OpenCNPJ masks the data of companies whose owner is an
  individual and flags `lgpd_anonimizado`; a masked registration is not a registration, so the result
  is `UNAVAILABLE`.
- **No IBGE code.** Its `codigo_municipio` is Receita's (another table): `cityIbgeCode` stays `null`.
- **CNAE descriptions** come from the `cnaes` list when present; `cnaes_secundarios` carries only the
  codes. Without the list, the description stays empty and IBGE fills it in (RF06).
- **Unified size.** `normalizeCompanySize` writes the size the same way for any provider (`Demais` →
  `DEMAIS`, `Microempresa` → `MICRO EMPRESA`, `EPP` → `EMPRESA DE PEQUENO PORTE`), so switching
  providers does not change the registration or the content hash.
- **Registration status as a closed set (#338).** `normalizeRegistrationStatus` maps any provider's
  status to the set `ATIVA`, `SUSPENSA`, `INAPTA`, `BAIXADA`, `NULA` or `NAO_RECONHECIDA` (active,
  suspended, unfit, closed, null, unrecognized), declared as an enum in OpenAPI (`RegistrationStatus`)
  so the front end can translate, filter and color it:
  - the description is compared by letters only, ignoring case, accents and punctuation (`ATIVA`,
    `Ativa`); the Receita code (`situacao_cadastral`: 1, 2, 3, 4 and 8) applies when the description is
    missing, does not match or comes in its place;
  - a status outside the five **neither discards the registration nor gets lost**: it becomes
    `NAO_RECONHECIDA`, with the provider's text in `registration_status_unrecognized` (in the profile
    and in the database); only a missing status still causes the response to be refused;
  - registrations stored before the closed set are read by the same rule (profile and search): an old
    description outside the set comes out as `NAO_RECONHECIDA`, with the text kept;
  - the content hash of recognized statuses is the same as before; an unrecognized one enters through
    the provider's text.
  - A status filter in the search was left out: HU23 asks for CNAE, state, municipality and minimums
    per SDG, not status.

`MinhaReceitaDataSource` (`minha-receita/`, slug `MINHA_RECEITA`, priority 3, final fallback) closes the
chain. BrasilAPI and Minha Receita serve the same Receita data **in the same format**, so both read the
response through the shared mapper `data-sources/domain/receita-open-data.mapper.ts`: that way no
adapter module depends on the other (NFPD02), and, if one of them diverges from the format, it gets a
mapper of its own. OpenCNPJ has its own format and its own mapper. A consistency test ensures that the
same company results in the same `CadastralRecord` from any provider (except for the IBGE code, which
OpenCNPJ does not provide).

## Registration fallback chain

`ReceitaDataSource` (`receita/`) queries the three providers in sequence and returns the registration
**and the provider that answered it** (`{ record, sourceSlug }`): `company_profile.cadastral_source_id`
stores that `sourceSlug`, and the cache window comes from its catalog entry.

- **The chain belongs to the catalog.** The order is the `fallback_priority` of the enabled `CADASTRAL`
  sources in `data_sources`: reordering or disabling a provider is a change in the database, applied on
  the next query. The code only knows the registered adapters (`CADASTRAL_DATA_SOURCES`). A catalog slug
  without an adapter is logged as an error and ignored; if the catalog cannot be read, the registration
  order applies.
- **One provider at a time.** The next one is only called when the previous one does not serve, which
  saves each source's limit (NFPD01). Reasons to move on: unavailability (error, timeout, limit reached,
  response outside the format or for another CNPJ) **and also "not found"**, because the Receita mirrors
  update at different paces and a newly opened company may be listed in one and not yet in another.
- **"Not found" only when all of them say so.** If any provider queried could not answer, the result is
  `UNAVAILABLE` (503 for the user), never "the company does not exist": that would be false
  information. Disabled providers do not count; with all of them disabled, the reason is `DISABLED`.
- **The history comes in the message** (`BRASIL_API: TIMEOUT; OPEN_CNPJ: FAILURE; ...`), and each
  attempt is in `data_source_request_logs`, per provider.
- **A defect in one adapter does not bring the chain down.** An unexpected exception is logged as an
  error and treated as that provider being unavailable.

## CNAE descriptions: IBGE

`IbgeCnaeDataSource` (`ibge-cnae/`, slug `IBGE_CNAE`, role `CNAE_TAXONOMY`, outside the registration
chain) returns the official description of a CNAE subclass (RF06):
`GET {base_url}/subclasses/{7-digit code}` → `CnaeDescription { code, description }`. The registration
providers provide the code and, sometimes, a description of their own (OpenCNPJ may provide none); IBGE
is the source of the taxonomy.

- **Only the requested subclass counts.** The response may come as an object or as a list, and the
  adapter only accepts the subclass whose **code equals the one queried**: otherwise, the description
  of one activity would be stored on the wrong company. A well-formed response without the code (empty
  list, 404) is `NOT_FOUND`: the code does not exist in the taxonomy. A response outside the format, or
  a subclass without a description, is `UNAVAILABLE`.
- **IBGE's spelling.** The description comes in uppercase, as IBGE publishes it, and is not rewritten.
  The hierarchy (class, group, division, section), the activities and the explanatory notes are
  discarded.
- **A code that is not a CNAE** (`abc`, `0`, 8 digits) is `NOT_FOUND`, without calling IBGE.
- **Consumers should store the description.** It hardly changes: the catalog window is 30 days
  (`cache_ttl_seconds`). The adapter stores nothing; storing it in the profile, with IBGE's description
  instead of the provider's, belongs to the profile persistence issue.

A new adapter declares the source's `slug` (which the seeder creates), calls
`RequestDataSourceUseCase.execute({ slug, segments, cnpj, context })` and passes the response through
`toLookupResult` with its own *parser*. Sources that are not queried item by item, such as IBAMA's
daily dump, define their own ingestion flow (see [IBAMA](12-IBAMA.md)).

---

[Documentation index](README.md) · ← [09. Transactional emails](09-Emails.md) · [11. Evidence](11-Evidence.md) →
