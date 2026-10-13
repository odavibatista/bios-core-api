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
| Filas, cache e limite de requisições | Redis 7 via BullMQ 6 (`@nestjs/bullmq`), `ioredis` e `@nestjs/throttler` |
| E-mail | `nodemailer` por SMTP, templates Handlebars (HTML e texto) e auditoria de cada disparo |
| Testes | Vitest 4 + `@nestjs/testing` + Supertest + Faker (dados de teste) |
| Qualidade | ESLint 10 (`typescript-eslint`, type-checked) + Prettier |

O Prisma está fixado na série 6 porque a série 7 ainda não suporta MongoDB.

## Como rodar

```bash
npm install                 # instala dependências e gera o Prisma Client
cp .env.example .env        # ajuste as variáveis se necessário
npm run keys:generate       # gera as chaves de criptografia e cole-as no .env
npm run docker:up           # MongoDB (replica set) e Redis
npm run db:push             # cria coleções e índices a partir do schema Prisma
npm run start:dev           # API em http://localhost:3000
```

| Endereço | Conteúdo |
| --- | --- |
| `GET /health` | Situação da API, do banco e do Redis |
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
| `test:e2e` | Testes ponta a ponta (pipeline HTTP, banco real e filas no Redis) |
| `verify` | Typecheck, testes com cobertura e e2e (o mesmo que roda no pre-push) |
| `prisma:generate` / `prisma:validate` / `prisma:format` | Operações sobre o schema Prisma |
| `keys:generate` | Gera as chaves de criptografia do `.env` (`-- --version N` para rotacionar) |
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

## Filas (BullMQ)

Toda a comunicação entre o core e os serviços de ingestão passa por filas BullMQ sobre o
Redis — não há chamada HTTP entre serviços. As filas de ingestão são consumidas pelo serviço
dono do fluxo; a única consumida **aqui dentro** é a de e-mails, porque não existe serviço
separado de envio.

| Fila | Conteúdo |
| --- | --- |
| `company-profile` | Dados cadastrais por CNPJ |
| `environmental-evidences` | Evidências ambientais e de conduta (IBAMA, CEIS/CNEP) |
| `ghg-inventory` | Inventário de emissões (fallback do GHG Protocol) |
| `ods-scoring` | Recálculo de índice e confiança por ODS |
| `email-dispatch` | E-mails transacionais (consumida nesta API) |

O contrato é `QueueProvider`, com três operações:

```ts
await queues.enqueue(QueueName.EMAIL_DISPATCH, 'send-confirmation', { userId });
const profile = await queues.enqueueAndWait(QueueName.COMPANY_PROFILE, 'fetch', { cnpj });
await queues.schedule({ queue, id: 'ibama-daily-ingestion', jobName, cron: '0 4 * * *' });
```

- **Espera com prazo.** `enqueueAndWait` devolve o resultado do consumidor ou lança
  `QueueTimeoutException` ao fim de `QUEUE_WAIT_TIMEOUT_MS` (ajustável por chamada). É o que
  sustenta a degradação graciosa: estourado o prazo de uma fonte não bloqueante, o chamador
  exibe a evidência como `UNKNOWN` em vez de falhar a consulta inteira. O job **continua** na
  fila — o prazo é de quem espera, não do processamento.
- **Falha distinta de prazo.** Esgotadas as tentativas, o job fica registrado como falho
  (`removeOnFail: false`) e a espera lança `QueueJobFailedException` com o motivo em
  `details`. É justamente esse registro que permite distinguir as duas situações.
- **Retry por fila.** Tentativas e backoff exponencial ficam em
  `src/shared/config/queue.config.ts`: as filas que atendem uma consulta do usuário erram
  rápido; as de segundo plano insistem mais.
