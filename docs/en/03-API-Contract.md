# 03. API contract (OpenAPI and CORS)

🇧🇷 [Português](../03-Contrato-da-API.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [02. Architecture and conventions](02-Architecture.md) · [04. Database and initial load](04-Database.md) →

> The OpenAPI document consumed by the front end and integrators, client generation and CORS.

The document at `/docs/openapi.json` (and the reference at `/docs`) is the contract consumed by the
Angular app and by third-party systems (RF17, #330). It is generated from the controllers and the Zod
schemas, and it was prepared for **client generation**:

- **Named models.** Every request and response schema is a component in `components.schemas`,
  referenced by `$ref`: `CompanyFullProfileResponse`, `SearchCompaniesResponse`, `ErrorResponse`,
  `SessionResponse`… are types the front end imports, not anonymous objects copied into every route.
  The name comes from the `.meta({ id: '...' })` of the Zod schema itself (in English, following the
  code's convention), and the reused pieces become single components (`Address`, `PaginationMeta`,
  `CompanyOdsScore`, `ScoreContribution`, `CompanyEvidence`). Before, there was a single component,
  `__schema0`, and everything else was repeated inline (the full profile twice, 8.6 KB each).
- **A single `ErrorResponse`.** Every declared error response (401, 404, 422, 429, 503…) references the
  same component, which the front end's error interceptor types once.
- **`JsonValue`.** The free-form JSON of the evidence (`details`) is a named recursive type, written by
  hand in `json-value.dto.ts`: Zod's `z.json()` is recursive without a name and got the automatic name
  `__schema0`.
- **Explicit and stable `operationId`.** Each `@ApiOperation` declares its own (`getCompanyProfile`,
  `searchCompanies`, `exportCompaniesXlsx`, `refreshSession`…), which becomes the method name in the
  generated client. Before, the name was derived from the controller class, and renaming it (as in #81)
  silently changed the client's method. The ids (31 operations) are unique, and the document test holds
  the complete list: a new route has to be added to it.
- **`servers` and version.** The base URL comes from `API_BASE_URL` (optional, no trailing slash;
  without it, the relative `/`), and the version is the one in `package.json`.
- **The XLSX file** is declared as binary (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
  only in the success response; the error responses remain JSON (`ErrorResponse`).

**CORS (front end on another origin).** `CORS_ORIGINS` says which origins may call the API: `*` (the
default) accepts any of them, and a comma-separated list (e.g. `http://localhost:4200`) restricts it to
those. The API does not use cookies (tokens go in the body and in `Authorization`), so there are no
`credentials`. The `Content-Disposition` (XLSX file name) and `Retry-After` (wait time after a 429)
headers are exposed (`cors.config.ts`): without that, the browser would hide them from the front end's
JavaScript. The `test/integration/cors.e2e-spec.ts` test checks this on the real HTTP adapter.

**How the front end generates the client.** CI publishes the document as the `openapi` artifact
(`openapi/openapi.json`, with `servers: [{ url: "/" }]`, so whoever generates the client provides the
base at runtime). Locally, `OPENAPI_EXPORT_PATH=openapi/openapi.json npx vitest run --config ./vitest.config.e2e.ts
test/database/openapi-document.e2e-spec.ts` writes the same file. Checked with `openapi-typescript`
(7.13): the document generates the types (`components["schemas"]["CompanyFullProfileResponse"]`,
`operations["searchCompanies"]`), and a strict TypeScript consumer compiles.

**How to name a new schema.** Append `.meta({ id: 'ModelName' })` to the end of the exposed schema
(after `.describe`). The name must be unique in the project: two different schemas with the same `id`
become the same component. The `openapi-document.e2e-spec.ts` test fails on an inline response or body,
an error without `ErrorResponse`, `__schemaN`, a `$ref` without a component, an unused component and an
`operationId` that is missing, repeated or derived from the class name.

---

[Documentation index](README.md) · ← [02. Architecture and conventions](02-Architecture.md) · [04. Database and initial load](04-Database.md) →
