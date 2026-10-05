# bios-core-api

API principal do **BIOS — Business Intelligence on Sustainability**: orquestração das
consultas, API pública documentada, contas de usuário e chaves de API. Consolida evidências
ambientais públicas por CNPJ e expõe índices de aderência aos ODS 13 e 15, com nível de
confiança e explicação evidência a evidência.

A documentação de requisitos, modelagem e arquitetura do projeto fica no repositório
`bios-docs`.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Runtime | Node.js ≥ 22.22.3, ESM (`"type": "module"`) |
| Framework | NestJS 12 |
| Banco de dados | MongoDB 8 (replica set) via Prisma ORM 6.19 |
| Validação e DTOs | Zod 4 com Standard Schema nativo do Nest (`@Body({ schema })`) |
| Documentação da API | `@nestjs/swagger` 12 (OpenAPI gerado dos schemas Zod) + Scalar |
| Filas e cache | Redis 7 (BullMQ — a configurar com os módulos de ingestão) |
| Testes | Vitest 4 + `@nestjs/testing` + Supertest + Faker (dados de teste) |
| Qualidade | ESLint 10 (`typescript-eslint`, type-checked) + Prettier |

O Prisma está fixado na série 6 porque a série 7 ainda não suporta MongoDB.

## Como rodar

```bash
npm install                 # instala dependências e gera o Prisma Client
cp .env.example .env        # ajuste as variáveis se necessário
npm run docker:up           # MongoDB (replica set) e Redis
npm run db:push             # cria coleções e índices a partir do schema Prisma
npm run start:dev           # API em http://localhost:3000
```

| Endereço | Conteúdo |
| --- | --- |
| `GET /health` | Situação da API e do banco |
| `/docs` | Referência interativa da API (Scalar) |
| `/docs/openapi.json` | Documento OpenAPI |

## Scripts

| Script | Função |
| --- | --- |
| `start:dev` / `start:debug` / `start:prod` | Executa a API (watch / debug / build compilado) |
| `build` | Compila para `dist/` |
| `lint` / `lint:check` | ESLint com e sem correção automática |
| `format` / `format:check` | Prettier com e sem reescrita |
| `typecheck` | Verificação de tipos sem emitir arquivos |
| `test` / `test:watch` / `test:cov` | Testes unitários (com limite de cobertura de 75%) |
| `test:e2e` | Testes ponta a ponta sobre o `AppModule` (pipeline HTTP e banco real) |
| `verify` | Typecheck, testes com cobertura e e2e (o mesmo que roda no pre-push) |
| `prisma:generate` / `prisma:validate` / `prisma:format` | Operações sobre o schema Prisma |
| `db:push` | Sincroniza coleções e índices do MongoDB com o schema |
| `docker:up` / `docker:down` | Sobe/derruba a infraestrutura local |

## Arquitetura

Clean Architecture sobre módulos Nest. Cada módulo agrupa entidades fortemente
relacionadas (ex.: `accounts` reúne `User` e `UserToken`), e os módulos são reunidos em
agregadores de domínio — o `AppModule` nunca importa módulos de negócio diretamente.

```
src/
├── app/
│   ├── main.ts                       # bootstrap
│   ├── app.module.ts                 # raiz: SharedModule + agregadores
│   └── domains/                      # agregadores de domínio
│       ├── identity-and-access.module.ts
│       └── sustainability-intelligence.module.ts
├── shared/                           # infraestrutura e contratos transversais
│   ├── config/                       # ambiente (Zod) e documentação da API
│   ├── domain/
│   │   ├── dtos/                     # controllers, errors, requests (schemas Zod)
│   │   ├── errors/                   # DomainException e exceções comuns
│   │   ├── protocols/                # UseCase<TInput, TOutput>
│   │   └── providers/                # contratos de providers
│   ├── http/                         # controllers e decorators compartilhados
│   └── infra/
│       ├── database/                 # schema.prisma (datasource), PrismaService, PrismaRepository
│       ├── filters/                  # AllExceptionsFilter
│       ├── modules/                  # SharedModule
│       ├── pipes/                    # SchemaValidationPipe
│       └── usecases/
└── modules/
    └── <módulo>/
        ├── domain/
        │   ├── dtos/
        │   │   ├── controllers/      # contratos dos controllers
        │   │   ├── errors/           # exceções do módulo (extends DomainException)
        │   │   ├── repositories/     # contratos de repositório (classes abstratas) e DTOs
        │   │   └── requests/         # schemas Zod de request/response
        │   └── providers/            # contratos de providers do módulo
        ├── entity/                   # schemas Prisma (*.prisma) das entidades do módulo
        ├── http/controllers/
        └── infra/
            ├── db/repositories/      # implementações Prisma (extends PrismaRepository)
            ├── modules/              # <módulo>.module.ts
            ├── providers/
            └── usecases/             # extends UseCase<TInput, TOutput>
```

