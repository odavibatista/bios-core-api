# 02. Architecture and conventions

🇧🇷 [Português](../02-Arquitetura.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [01. Getting started](01-Getting-Started.md) · [03. API contract (OpenAPI and CORS)](03-API-Contract.md) →

> Organization into modules and layers, and the code conventions followed throughout the project.

Clean Architecture on top of Nest modules. Each module groups strongly related entities (e.g. `accounts`
brings together `User` and `UserToken`), and the modules are gathered into domain aggregators — the
`AppModule` never imports business modules directly.

```
src/
├── app/
│   ├── main.ts                       # bootstrap
│   ├── app.module.ts                 # root: SharedModule + aggregators
│   └── domains/                      # domain aggregators
│       ├── identity-and-access.module.ts
│       └── sustainability-intelligence.module.ts
├── shared/                           # cross-cutting infrastructure and contracts
│   ├── config/                       # environment (Zod) and API documentation
│   ├── domain/
│   │   ├── dtos/                     # controllers, errors, requests (Zod schemas)
│   │   ├── errors/                   # DomainException and common exceptions
│   │   ├── protocols/                # UseCase<TInput, TOutput>
│   │   └── providers/                # provider contracts
│   ├── http/                         # shared controllers and decorators
│   └── infra/
│       ├── database/                 # schema.prisma (datasource), PrismaService, PrismaRepository
│       ├── filters/                  # AllExceptionsFilter
│       ├── modules/                  # SharedModule
│       ├── pipes/                    # SchemaValidationPipe
│       └── usecases/
└── modules/
    └── <module>/
        ├── domain/
        │   ├── dtos/
        │   │   ├── controllers/      # controller contracts
        │   │   ├── errors/           # module exceptions (extends DomainException)
        │   │   ├── repositories/     # repository contracts (abstract classes) and DTOs
        │   │   └── requests/         # request/response Zod schemas
        │   └── providers/            # module provider contracts
        ├── entity/                   # Prisma schemas (*.prisma) of the module's entities
        ├── http/controllers/
        └── infra/
            ├── db/repositories/      # Prisma implementations (extends PrismaRepository)
            ├── modules/              # <module>.module.ts
            ├── providers/
            └── usecases/             # extends UseCase<TInput, TOutput>
```

## Modules

| Aggregator | Module | Entities |
| --- | --- | --- |
| Identity and access | `accounts` | `User`, `UserToken` |
| | `authentication` | `UserSession`, `LoginAttempt` |
| | `api-keys` | `ApiKey` |
| | `security` | `AccessBlock`, `HoneypotHit`, `BlockedEmailDomain` |
| | `honeypot` | — (decoy routes with synthetic companies; records into `security`) |
| | `mailing` | `EmailDispatchLog` |
| Sustainability intelligence | `data-sources` | `DataSource`, `IngestionRun`, `DataSourceRequestLog` |
| | `receita` | — (registration chain: `brasil-api` → `opencnpj` → `minha-receita`, one adapter per module) |
| | `ibge-cnae` | — (CNAE description adapter) |
| | `ibama`, `cgu`, `ghg` | — (evidence source adapters; they write into `evidences`) |
| | `evidences` | `EvidenceRaw`, `EvidenceNormalized`, `EvidenceCollectionClock` |
| | `environmental-intelligence` | — (orchestrates the evidence sources; no entities of its own) |
| | `companies` | `CompanyProfile` |
| | `scoring` | `Ods`, `CompanyOdsScore`, `SectorScoreSnapshot` |

## Code conventions

- **Injection by contract.** Use cases depend on abstract classes (repositories and providers),
  registered in the module with `{ provide: Contract, useClass: Implementation }`. Abstract classes —
  not interfaces — because they exist at runtime and serve as injection tokens.
- **Typed use cases.** Every use case extends `UseCase<TInput, TOutput>`; no `any` in the `execute`
  signature.
- **Repositories.** They extend `PrismaRepository`, which receives the `PrismaService` by injection.
  There is no global `PrismaClient` instance.
- **DTOs with Zod.** Input is validated on the parameter itself (`@Body({ schema })`,
  `@Query({ schema })`, `@Param({ schema })`); output is declared with `@ResponseSchema(schema)`,
  which documents the response in OpenAPI **and** drops fields outside the schema on serialization.
- **Errors.** Business exceptions extend `DomainException` (stable code + HTTP status); the
  `AllExceptionsFilter` turns any error into the standard `ErrorResponse` body. Validation errors
  respond 422 with the list of invalid fields.
- **Error messages in Portuguese (#398).** Messages written in the domain and in the schemas take
  precedence. Zod's default messages come from the pt-BR locale (`validation-messages.config.ts`,
  applied by the `SharedModule` before the environment is validated, by the `account:promote` CLI and
  by the unit test setup), with "Campo obrigatório." for a missing field. Errors raised by the framework
  itself (`HttpException` and 4xx errors in the `http-errors` format, such as the body-parser 413) keep
  the `code` derived from the status, but the message comes from the filter's
  `FRAMEWORK_ERROR_MESSAGES` table: the original English text never reaches the client
  (`Cannot GET /x`, `Unexpected token ...`). A body above the body-parser default limit (100 KB)
  responds 413 `PAYLOAD_TOO_LARGE`.
- **Controllers** return values — no `@Res()` —, preserving the framework's interceptors, filters and
  serialization.
- **Imports.** Relative within the same area (`app`, `shared` or a module); across areas, through the
  `@app/*`, `@shared/*` and `@modules/*` aliases; tests under `src/` reach the test support code
  (`test/`) through `@test/*`. Since this is ESM, every relative or aliased import ends in `.js`.
- **Texts in pt-BR, with accents (#258).** Everything the API exposes — error messages, OpenAPI
  descriptions, evidence summaries and emails — is written in Portuguese with its accents, tilde and
  cedilla (`inválido`, `índice`, `explicação`). The `src/shared/domain/portuguese-accents.spec.ts` test
  scans the text literals of the production code and the emails and **fails** on the unaccented
  spelling of a list of words (`invalido`, `nao`, `indice`...); when you find a new one, add the wrong
  spelling to the test's list. Identifiers, source field names, URLs and comments are left out.
- **Documentation in Portuguese and English.** Each page in `docs/` has its version in `docs/en/` (and
  `README.md` has `README.en.md`), with the language selector right below the title; the API itself
  stays in pt-BR. When you change one page, change the other in the same PR. The
  `src/shared/domain/documentation-languages.spec.ts` test fails on a page without a counterpart, a
  selector that does not lead back to the original page, a relative link or anchor that does not exist
  and a translation with fewer links than the original.

---

[Documentation index](README.md) · ← [01. Getting started](01-Getting-Started.md) · [03. API contract (OpenAPI and CORS)](03-API-Contract.md) →