- **Jobs repetíveis.** `QUEUE_SCHEDULES` declara os agendamentos (cron), registrados a cada
  boot pelo `QueueSchedulesInitializer`. O registro é idempotente pelo `id`: reiniciar a API
  não duplica o disparo. Desligue com `QUEUE_SCHEDULES_SYNC_ON_BOOT=false`.
- **A API sobe sem Redis.** A conexão é `lazyConnect` e o `/health` reporta
  `checks.redis`. Por esse mesmo motivo a espera consulta o estado do job em intervalos
  curtos em vez de usar `QueueEvents`: o `QueueEvents` abre uma conexão bloqueante ao ser
  construído e, sem Redis, derruba o processo com uma rejeição que não passa pelo evento de
  erro. Publicar também tem prazo (`QUEUE_PUBLISH_BUDGET_MS`): sem ele, o cliente guardaria o
  comando até reconectar, pendurando a requisição que o originou — esgotado o prazo, a
  resposta é `DEPENDENCY_UNAVAILABLE`.

## E-mails transacionais

Confirmação de cadastro, troca de e-mail, recuperação de senha e alerta de acesso suspeito
(RF18). Os fluxos de negócio chamam `SendTransactionalEmailUseCase`, que **renderiza e
enfileira**; quem envia é o `EmailDispatchProcessor`, consumidor da fila `email-dispatch`
hospedado nesta API.

```ts
const dispatchLogId = await sendTransactionalEmail.execute({
  template: EmailTemplate.EMAIL_CONFIRMATION,
  to: email,
  context: { name, token, validity: '2 horas' },
  userId,
});
```

O contexto é verificado contra o template escolhido: pedir `SUSPICIOUS_LOGIN_ALERT` com os
dados de um link de confirmação não compila.

| Template | Contexto | Link |
| --- | --- | --- |
| `EMAIL_CONFIRMATION` | nome, token, validade | `/confirmar-email/<token>` |
| `EMAIL_CHANGE_CONFIRMATION` | nome, token, validade | `/confirmar-novo-email/<token>` |
| `PASSWORD_RESET` | nome, token, validade | `/redefinir-senha/<token>` |
| `SUSPICIOUS_LOGIN_ALERT` | nome, IP, data/hora | — (nenhum) |

- **Templates versionados em `src/modules/mailing/templates/`**, em pt-BR: um `.hbs` de HTML e
  um de texto simples por mensagem, mais a moldura comum (`layout.html.hbs`). O texto simples
  não é enfeite — atende quem lê e-mail sem HTML e melhora a entrega, porque mensagem só-HTML
  é sinal de spam para boa parte dos filtros. O `nest build` copia os `.hbs` para `dist/`
  (ver `nest-cli.json`); sem isso a renderização falharia só em produção.
- **Variáveis escapadas** pelo Handlebars (`{{ }}`). O token vai em **segmento de caminho**, e
  não em parâmetro de consulta, porque o Handlebars escapa `=`: um `?token=abc` apareceria
  como `?token&#x3D;abc` no código-fonte da mensagem. A base do link é `FRONTEND_URL` — o
  endereço do front-end, não o da API.
- **O alerta de acesso suspeito não tem link nem segredo.** Nenhum token, nenhuma senha e
  nenhuma âncora clicável: alerta de invasão é alvo clássico de phishing, e um link ali
  treinaria o usuário a clicar. Há teste que garante isso.
- **Renderizar antes de enfileirar** é deliberado: o job carrega a mensagem pronta, então
  mudar um template não altera o conteúdo de um e-mail que já estava na fila, e o consumidor
  não precisa dos templates para enviar.
- **Falha de e-mail não derruba o fluxo de origem.** O cadastro, o login e a recuperação de
  senha concluem mesmo com o SMTP fora do ar: o disparo fica na fila e é reenviado com
  backoff (5 tentativas, ver `queue.config.ts`).
- **Auditoria em `email_dispatch_logs`.** O registro nasce `QUEUED` apontando para o job, vira
  `SENT` com `sent_at` quando o envio conclui e `FAILED` com `failure_reason` **só na última
  tentativa** — um `FAILED` antes disso mentiria, porque ainda há reenvio por vir.