### Módulos

| Agregador | Módulo | Entidades |
| --- | --- | --- |
| Identidade e acesso | `accounts` | `User`, `UserToken` |
| | `authentication` | `UserSession`, `LoginAttempt` |
| | `api-keys` | `ApiKey` |
| | `security` | `AccessBlock`, `HoneypotHit`, `BlockedEmailDomain` |
| | `mailing` | `EmailDispatchLog` |
| Inteligência socioambiental | `data-sources` | `DataSource`, `IngestionRun`, `DataSourceRequestLog` |
| | `evidences` | `EvidenceRaw`, `EvidenceNormalized` |
| | `companies` | `CompanyProfile` |
| | `scoring` | `Ods`, `CompanyOdsScore`, `SectorScoreSnapshot` |

### Convenções de código

- **Injeção por contrato.** Casos de uso dependem de classes abstratas (repositórios e
  providers), registradas no módulo com `{ provide: Contrato, useClass: Implementacao }`.
  Classes abstratas — e não interfaces — porque existem em tempo de execução e servem de
  token de injeção.
- **Casos de uso tipados.** Todo caso de uso estende `UseCase<TInput, TOutput>`; nada de
  `any` na assinatura de `execute`.
- **Repositórios.** Estendem `PrismaRepository`, que recebe o `PrismaService` por injeção.
  Não existe instância global de `PrismaClient`.
- **DTOs com Zod.** Entrada validada no próprio parâmetro (`@Body({ schema })`,
  `@Query({ schema })`, `@Param({ schema })`); saída declarada com `@ResponseSchema(schema)`,
  que documenta a resposta no OpenAPI **e** descarta campos fora do schema na serialização.
- **Erros.** Exceções de negócio estendem `DomainException` (código estável + status HTTP);
  o `AllExceptionsFilter` converte qualquer erro no corpo padronizado `ErrorResponse`.
  Erros de validação respondem 422 com a lista de campos inválidos.
- **Controllers** retornam valores — sem `@Res()` —, preservando interceptors, filtros e
  serialização do framework.
- **Imports.** Relativos dentro da mesma área (`app`, `shared` ou um módulo); entre áreas,
  pelos aliases `@app/*`, `@shared/*` e `@modules/*`; os testes de `src/` chegam ao apoio de
  teste (`test/`) por `@test/*`. Por ser ESM, todo import relativo ou por alias termina em
  `.js`.

## Banco de dados (Prisma)

O schema é multiarquivo e fica distribuído pelos módulos:

- `src/shared/infra/database/schema.prisma` — apenas `generator` e `datasource`;
- `src/modules/<módulo>/entity/*.prisma` — modelos, tipos compostos e enums do módulo.

O `prisma.config.ts` aponta a raiz do schema para `src/`, e o Prisma reúne recursivamente
todos os arquivos `.prisma`. Para criar uma entidade, adicione o arquivo na pasta `entity/`
do módulo dono e rode `npm run prisma:generate` (e `npm run db:push` para criar índices).

Convenções: chave primária `id_<entidade>` (ObjectId em `_id`), chave estrangeira
`<entidade>_id`, campos em snake_case, coleções no plural com `@@map` e índices nomeados
`idx_<coleção>_<campos>`. Empresas são referenciadas pela chave natural `cnpj`, sem relação
Prisma, pois evidências podem existir antes do perfil cadastral.

O MongoDB precisa rodar como **replica set** (o `docker-compose.yml` já o configura): o
Prisma usa transações para as ações referenciais emuladas, como a cascata na exclusão de
conta.

