# bios-core-api technical documentation

🇧🇷 [Português](../README.md) · 🇺🇸 **English**

[← Back to the project README](../../README.en.md)

How the API works on the inside: each implementation decision, the reason for it and where it lives in
the code. The requirements, use cases and modeling live in the
[bios-docs](https://github.com/odavibatista/bios-docs) repository (in Portuguese); here the same
identifiers (UC, RF, NF, IA, INL) point back to them.

The API itself speaks Portuguese: error messages, OpenAPI descriptions, evidence summaries, emails and
enum values such as `CONDUTA_ADMINISTRATIVA` are in pt-BR. This translation keeps those values as they
are, explaining them where needed.

## Contents

### Getting started

| No. | Document | Content |
| --- | --- | --- |
| 01 | [Getting started](01-Getting-Started.md) | Prerequisites, first steps and project scripts |
| 02 | [Architecture and conventions](02-Architecture.md) | Organization into modules and layers, and the code conventions |
| 03 | [API contract (OpenAPI and CORS)](03-API-Contract.md) | OpenAPI document, client generation for the front end and CORS |

### Foundations

| No. | Document | Content |
| --- | --- | --- |
| 04 | [Database and initial load](04-Database.md) | Prisma on top of MongoDB, retention through TTL indexes and loading the catalogs into a new database |
| 05 | [Queues (BullMQ)](05-Queues.md) | Queues, consumers, schedules and retry policies |
| 06 | [Authentication and accounts](06-Authentication-and-Accounts.md) | Sessions, renewal, guard, password, account maintenance and the domain blocklist |
| 07 | [Security](07-Security.md) | Rate limiting, encryption of sensitive data and the honeypot |
| 08 | [Query cache](08-Cache.md) | Caching of CNPJ queries in Redis |
| 09 | [Transactional emails](09-Emails.md) | Templates, sending through the queue and auditing of every dispatch |

### Data and sources

| No. | Document | Content |
| --- | --- | --- |
| 10 | [External sources (adapters)](10-External-Sources.md) | Adapters for the public sources, the registration fallback chain and the CNAE descriptions |
| 11 | [Evidence](11-Evidence.md) | Model and persistence, consolidation by CNPJ, references to the sources, UNKNOWN reasons and the CGU |
| 12 | [IBAMA](12-IBAMA.md) | IBAMA dumps: download, reading, normalization, daily job and on-demand lookup |
| 13 | [GHG Protocol inventory](13-GHG-Protocol.md) | Emissions inventories from the GHG Protocol Public Registry |

### Features

| No. | Document | Content |
| --- | --- | --- |
| 14 | [SDG indexes](14-SDG-Indexes.md) | Index and confidence, queue-based recalculation, explanation, SDG catalog and sector trends |
| 15 | [Companies](15-Companies.md) | Lookup by CNPJ, full profile, search and XLSX export |
| 16 | [API keys and public API](16-API-Keys.md) | Managing keys from the dashboard and looking up profiles by key |

### Quality

| No. | Document | Content |
| --- | --- | --- |
| 17 | [Tests](17-Tests.md) | Coverage, parallel e2e tests and test data |
| 18 | [Quality and continuous integration](18-Quality-and-CI.md) | Local hooks, the CI pipeline and the contribution flow |

## Where to start

- **Going to run the API?** [01. Getting started](01-Getting-Started.md).
- **Going to consume the API (front end or integration)?** [03. API contract](03-API-Contract.md), then
  [06. Authentication and accounts](06-Authentication-and-Accounts.md) and [15. Companies](15-Companies.md).
- **Want to understand the calculation?** [11. Evidence](11-Evidence.md) and
  [14. SDG indexes](14-SDG-Indexes.md).
- **Going to contribute code?** [02. Architecture and conventions](02-Architecture.md),
  [17. Tests](17-Tests.md) and [18. Quality and continuous integration](18-Quality-and-CI.md).

The interactive reference of each route, with the models and the errors, is at `/docs` with the API
running.

## Glossary

| Term | Meaning |
| --- | --- |
| CNPJ | Brazilian company tax ID (14 characters, numeric or alphanumeric) |
| CPF | Brazilian individual tax ID; never stored (INL02) |
| CNAE | Brazilian classification of economic activities (division, group, class and subclass) |
| ODS | *Objetivos de Desenvolvimento Sustentável*: the UN Sustainable Development Goals (SDGs) |
| Receita | *Receita Federal*, the federal revenue service that keeps the company registry |
| IBGE | The national statistics institute, publisher of the official CNAE taxonomy |
| IBAMA | The federal environmental agency (infraction notices and embargo terms) |
| CGU | The federal comptroller; CEIS and CNEP are its registries of sanctioned companies |
| MEI | *Microempreendedor individual*, an individual micro-entrepreneur |
| UF | One of the 27 Brazilian federative units (states and the Federal District) |
| LGPD | Brazil's general data protection law |