- **Destinatário só em hash.** A coleção e os logs guardam `recipient_email_hash` (índice cego
  do e-mail); o endereço em claro existe apenas na carga do job, pelo tempo do envio (INL02).
- **Remetente único**, de `MAIL_FROM`: quem dispara escolhe destinatário e conteúdo, nunca de
  onde o e-mail parte.
- **Em desenvolvimento**, aponte `SMTP_HOST`/`SMTP_PORT` para um servidor local de captura
  (Mailpit, por exemplo), nunca para um provedor real. As suítes nunca abrem conexão SMTP:
  usam o `jsonTransport` do próprio Nodemailer ou um dublê.

## Cache de consultas

Evita nova chamada à fonte externa para um CNPJ já consultado dentro da janela de validade
(NFDE01) — é o que faz um perfil já visto responder rápido (NFDE02). O contrato é
`CacheProvider`, implementado sobre a mesma conexão `ioredis` do health check.

```ts
const profile = await cache.get<CompanyProfile>({ namespace, identifier: cnpj });
await cache.set({ namespace, identifier: cnpj }, profile, ttlSeconds);
await cache.invalidate(cnpj); // tudo sobre o CNPJ, em todos os namespaces
```

- **Chave versionada.** `bios:cache:v<formato>:<namespace>:<identificador>`. O namespace separa
  perfil, evidências e notas; a versão do formato aposenta todas as entradas de uma vez quando
  o conteúdo gravado muda de forma, sem precisar limpar o Redis no deploy.
- **Janela por fonte.** O TTL de cada consulta vem de `data_sources.cache_ttl_seconds`
  (`ResolveSourceCacheTtlUseCase`), ajustável no banco sem novo deploy. Sem valor configurado,
  vale `CACHE_DEFAULT_TTL`.
- **Cache nunca derruba nem atrasa a requisição.** Falha do Redis é registrada em log e tratada
  como ausência de dado, e toda operação tem orçamento de latência
  (`CACHE_OPERATION_BUDGET_MS`, 500 ms): o cliente mantém uma fila interna de comandos enquanto
  tenta reconectar, e sem esse corte um `GET` esperaria a reconexão. Esgotado o prazo, a
  consulta segue para a fonte (NFCO01).
- **Invalidação explícita.** `invalidate(cnpj)` apaga todos os namespaces do CNPJ em um único
  `DEL` — sem `SCAN`, cujo custo cresce com o tamanho do banco. É o que se chama depois de
  recalcular os índices, para não servir perfil novo com nota velha. Falha aqui é registrada
  como **erro**, não aviso: dado vencido continuaria servível até o fim do TTL.

## Limite de requisições

`@nestjs/throttler` com guarda global e contadores no Redis (NFSE04) — em Redis porque o
limite é do consumidor, não da instância: um contador por processo dobraria o limite efetivo
com duas instâncias no ar.

| Limite | Janela e teto | Contado por |
| --- | --- | --- |
| `default` | `THROTTLE_TTL` / `THROTTLE_LIMIT` | endereço IP |
| `publicApi` | `THROTTLE_PUBLIC_API_TTL` / `THROTTLE_PUBLIC_API_LIMIT` | chave de API (`x-api-key`), com o IP como alternativa |

- **429 padronizado.** Excedido o limite, a resposta é `RateLimitExceededException` no mesmo
  corpo `ErrorResponse` dos outros erros, com código estável `RATE_LIMIT_EXCEEDED` e o
  cabeçalho `Retry-After`. As respostas dentro do limite trazem `X-RateLimit-Limit`,
  `-Remaining` e `-Reset`.
- **Janela fixa.** O prazo é definido na primeira requisição da janela (`PEXPIRE NX`) e não se
  renova a cada chamada; do contrário, quem mantivesse o ritmo nunca veria a janela expirar.
  Excedido o limite, uma chave de bloqueio responde pelas requisições seguintes até vencer.