### Retenção de dados (índices TTL)

Tokens, sessões, bloqueios e logs são removidos automaticamente pelo MongoDB após um prazo
configurável por variável de ambiente:

| Variável | Coleção | Conta a partir de | Padrão |
| --- | --- | --- | --- |
| `DATA_RETENTION_USER_TOKENS` | `user_tokens` | `expires_at` | `7d` |
| `DATA_RETENTION_USER_SESSIONS` | `user_sessions` | `expires_at` | `30d` |
| `DATA_RETENTION_ACCESS_BLOCKS` | `access_blocks` | `blocked_until` (bloqueios sem prazo nunca expiram) | `90d` |
| `DATA_RETENTION_LOGIN_ATTEMPTS` | `login_attempts` | `attempted_at` | `90d` |
| `DATA_RETENTION_HONEYPOT_HITS` | `honeypot_hits` | `hit_at` | `180d` |
| `DATA_RETENTION_EMAIL_DISPATCH_LOGS` | `email_dispatch_logs` | `created_at` | `180d` |
| `DATA_RETENTION_DATA_SOURCE_REQUEST_LOGS` | `data_source_request_logs` | `requested_at` | `90d` |

Durações exigem unidade (`m`, `h`, `d`, `w`; mínimo `1m`) e são validadas no boot.

Como o Prisma não declara índices TTL, cada campo acima tem um índice simples no schema do
módulo dono da coleção (criado pelo `db push`), e a API o converte em TTL a cada
inicialização (`DataRetentionModule`):

- índice ausente → criado já com TTL;
- índice simples ou TTL com outro prazo → ajustado via `collMod`, sem recriação;
- índice com o prazo configurado → nenhuma operação.

A sincronização roda em segundo plano e não bloqueia o boot; com o banco indisponível, é
adiada para a próxima inicialização. Desative com `DATA_RETENTION_SYNC_ON_BOOT=false`. As
regras ficam em `src/shared/config/data-retention.config.ts`, e um teste garante que cada
índice citado ali exista no schema Prisma correspondente.

## Testes

Vitest com a API de mocks equivalente à do Jest (`vi.fn`, `vi.spyOn`). Dependências são
substituídas pelo container do Nest com `Test.createTestingModule(...).overrideProvider()`,
sem mock de módulo inteiro. Mocks são limpos e restaurados automaticamente entre testes.

### Cobertura

`npm run test:cov` mede a cobertura do código de `src/` e reprova a execução abaixo de 75% em
linhas, funções, branches ou statements (RNF NFPD03). O relatório fica em `coverage/`:
`index.html` para navegação, `coverage-summary.json` e `lcov.info` para ferramentas. Ele é
gerado mesmo quando algum teste falha.

Ficam fora da medição, pelo sufixo do nome (`COVERAGE_EXCLUDE` em `vitest.config.ts`):

| Sufixo | Motivo |
| --- | --- |
| `.spec.ts`, `main.ts` | Os próprios testes e o bootstrap da aplicação |
| `seeder.ts` | Seeders de catálogo, exercitados contra o banco real nos testes e2e |
| `config.ts` | Configuração da aplicação, validada na inicialização |
| `.exception.ts`, `.protocol.ts`, `.decorator.ts`, `.module.ts` | Declarações: exceções de domínio, contratos, decorators e módulos do Nest |

Os testes desses arquivos continuam sendo executados; eles só não entram no cálculo do limite.

### Testes e2e

| Pasta | Escopo |
| --- | --- |
| `test/http/` | Pipeline HTTP sobre o `AppModule`, com dependências substituídas via `overrideProvider` |
| `test/database/` | `AppModule` completo contra um MongoDB real e descartável |

O banco de teste é montado e desmontado pelo setup global (`test/setup/database.global-setup.ts`)
a cada execução de `npm run test:e2e`:

1. sincroniza coleções e índices com o schema Prisma (`prisma db push`);
2. disponibiliza o banco às suítes, que o preparam com `PrismaService.reset()` e
   `PrismaService.seed(seeders)`;
3. remove o banco inteiro ao final (`dropDatabase`).