- **Falha do Redis libera a requisição.** Contador indisponível não pode virar porta fechada —
  seria trocar um limite de taxa por indisponibilidade total. A falha é registrada como erro,
  porque nesse intervalo a proteção não está valendo.
- **Isenções com `@SkipRateLimit()`**, não com o `@SkipThrottle()` da biblioteca: sem
  argumento, ele ignora **apenas** o limite `default`, e o endpoint segue limitado pelos
  nomeados. O decorator do projeto é derivado da lista de limites declarados, então acompanha
  limites novos sem revisitar cada isenção. O `/health` é isento, porque é sondado de forma
  periódica e um 429 ali seria lido como indisponibilidade da API.
- **Limites mais estritos por endpoint** saem de `@Throttle({ default: { limit, ttl } })` no
  próprio controller — é o que os endpoints sensíveis de autenticação vão usar.

## Criptografia de dados sensíveis

E-mail, endereço e o hash da senha são cifrados antes de chegar ao banco (RNF NFSE03). O
contrato é `EncryptionProvider`, e a implementação usa **AES-256-GCM** com `node:crypto`
(`AesEncryptionProvider`).

| Variável | Conteúdo |
| --- | --- |
| `ENCRYPTION_KEYS` | Chaves AES versionadas: `1:<chave>,2:<chave>`, cada uma com 32 bytes em base64 ou hexadecimal |
| `BLIND_INDEX_KEY` | Chave única de 32 bytes do índice cego |

Gere as duas com `npm run keys:generate` e cole a saída no `.env`. Chave ausente, de tamanho
errado ou com versão repetida impede a aplicação de subir.

- **IV por operação.** Cifrar o mesmo valor duas vezes produz textos diferentes, de modo que
  dois documentos com o mesmo e-mail não são identificáveis pelo conteúdo cifrado.
- **Integridade verificada.** O GCM é autenticado: texto adulterado, truncado ou cifrado com
  outra chave não decifra, e a exceção responde sempre a mesma mensagem genérica — o motivo
  técnico fica em `details`, para o log.
- **Rotação gradual.** A maior versão de `ENCRYPTION_KEYS` é a ativa, usada nas novas
  cifragens; as anteriores continuam disponíveis para ler documentos já gravados, que
  guardam a versão usada (`encryption_key_version`). Para rotacionar, acrescente a nova
  versão (`npm run keys:generate -- --version 2`) sem remover as antigas.
- **Índice cego.** `blindIndex` aplica HMAC-SHA256 sobre o valor normalizado (minúsculas, sem
  espaços nas bordas), permitindo localizar a conta pelo e-mail no login sem decifrar a
  coleção. Diferente da chave AES, `BLIND_INDEX_KEY` não é versionada: trocá-la invalidaria
  todos os índices já gravados.

### Senha

A senha nunca é guardada, nem de forma reversível: o contrato `PasswordProvider` só sabe
gerar o valor a persistir (`hash`) e conferir uma tentativa contra ele (`verify`). A
implementação (`BcryptPasswordProvider`) compõe três etapas:

```
senha → SHA-256 (base64) → bcrypt (BCRYPT_COST) → AES-256-GCM → banco
```

- **Pré-hash obrigatório.** O bcrypt ignora o que passa de 72 bytes. Sem tratamento, duas
  senhas longas que só diferem depois desse limite seriam aceitas uma pela outra — falha de
  autenticação, não detalhe teórico. O resumo SHA-256 em base64 tem 44 caracteres, sempre
  dentro do limite, e não contém o byte nulo que truncaria a entrada em implementações do
  bcrypt escritas em C.
- **Hash cifrado.** O bcrypt resiste à força bruta pelo custo; a cifragem acrescenta uma
  segunda barreira, porque a chave AES vive fora do banco. Um vazamento da coleção, sozinho,
  não permite nem testar senhas contra o hash. O valor persistido é um `EncryptedValue`, com
  a mesma versão de chave dos outros campos protegidos do documento.
- **Custo configurável.** `BCRYPT_COST` (4 a 31, padrão `12`) define o trabalho por
  verificação; cada incremento o dobra. Aumentá-lo **não** invalida as senhas já gravadas:
  o custo viaja no próprio hash e cada uma segue sendo verificada com o seu.
- **Erro de integridade não é senha errada.** `verify` devolve `false` só para senha
  incorreta; valor adulterado ou cifrado com versão de chave ausente estoura
  `EncryptionException`, para não transformar um problema de configuração em credencial
  inválida.

Alterar qualquer etapa da composição invalidaria todas as senhas gravadas e exigiria um
fluxo de reidratação no próximo login.

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
| `test/integration/` | Módulos de infraestrutura contra o serviço real (ex.: filas contra o Redis) |

A infraestrutura de teste é montada e desmontada pelo setup global
(`test/setup/infrastructure.global-setup.ts`) a cada execução de `npm run test:e2e`:

1. sincroniza coleções e índices com o schema Prisma (`prisma db push`);
2. limpa o banco de teste do Redis (`FLUSHDB`), para que jobs de uma execução anterior não
   interfiram na seguinte;
3. disponibiliza a infraestrutura às suítes, que preparam o banco com `PrismaService.reset()`
   e `PrismaService.seed(seeders)`;
4. remove o banco inteiro ao final (`dropDatabase`).

Os endereços padrão são `bios_test` no MongoDB e o banco `1` no Redis do
`docker-compose.yml`; outros podem ser informados em `E2E_DATABASE_URL` e `E2E_REDIS_URL`.
Cada um tem garantias de descarte: `seed` e `reset` só executam com `NODE_ENV=test` **e** em
banco com sufixo `_test` (fora disso lançam `UnsafeDatabaseOperationException`); no Redis, o
setup recusa o banco `0`, que é o de uso geral, e recusa limpar um banco que contenha chave
fora dos prefixos do projeto (`bios:`, `bull:`) — o que protege de outro Redis ocupando a
porta 6379 na mesma máquina. As suítes de `test/database/` rodam em série, pois compartilham
o banco.

Sem MongoDB ou sem Redis acessível, as suítes correspondentes são ignoradas localmente (com
aviso) e as demais seguem normalmente; no CI a ausência reprova a execução. Para rodá-las
localmente, suba a infraestrutura antes: `npm run docker:up`.

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
- **Testes**: unitários com limite de cobertura de 75%, e2e contra o MongoDB e o Redis do
  `docker-compose.yml` (aguardados por `docker compose up --wait`), resumo de cobertura no
  job e relatório completo como artefato.

As actions são fixadas por SHA de commit e atualizadas pelo Dependabot
(`.github/dependabot.yml`), que também abre PRs semanais de dependências npm contra o
`develop`, agrupadas por ecossistema. As majors que a stack não aceita ficam bloqueadas lá,
com o motivo registrado: Prisma 7 (sem suporte a MongoDB), TypeScript 7 (recusado pelos peers
do `@nestjs/swagger` e do `typescript-eslint`) e Vitest 5 (binário nativo do Rolldown que o
npm não instala a partir do lockfile).

### Fluxo de contribuição

1. Abrir a issue pelo template adequado (tarefa, bug ou configuração), colando os artefatos
   do bios-docs que a embasam.
2. Criar o branch a partir do `develop` e abrir o PR de volta para ele, com título em
   Conventional Commits (ele vira a mensagem do commit no squash merge).
3. Promover `develop` → `pre-prod` → `main` por PR; `main` e `pre-prod` são protegidos e só
   aceitam merge com os checks **Lint** e **Testes** aprovados (RNF NFSE11).