O banco padrão é `bios_test` no MongoDB do `docker-compose.yml`; outro endereço pode ser
informado em `E2E_DATABASE_URL`. `seed` e `reset` só executam com `NODE_ENV=test` **e** em
banco com sufixo `_test` — fora disso lançam `UnsafeDatabaseOperationException`, o que impede
que uma configuração errada apague dados reais. As suítes de `test/database/` rodam em série,
pois compartilham o banco.

Sem MongoDB acessível, as suítes de banco são ignoradas localmente (com aviso) e as demais
seguem normalmente; no CI a ausência do banco reprova a execução. Para rodá-las localmente,
suba a infraestrutura antes: `npm run docker:up`.

Os catálogos de referência (ODS, fontes de dados e blacklist de domínios) têm seeders
idempotentes nos próprios módulos (`infra/db/seeders/`), reunidos em
`src/app/database/catalog.seeders.ts` na ordem de dependência.

### Dados de teste

Todas as suítes, unitárias e e2e, geram seus dados com o Faker (locale pt-BR). Valores
arbitrários não são fixados à mão; ficam fixos apenas os valores que são a própria regra
testada, como os ODS de referência, os padrões da configuração ou as mensagens de erro.

- **Instância única**: os testes importam `faker` de `test/support/faker.ts`. O ESLint
  bloqueia o import direto de `@faker-js/faker` nos testes; o código de produção (ex.:
  honeypot, RF21) continua livre para usá-lo.
- **Factories**: registros e objetos de domínio vêm de `test/factories/<módulo>/`, criados
  com `defineFactory`. `build(overrides)` gera um objeto completo e fixa só os campos do
  cenário; `buildMany(n, overrides)` gera vários.
- **Semente reproduzível**: cada arquivo de teste recebe uma semente aleatória
  (`test/setup/faker.setup.ts`). Quando um teste falha, a semente aparece na saída; para
  repetir exatamente os mesmos dados:

```bash
FAKER_SEED=<semente> npx vitest run <arquivo>        # bash
$env:FAKER_SEED=<semente>; npx vitest run <arquivo>  # PowerShell
```

```ts
import { odsFactory } from '@test/factories/scoring/ods.factory.js';

const ods = odsFactory.build({ ods_number: 15 }); // demais campos aleatórios
```

## Qualidade e integração contínua

### Hooks locais (Husky)

Instalados automaticamente pelo `npm install` (script `prepare`).

| Hook | Verificação | Escopo |
| --- | --- | --- |
| `pre-commit` | ESLint (`--max-warnings=0`), Prettier e testes relacionados (`vitest related`); `prisma format --check` e `prisma validate` quando há `.prisma` no commit | Apenas arquivos em stage (`lint-staged.config.mjs`) |
| `commit-msg` | Conventional Commits com escopo restrito aos módulos e áreas do projeto | Mensagem do commit (`commitlint.config.mjs`) |
| `pre-push` | `npm run verify`: typecheck, testes com cobertura mínima de 75% e e2e | Todos os commits ainda não publicados; dispensado quando o push não altera código, schema ou configuração |

### CI (GitHub Actions)

O workflow `.github/workflows/ci.yml` roda em pull requests e pushes para `develop`, `pre-prod`
e `main`, sem etapa de deploy:

- **Lint**: mensagens de commit e título do PR, schema Prisma, ESLint, Prettier e typecheck;
- **Testes**: unitários com limite de cobertura de 75%, e2e, resumo de cobertura no job e
  relatório completo como artefato.

As actions são fixadas por SHA de commit e atualizadas pelo Dependabot
(`.github/dependabot.yml`), que também abre PRs semanais de dependências npm contra o
`develop`, agrupadas por ecossistema e sem saltar o Prisma para a série 7.

### Fluxo de contribuição

1. Abrir a issue pelo template adequado (tarefa, bug ou configuração), colando os artefatos
   do bios-docs que a embasam.
2. Criar o branch a partir do `develop` e abrir o PR de volta para ele, com título em
   Conventional Commits (ele vira a mensagem do commit no squash merge).
3. Promover `develop` → `pre-prod` → `main` por PR; `main` e `pre-prod` são protegidos e só
   aceitam merge com os checks **Lint** e **Testes** aprovados (RNF NFSE11).
