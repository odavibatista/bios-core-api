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

Toda a comunicação entre quem pede e quem processa passa por filas BullMQ sobre o Redis — não
há chamada HTTP entre serviços. A ingestão **não** é um serviço à parte: cada fonte é um módulo
do core (`ibama/`, `receita/`…), e o consumidor de cada fila é um `@Processor` hospedado no
módulo dono do fluxo. Um consumidor por fila: dois na mesma fila competiriam pelos jobs.

| Fila | Conteúdo | Consumidor |
| --- | --- | --- |
| `company-profile` | Dados cadastrais por CNPJ | `CompanyProfileProcessor` (`companies/`) |
| `environmental-evidences` | Evidências de conduta da CGU (CEIS/CNEP) | `EnvironmentalEvidencesProcessor` (`evidences/`), concorrência 3: consulta CGU por CNPJ, jobs curtos de quem espera a resposta |
| `ibama-ingestion` | Dumps do IBAMA (lote diário e coleta avulsa por CNPJ) | `IbamaIngestionProcessor` (`ibama/`), exclusivo, concorrência 1: um download de dumps por vez |
| `ghg-inventory` | Inventário de emissões (fallback do GHG Protocol) | `GhgInventoryProcessor` (`ghg/`), exclusivo, concorrência 1: coleta por CNPJ e sincronização diária do cadastro de organizações |
| `ods-scoring` | Recálculo de índice e confiança por ODS | ainda não implementado |
| `email-dispatch` | E-mails transacionais | consumida nesta API (`mailing/`) |

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
- **Retry por agendamento.** Um agendamento pode trazer a própria política (`retry`), no lugar da
  da fila. O lote diário do IBAMA (minutos por tentativa, fonte que costuma ficar horas fora do ar)
  declara **5 tentativas com backoff exponencial de base 5 min** (5, 10, 20 e 40 min entre
  elas); os jobs por CNPJ da mesma fila `ibama-ingestion` mantêm a política curta da fila
  (5 tentativas, base de 5 s). O agendador antigo do lote, que vivia em `environmental-evidences`,
  é removido a cada boot (`QUEUE_RETIRED_SCHEDULES`).
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
| `publicApi` | `THROTTLE_PUBLIC_API_TTL` / `THROTTLE_PUBLIC_API_LIMIT` | resumo da chave de API (`x-api-key`), com o IP como alternativa |

- **O `publicApi` só vale na API pública.** Incide apenas nos endpoints marcados com
  `@PublicApiRoute()` (que `@ApiKeyAuth()` já aplica); nos demais é dispensado (`skipIf`). Antes
  disso valia em todo endpoint e dividia 60 requisições por janela entre tudo o que saía do
  mesmo IP, login inclusive. Na API pública os dois limites somam: o `default` por IP e o
  `publicApi` por chave.
- **A chave não vai ao Redis.** O contador usa `key:` + os 32 primeiros caracteres do SHA-256
  da chave, nunca o segredo em claro. Cada valor inventado ganha o próprio contador (que expira
  com a janela), e o limite por IP impede que isso vire um jeito de encher o Redis.
- **429 padronizado.** Excedido o limite, a resposta é `RateLimitExceededException` no mesmo
  corpo `ErrorResponse` dos outros erros, com código estável `RATE_LIMIT_EXCEEDED` e o
  cabeçalho `Retry-After`. A biblioteca escreve os cabeçalhos dos limites que não são o
  `default` com o nome como sufixo (`Retry-After-publicApi`, `X-RateLimit-Limit-publicApi`); o
  guard acrescenta o `Retry-After` padrão, que é o que clientes HTTP respeitam. As respostas
  dentro do limite trazem `X-RateLimit-Limit`, `-Remaining` e `-Reset` (com o sufixo, no
  `publicApi`).
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

Gere as duas com `npm run keys:generate` e cole a saída no `.env` (o comando imprime também
`AUTH_ACCESS_TOKEN_SECRET`, descrita em [Autenticação e sessões](#autenticação-e-sessões)).
Chave ausente, de tamanho errado ou com versão repetida impede a aplicação de subir.

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

## Autenticação e sessões

O login (`POST /auth/login`, UC02) confere a senha, registra a tentativa e abre uma sessão: um
**access token JWT** de vida curta e um **refresh token** opaco de uso único.

| Variável | Conteúdo |
| --- | --- |
| `AUTH_ACCESS_TOKEN_SECRET` | Segredo de 32 bytes (base64 ou hexadecimal) que assina o access token com HMAC-SHA256 |
| `AUTH_ACCESS_TOKEN_LIFETIME` | Vida do access token (1m a 60m, padrão `15m`) |
| `AUTH_REFRESH_TOKEN_LIFETIME` | Vida do refresh token (mínimo 1h, padrão `7d`) |

- **O token só identifica a sessão.** Carrega `sub` (usuário), `sid` (elo da sessão), `role` e o
  emissor, sem dado pessoal. Quem decide se a sessão vale é o servidor, comparando o `sid` com
  o elo no banco, o que dá efeito imediato à revogação. Trocar `AUTH_ACCESS_TOKEN_SECRET`
  invalida os access tokens em circulação, mas não as sessões, que seguem renováveis.
- **Algoritmo fixado na verificação.** Só `HS256` é aceito, e o emissor é exigido: o
  `alg: none` e a troca de algoritmo não passam.
- **Refresh token.** São 256 bits aleatórios; só o resumo SHA-256 vai ao banco
  (`user_sessions`). Cada login abre uma família de rotação própria, um dispositivo por
  família.
- **Mesma resposta para e-mail inexistente e senha incorreta**, inclusive no tempo: sem conta,
  a senha é conferida contra um hash descartável. Quem acerta a senha de uma conta não
  confirmada recebe `ACCOUNT_NOT_CONFIRMED` (403) e pode pedir novo link.
- **Bloqueio por tentativas (RF20, NFSE06).** Cinco senhas incorretas seguidas bloqueiam o
  **IP** e/ou a **conta** por 15 minutos; o alvo que chega ao limite primeiro é bloqueado, e
  o titular da conta recebe o alerta de login suspeito. Um login correto zera a contagem, e
  um bloqueio também: as falhas que o causaram não contam de novo. Enquanto durar, nem a
  senha certa entra (`429`, `ACCESS_TEMPORARILY_BLOCKED`, com `retry_after_seconds`).
  Tentativas recusadas por bloqueio ou por conta não confirmada não contam como erro de
  senha. Toda tentativa fica em `login_attempts` (RF19).
- **Limite conhecido.** O bloqueio de conta só existe para e-mail cadastrado; cinco falhas
  vindas de IPs diferentes revelam que a conta existe. O bloqueio por IP, que vale também
  para e-mail desconhecido, restringe esse teste a quem controla muitos endereços.

### Renovação de sessão

`POST /auth/refresh` troca um refresh token válido por um novo par de tokens (UC17, RF32).

- **Rotação de uso único e atômica.** A troca revoga o elo atual como `ROTATED` e cria o
  seguinte na mesma família, numa transação, só se o elo ainda estiver ativo e dentro da
  validade. O elo antigo guarda `replaced_by_session_id` e permanece até a retenção expirar,
  para que o reuso continue detectável. O novo access token traz o papel vigente do usuário.
- **Reuso é indício de vazamento.** Reapresentar um token já rotacionado revoga **todas** as
  sessões ativas do usuário (`REUSE_DETECTED`, todos os dispositivos) e avisa o titular por
  e-mail. Perder a disputa pelo mesmo token contra outro pedido simultâneo recebe o mesmo
  tratamento (fluxo 4.1): o MongoDB aborta a transação de quem chega depois (`P2034`), e o
  repositório converte isso em "elo já consumido".
- **Sem cascata quando não há indício de roubo.** Token desconhecido, expirado ou revogado
  por outro motivo (logout, troca de senha) é só recusado.
- **Uma única resposta para toda recusa** (`401 SESSION_INVALID`), sem revelar se o token é
  desconhecido, expirado, revogado ou reutilizado.

### Guard de autenticação e encerramento de sessão

Toda rota exige sessão, exceto as marcadas com `@Public()` (UC03, NFSE05).

- **Protegido por padrão.** O `AccessTokenGuard` é global: uma rota nova nasce privada, e quem
  deve ser acessível sem sessão — cadastro, confirmação, login, renovação, health check — se
  declara com `@Public()` (método ou controller). Esquecer o decorator numa rota pública a
  deixa inacessível, o que aparece no primeiro teste; o inverso deixaria uma rota privada
  aberta sem ninguém perceber. Nos handlers, `@CurrentUser()` entrega o usuário autenticado
  (`userId`, `sessionId`, `familyId`, `role`).
- **O token é conferido contra a sessão a cada requisição.** Além da assinatura e do prazo,
  o guard consulta o elo (`sid`): ele precisa existir, estar ativo, dentro da validade do
  refresh token e ser do usuário que o token afirma. É isso que dá efeito imediato ao logout,
  à detecção de reuso e, adiante, à troca de senha, sem lista de tokens revogados. Falha ao
  consultar o banco **nunca libera** a requisição.
- **Mesma resposta para toda recusa** (`401 NOT_AUTHENTICATED`): token ausente, malformado,
  adulterado, expirado ou de sessão encerrada.
- **Limite antes da autenticação.** O guard de limite de requisições roda primeiro, então
  requisições com token falso tomam 429 sem chegar ao banco.
- **`POST /auth/logout`** encerra o dispositivo atual: revoga a família de rotação da sessão
  como `LOGOUT`, o que invalida o access token e o refresh token juntos, e não toca nas
  sessões dos outros dispositivos. **`POST /auth/logout-all`** revoga todas as sessões
  ativas do usuário como `LOGOUT_ALL_DEVICES`. Ambos respondem `204`.

### Troca e recuperação de senha

Três endpoints cobrem o UC04 (RF24, RF25). A nova senha segue a política do cadastro (8 a 128
caracteres, com letra e número) nos dois fluxos.

| Endpoint | Acesso | O que faz |
| --- | --- | --- |
| `POST /auth/change-password` | sessão | Exige a senha atual e troca a senha; responde `204` |
| `POST /auth/forgot-password` | público | Envia o link de recuperação por e-mail; responde `202` |
| `POST /auth/reset-password` | público | Define a senha nova com o token do link; responde `204` |

- **Troca.** A senha atual precisa conferir (`422 INVALID_CURRENT_PASSWORD`) e a nova precisa
  ser diferente dela (`422 PASSWORD_UNCHANGED`). É a senha atual que impede um computador
  deixado logado, ou um access token roubado, de entregar a conta.
- **Recuperação.** O link usa o token de uso único e vale `AUTH_PASSWORD_RESET_TOKEN_LIFETIME`
  (padrão `2h`); pedir outro invalida o anterior. A resposta ao pedido é a mesma para qualquer
  e-mail, e **só conta ativa recebe link**: a conta não confirmada precisa confirmar o e-mail
  (UC01), e a recuperação a contornaria. O token é gasto antes de a senha ser gravada, mas só
  depois de a senha nova passar na validação, então uma senha fraca não queima o link.
- **Todas as sessões caem.** Troca e redefinição revogam as sessões ativas do usuário em todos
  os dispositivos (`PASSWORD_CHANGE` / `PASSWORD_RESET`), inclusive a que fez o pedido. A senha
  é gravada **antes** de as sessões serem revogadas: na ordem inversa, quem ainda soubesse a
  senha antiga abriria uma sessão nova no intervalo e ela sobreviveria.
- **Rotação de chave de cifragem.** O documento do usuário registra **uma** versão de chave
  para e-mail, endereço e senha. Se a chave ativa é mais nova que a do documento, a troca
  recifra o e-mail e o endereço na mesma gravação; gravar só a senha deixaria o e-mail
  ilegível. Há teste contra o MongoDB real, com chaves v1 e v2.
- **Limite conhecido.** O pedido de recuperação não iguala o tempo de resposta entre e-mail
  existente e inexistente (a diferença é uma gravação e um enfileiramento). A resposta, por
  outro lado, é idêntica.

### Manutenção da própria conta

O UC05 (RF26, RF27) cobre a leitura, a edição, a troca de e-mail e a exclusão. Todas as rotas
exigem sessão, exceto a confirmação da troca de e-mail.

| Endpoint | Acesso | O que faz |
| --- | --- | --- |
| `GET /accounts/me` | sessão | Devolve nome, e-mail, endereço e papel, decifrados só nesta resposta |
| `PATCH /accounts/me` | sessão | Edita o nome e/ou o endereço (`address: null` remove); ao menos um campo |
| `POST /accounts/me/email-change` | sessão | Pede a troca de e-mail; exige a senha atual; responde `202` |
| `POST /accounts/confirm-email-change` | público | Efetiva a troca com o token do link; responde `200` |
| `DELETE /accounts/me` | sessão | Exclui a conta, confirmada com a senha no corpo; responde `204` |

- **Endereço.** CEP, logradouro, número, complemento (opcional), bairro, cidade e UF. É
  serializado em JSON e cifrado; o CEP é guardado só com os dígitos.
- **Troca de e-mail.** O link vai ao **novo** endereço (template `EMAIL_CHANGE_CONFIRMATION`),
  e o e-mail atual vale até ele ser aberto. Exige a senha atual, porque o e-mail é o canal de
  recuperação da conta (um acréscimo ao UC05: sem isso, uma sessão roubada bastaria para
  tomá-la). Domínios da blacklist são recusados. **Se o novo e-mail já é de outra conta, a
  resposta é a mesma do sucesso e nada é enviado**; só o e-mail da própria conta é recusado
  (`EMAIL_UNCHANGED`). Se o endereço passar a ser de outra conta enquanto o link esperava, a
  confirmação responde `409 EMAIL_ALREADY_IN_USE`. As sessões abertas continuam valendo.
- **Versão da chave no token.** O token de troca guarda o novo e-mail cifrado como
  `<versão>:<texto cifrado>`: o link vale por horas, e uma rotação de chave nesse intervalo não
  pode deixar o e-mail indecifrável.
- **Coerência da chave.** Edição de endereço, troca de e-mail e troca de senha passam todas
  pelo `UpdateAccountUseCase`, que recifra os demais campos quando a chave ativa é mais nova
  que a do documento. Há e2e contra o MongoDB real com chaves v1 e v2.
- **Exclusão (LGPD).** Remove a conta e, por cascata do Prisma, sessões, tokens, chaves de API
  e bloqueios; as tentativas de login ficam com IP e data/hora, sem vínculo com o titular
  (`user_id` anulado); os registros de e-mails enviados a ele (que guardam o hash do
  destinatário) são **apagados**. Não há remoção lógica. O access token usado deixa de valer
  na requisição seguinte, porque a sessão sumiu.

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

## Fontes externas (adapters)

Cada fonte externa fica atrás de um adapter próprio, que implementa o contrato
`DataSourceInterface` (`data-sources/domain/data-source.interface.ts`, NFPD02). O adapter diz
**o que** consultar e como ler a resposta; o que é comum a todas as fontes está no
`RequestDataSourceUseCase`, exportado pelo `DataSourcesModule`.

- **Tudo vem do catálogo** (`data_sources`), lido a cada chamada: URL base, `is_enabled`,
  `rate_limit_per_minute` e `request_timeout_ms`. Desabilitar uma fonte ou mudar seu limite
  vale na chamada seguinte, sem novo deploy.
- **Limite por minuto (NFPD01).** Janela **móvel** de 1 minuto em Redis, atômica (script Lua) e
  compartilhada por todas as instâncias e workers. Janela fixa permitiria um pico no fim de um
  minuto somado a outro no começo do seguinte, o dobro do que a fonte aceita. Atingido o teto,
  a fonte não é chamada (`RATE_LIMITED`). **Sem o contador (Redis fora), também não é
  chamada**: ao contrário do limite da API, que libera a requisição, aqui o custo de errar é
  o bloqueio do BIOS pela fonte.
- **Tempo máximo.** `request_timeout_ms` da fonte (padrão de 10 s) vale para a chamada
  inteira, corpo incluído; esgotado, `TIMEOUT`.
- **Cliente HTTP.** `fetch` do Node, sem redirecionamentos (o endereço vem do catálogo, e
  seguir um `Location` levaria a chamada para onde a fonte mandasse) e com corpo limitado a
  5 MiB, lido em fluxo (os dumps em lote, que passam disso, usam o modo `download`, descrito na
  seção do IBAMA). Os segmentos do caminho são codificados na montagem da URL: um valor como
  `../admin` não escapa do caminho da fonte. A consulta é um `GET`, salvo quando o pedido
  informa `body`: aí é um `POST` com esse corpo em JSON (`content-type: application/json`), com
  as mesmas garantias (prazo, limite por minuto, sem redirecionamento, resposta limitada). Só
  existe para fontes cuja busca não tem `GET`, como a listagem de organizações do GHG; o
  corpo, como os cabeçalhos, nunca vai ao log.
- **Log de requisições.** Cada chamada vira uma linha em `data_source_request_logs`: fonte,
  CNPJ, origem (`trigger`), resultado, status HTTP e duração. As recusadas pelo limite entram
  também, sem status. Cabeçalhos (a chave de API da fonte, por exemplo) nunca são gravados.
  Falhar ao gravar o log não perde a chamada.
- **Falhas são resposta, não exceção.** O caso de uso devolve `SUCCESS`, `NOT_FOUND`
  (HTTP 404, uma resposta válida), `FAILURE`, `TIMEOUT`, `RATE_LIMITED` ou `DISABLED`, e quem
  chama (a cadeia de fallback, o job) decide o que fazer. A exceção é a fonte inexistente no
  catálogo, que é erro de programação (`UnknownDataSourceError`).
- **`toLookupResult`.** Converte a resposta para o resultado do adapter (`FOUND`, `NOT_FOUND`
  ou `UNAVAILABLE`, com o motivo). Corpo 2xx fora do formato esperado vira `UNAVAILABLE`,
  nunca dado.

### Cadastro: `CadastralRecord` e o adapter da BrasilAPI

Os três provedores do cadastro (BrasilAPI, OpenCNPJ, Minha Receita) entregam o mesmo
`CadastralRecord` (`data-sources/domain/dtos/providers/cadastral-record.dto.ts`): CNPJ
canônico, razão social, nome fantasia, situação e porte em maiúsculas, endereço, CNAE
principal e secundários. Os normalizadores comuns (`cadastral-normalizers.ts`) fazem o mesmo
cadastro sair igual de qualquer um: código CNAE e IBGE com 7 dígitos e CEP com 8 (os zeros
iniciais que o provedor perdeu ao mandar número voltam), UF em 2 letras, vazio vira `null`.

`BrasilApiDataSource` (`brasil-api/`, slug `BRASIL_API`, prioridade 1 da cadeia) consulta
`GET {base_url}/{cnpj}` pelo `RequestDataSourceUseCase` e converte a resposta:

- **Lista de campos permitidos.** O schema só lê o que o perfil usa. O quadro societário
  (`qsa`: nomes e CPFs de sócios e representantes), o e-mail, o telefone, o regime tributário
  e o capital social nunca são lidos, então não há como chegarem ao BIOS (INL02).
- **Resposta de outro CNPJ é rejeitada.** Se o CNPJ do corpo não é o consultado, o resultado é
  `UNAVAILABLE`: gravar o cadastro de outra empresa sob o CNPJ pedido seria pior que não ter
  dado. O mesmo vale para corpo sem razão social, situação, CNAE principal, município ou UF.
- **Particularidades do provedor.** O item de CNAE secundário com código `0` significa "sem
  secundários" e é descartado (como os repetidos e o igual ao principal). O tipo do
  logradouro (`AVENIDA`) vem à parte do nome (`PAULISTA`) e é juntado a ele. A situação
  vem pela descrição ou, na falta, pelo código da Receita. A descrição do CNAE pode vir
  vazia: o IBGE a completa (RF06).

`OpenCnpjDataSource` (`opencnpj/`, slug `OPEN_CNPJ`, prioridade 2, primeiro fallback) segue
o mesmo molde: `GET {base_url}/{cnpj}`, lista de campos permitidos (o `QSA`, e-mail e
telefones nunca são lidos) e rejeição de resposta de outro CNPJ. Diferenças do provedor:

- **Registro anonimizado é rejeitado.** O OpenCNPJ mascara os dados de empresas cujo titular é
  pessoa física e marca `lgpd_anonimizado`; um cadastro mascarado não é cadastro, então o
  resultado é `UNAVAILABLE`.
- **Sem código IBGE.** O `codigo_municipio` dele é o da Receita (outra tabela): `cityIbgeCode`
  fica `null`.
- **Descrições de CNAE** vêm da lista `cnaes` quando existe; `cnaes_secundarios` traz só os
  códigos. Sem a lista, a descrição fica vazia e o IBGE a completa (RF06).
- **Porte unificado.** `normalizeCompanySize` escreve o porte do mesmo jeito para qualquer
  provedor (`Demais` → `DEMAIS`, `Microempresa` → `MICRO EMPRESA`, `EPP` → `EMPRESA DE PEQUENO
  PORTE`), para trocar de provedor não alterar o cadastro nem o hash de conteúdo.

`MinhaReceitaDataSource` (`minha-receita/`, slug `MINHA_RECEITA`, prioridade 3, fallback
final) fecha a cadeia. A BrasilAPI e o Minha Receita servem os mesmos dados da Receita **no
mesmo formato**, então os dois leem a resposta pelo mapper comum
`data-sources/domain/receita-open-data.mapper.ts`: assim nenhum módulo de adapter depende do
outro (NFPD02), e, se um deles divergir do formato, o mapper dele passa a ser próprio. O
OpenCNPJ tem formato próprio e mapper próprio. Um teste de consistência garante que a mesma
empresa resulte no mesmo `CadastralRecord` em qualquer provedor (salvo o código IBGE, que o
OpenCNPJ não informa).

### Cadeia de fallback cadastral

`ReceitaDataSource` (`receita/`) consulta os três provedores em sequência e devolve o
cadastro **e o provedor que o respondeu** (`{ record, sourceSlug }`): é o `sourceSlug` que
`company_profile.cadastral_source_id` guarda, e é do catálogo dele que vem a janela do cache.

- **A cadeia é do catálogo.** A ordem é `fallback_priority` das fontes `CADASTRAL` habilitadas
  em `data_sources`: reordenar ou desabilitar um provedor é uma alteração no banco, valendo na
  consulta seguinte. O código só conhece os adapters registrados (`CADASTRAL_DATA_SOURCES`).
  Slug do catálogo sem adapter é registrado como erro e ignorado; se o catálogo não puder ser
  lido, vale a ordem de registro.
- **Um provedor por vez.** O seguinte só é chamado quando o anterior não serve, o que poupa o
  limite de cada fonte (NFPD01). Serve para ir ao próximo: indisponibilidade (erro, tempo
  esgotado, limite atingido, resposta fora do formato ou de outro CNPJ) **e também "não
  encontrado"**, porque os espelhos da Receita se atualizam em ritmos diferentes e uma empresa
  recém-aberta pode constar em um e ainda não em outro.
- **"Não encontrado" só quando todos dizem isso.** Se algum provedor consultado não pôde
  responder, o resultado é `UNAVAILABLE` (503 para o usuário), nunca "a empresa não existe":
  seria uma informação falsa. Provedores desabilitados não contam; com todos desabilitados, o
  motivo é `DISABLED`.
- **O histórico vem na mensagem** (`BRASIL_API: TIMEOUT; OPEN_CNPJ: FAILURE; ...`), e cada
  tentativa está em `data_source_request_logs`, por provedor.
- **Defeito de um adapter não derruba a cadeia.** Uma exceção inesperada é registrada como erro
  e tratada como indisponibilidade daquele provedor.

### Descrição dos CNAEs: IBGE

`IbgeCnaeDataSource` (`ibge-cnae/`, slug `IBGE_CNAE`, papel `CNAE_TAXONOMY`, fora da cadeia
cadastral) devolve a descrição oficial de uma subclasse da CNAE (RF06):
`GET {base_url}/subclasses/{código de 7 dígitos}` → `CnaeDescription { code, description }`.
Os provedores do cadastro informam o código e, às vezes, uma descrição própria (o OpenCNPJ pode
não trazer nenhuma); o IBGE é a fonte da taxonomia.

- **Só a subclasse pedida vale.** A resposta pode vir como objeto ou como lista, e o adapter só
  aceita a subclasse de **código igual ao consultado**: de outro modo, a descrição de uma
  atividade seria gravada na empresa errada. Resposta bem formada sem o código (lista vazia, 404)
  é `NOT_FOUND`: o código não existe na taxonomia. Já resposta fora do formato, ou subclasse sem
  descrição, é `UNAVAILABLE`.
- **Grafia do IBGE.** A descrição vem em maiúsculas, como o IBGE a publica, e não é reescrita.
  A hierarquia (classe, grupo, divisão, seção), as atividades e as notas explicativas são
  descartadas.
- **Código que não é CNAE** (`abc`, `0`, 8 dígitos) é `NOT_FOUND`, sem chamar o IBGE.
- **Quem consome deve guardar a descrição.** Ela quase não muda: a janela do catálogo é de 30
  dias (`cache_ttl_seconds`). O adapter não guarda nada; a gravação no perfil, com a descrição
  do IBGE no lugar da do provedor, é da issue de persistência do perfil.

Um adapter novo declara o `slug` da fonte (que o seeder cria), chama
`RequestDataSourceUseCase.execute({ slug, segments, cnpj, context })` e passa a resposta por
`toLookupResult` com o seu *parser*. Fontes que não se consultam item a item, como o dump
diário do IBAMA, definem o próprio fluxo de ingestão (próxima seção).

### Consolidação das evidências por CNPJ (RF07)

`EnvironmentalEvidencesModule` exporta `GetCompanyEnvironmentalEvidencesUseCase`.
Recebe um CNPJ (pontuado ou canônico), valida antes de qualquer efeito e inicia em
paralelo a leitura local IBAMA, o produtor CGU e o produtor GHG. O armazenamento
continua em `EvidencesModule`, sem depender dos adapters e sem ciclo de módulos.

- O IBAMA mantém a consulta ao índice/lote válido e o job avulso sem espera.
- A CGU reutiliza cada cadastro válido na persistência. Quando precisa coletar,
  publica `fetch-cgu-evidences` na fila `environmental-evidences`, deduplicado por
  CNPJ/janela de 15 minutos, e espera até `QUEUE_WAIT_TIMEOUT_MS`. O único
  `EnvironmentalEvidencesProcessor` atende apenas a CGU, com concorrência 3; os jobs IBAMA
  usam a fila própria `ibama-ingestion`. O worker CGU
  consulta CEIS/CNEP em paralelo e persiste os resultados independentemente.
- O GHG mantém fila, concorrência e prazo próprios; sua falha não cancela as
  demais consultas. Os jobs podem terminar depois do prazo de quem espera.
- Ao final, uma releitura local inclui resultados concluídos durante a espera.
  A resposta validada por Zod tem `cnpj` e `categories`, sempre com as três
  categorias. Cada evidência traz `source_slug`, ODS, estado, publicação, coleta,
  validade, resumo, detalhes e referência/link original. A ordem é estável por
  categoria, fonte e chave. Não há score, peso ou veredito de sustentabilidade.
- Somente `CONFIRMED` traz `signal`; `NOT_FOUND`, `UNKNOWN` e `OUTDATED` trazem
  `null`, preservando o sinal histórico no banco. Indisponibilidade preserva a
  resposta anterior e suas datas; sem resposta anterior, registra `UNKNOWN`.
  CEIS/CNEP ficam em `CONDUTA_ADMINISTRATIVA`. Ausência de inventário GHG nunca
  vira `NOT_FOUND`. Falha global do banco continua sendo erro de infraestrutura.

### Referências às fontes originais (RF09)

`GET /companies/:cnpj/evidences` exige sessão JWT e devolve a consolidação por
categoria, validada e documentada no OpenAPI. A rota aceita CNPJ numérico ou
alfanumérico; omita a barra de formatação na URL. CNPJ inválido responde 422 e
ausência de sessão responde 401 antes de consultar fontes.
Um CNPJ válido sem `company_profile` local responde 404 (`COMPANY_NOT_FOUND`)
antes de qualquer leitura de evidências, gravação ou publicação de job. A rota
tem limite próprio de 20 consultas por minuto por IP, além do limite global.

Cada evidência traz `source` (nome público atual do catálogo), `source_slug`,
`source_reference` e `source_url`, além das datas de publicação/coleta/validade.
O link, quando presente, deve ser HTTPS absoluto e não conter credenciais. O
IBAMA aponta ao dataset oficial porque o dump não oferece link individual; o
identificador permite localizar o registro. Recursos CGU podem exigir chave no
próprio órgão, sem incluir a credencial do BIOS na resposta. Uma referência sem
URL é preservada: a API não inventa um endereço para completá-la.

Uma evidência legada `CONFIRMED` sem identificador não vazio nem link HTTPS
válido é projetada como `UNKNOWN`, com sinal, resumo e detalhes nulos. A regra
também é exigida pelo schema de resposta. A projeção preserva o registro no banco
e suas datas; URLs inválidas são removidas da resposta, sem alterar o histórico.
`UNKNOWN`, `NOT_FOUND` e `OUTDATED` não se tornam confirmações e podem ter os
campos de proveniência nulos. Ausência de inventário GHG continua sendo `UNKNOWN`.

A composição do perfil completo e da API pública permanece na #81. Não há
alteração de schema Prisma, variáveis de ambiente ou configuração de filas.

### Índice de aderência por ODS (RF10)

`CalculateCompanyOdsScoresUseCase` recalcula, por CNPJ, todos os ODS ativos
carregados do catálogo e substitui atomicamente os documentos da empresa em
`company_ods_scores`. Cada documento guarda `score_value`, `confidence_value`,
`evidence_count`, contribuições por ID de evidência, `rules_version = rf10-rf11-v3`,
data de cálculo e, quando há perfil cadastral, UF, cidade e CNAEs. O recálculo
preserva o ID e a criação dos documentos existentes e remove o score de um ODS
desativado. Um ODS ativo sem regra explícita interrompe o cálculo antes da escrita.

A escala é assinada, de −100 a 100, sem índice geral: o ODS 13 recebe +60 por
inventário GHG confirmado e rastreável, com teto +100; o ODS 15 recebe −40 por
infração IBAMA (teto −80) e −5 por sanção CEIS/CNEP (teto −20). A soma de
`points` das contribuições reproduz exatamente `score_value`; os tetos impedem
que muitas sanções administrativas superem o sinal ambiental direto.
Sanção CEIS/CNEP com `endDate` anterior ao dia civil em São Paulo pesa −1,25;
termo de embargo com `details.lifted = true` pesa −10. O peso reduzido e o motivo
ficam no retrato e na explicação; autos de infração e registros vigentes conservam
o peso integral. A validade da coleta continua independente do fim da sanção.
Os dois índices não são comparáveis entre si nem vereditos de sustentabilidade.

Somente `CONFIRMED` vigente, com identificador não vazio ou URL HTTPS válida,
gera contribuição. `NOT_FOUND` não dá bônus; `UNKNOWN`, `OUTDATED`, sinal
inconsistente e confirmação sem referência não pontuam. Sem contribuição,
`score_value` é nulo. A confiança RF11 fica em campo separado, entre 0 e 1,
e é zero sem contribuição confirmada. Com contribuição, vale
`teto × (S/M) × (N/(N+1)) × ((1+Q)/(2+Q)) × (S/(S+U+O))`:
`N` é o número de contribuições; `M` é o número de fontes esperadas para o ODS;
`S` são as fontes que responderam com `CONFIRMED` rastreável ou `NOT_FOUND`
vigente; `Q` soma a qualidade dos achados confirmados (IBAMA 1, CEIS/CNEP 0,25,
GHG 1); `U` e `O` contam fontes com `UNKNOWN` e `OUTDATED`, respectivamente.
O teto é 0,25 para ODS 13, por sua baixa cobertura estrutural, e 1 para ODS 15.
`NOT_FOUND` amplia somente a cobertura quando já existe um achado, sem pontuar.
Fonte sem resposta não amplia cobertura; sinal incorreto ou achado sem
rastreabilidade não acrescenta qualidade. A composição no perfil e a API
pública completa ficam na #81.

### Explicação do índice por ODS (RF12)

`GET /companies/{cnpj}/scores/{odsNumber}/explanation` exige sessão JWT e
lê o retrato já gravado em `company_ods_scores`, sem coletar fontes nem recalcular
o índice. A resposta traz `score_value` e `confidence_value` separados,
`rules_version`, data do cálculo e as contribuições em ordem determinística.
Cada contribuição associa o ID da evidência ao nome público e slug da fonte,
categoria, referência ou URL HTTPS original, sinal, peso e pontos efetivos.
`state` é `CONFIRMED` no momento do cálculo; `current_state` informa se a
evidência passou a `OUTDATED` desde então. A soma dos pontos reproduz o índice.
Sanções CEIS/CNEP conservam a categoria `CONDUTA_ADMINISTRATIVA`.

Índice calculado sem contribuição responde 200 com `index_status = UNAVAILABLE`,
`score_value = null` e lista vazia. Empresa/ODS sem score gravado responde 404.
A resposta traz também `coverage_status` (`HAS_RECORDS`, `NO_RECORDS_IN_ALL_SOURCES`,
`NO_RECORDS_IN_SOME_SOURCES` ou `NO_DATA`; nulo em retratos anteriores ao recálculo) e
`sources_without_records`, que distinguem "consultado e sem registros" de "sem dados"
sem pontuar nem criar confiança para a ausência (decisão da #253, em 14 §4.2).
`coverage_status` incoerente com as contribuições responde 409.
Contribuição órfã, inconsistente ou sem proveniência auditável responde 409,
para não apresentar uma explicação parcial como completa. A resposta não
classifica a empresa como sustentável ou insustentável.

### Motivos de UNKNOWN das fontes de evidência (observabilidade)

Os adapters da CGU e do GHG devolvem `UNAVAILABLE` (e a evidência fica `UNKNOWN`) sem lançar
exceção, e antes isso saía mudo: credencial recusada, limite atingido, formato novo e defeito de
programa pareciam a mesma coisa. Agora cada saída sem dado registra **um motivo de um conjunto
fechado** (`UnknownReason`, em `data-sources/domain/unknown-reason.ts`), por uma linha estruturada
(`logSourceUnknown`):

```json
{ "event": "source_unknown", "source": "CGU_CEIS", "reason": "CREDENTIAL_REJECTED" }
```

| Motivo | Quando |
| --- | --- |
| `INVALID_INPUT` | CNPJ ou nome de busca inutilizável |
| `CREDENTIAL_MISSING` / `CREDENTIAL_REJECTED` | sem `CGU_API_KEY` neste ambiente / a fonte respondeu 401 ou 403 |
| `SOURCE_NOT_CONFIGURED` / `SOURCE_DISABLED` | fonte ausente / desabilitada em `data_sources` |
| `RATE_LIMITED` / `TIMEOUT` | limite (o nosso ou HTTP 429) / prazo esgotado |
| `ENDPOINT_NOT_FOUND` / `UNEXPECTED_STATUS` | 404 onde só 200 vale / 2xx diferente de 200 |
| `SOURCE_ERROR` | 5xx, conexão recusada, resposta ilegível |
| `CONTRACT_MISMATCH` | a resposta não tem o formato lido (a fonte mudou de contrato) |
| `PAGINATION_LIMIT` | paginação sem fim (página repetida ou teto de páginas) |
| `NO_CONFIRMED_MATCH` | a fonte respondeu, mas nada foi confirmado como da empresa (ausência não provada) |
| `UNEXPECTED_ERROR` | defeito do programa: sai como **erro**, com o nome da exceção e as linhas da pilha |

O registro nunca leva a credencial, os cabeçalhos, o corpo da resposta, a mensagem de exceção nem
o CNPJ. Falhas esperadas saem como aviso; só `UNEXPECTED_ERROR` sai como erro, para que defeito de
programa continue visível sem arrastar texto vindo da fonte. Contador por fonte e motivo não foi
criado: a linha estruturada já permite contar no agregador de logs. Um valor novo de motivo é uma
decisão deste arquivo, e não texto livre do adapter. O IBAMA fica de fora: suas falhas viram
exceção e `ingestion_runs` com status `FAILED`.

### CGU: CEIS e CNEP (conduta administrativa)

`CguModule` exporta `CeisDataSource`, `CnepDataSource` e
`GetCguCompanyEvidencesUseCase`. O caso de uso recebe CNPJ e `SourceCallContext`,
consulta os dois cadastros separadamente e grava o retrato de cada fonte.
O consumidor ambiental despacha a coleta CGU por fila na consolidação (#75).
A composição do perfil fica na #81; esta entrega não acrescenta endpoint ou cálculo de índice.

- `CGU_API_KEY` é opcional no bootstrap. Sem token, a API continua disponível,
  `/health` informa `checks.cgu_credentials = missing` sem retornar erro, e
  CEIS/CNEP ficam `UNKNOWN` sem publicar coleta nem chamar a CGU. Evidências
  anteriores são preservadas. Configure o token no `.env` local ou secret do
  ambiente para habilitar novas consultas; quando informado, ele deve vir sem
  espaços/controles nem o placeholder do exemplo. Obtenha-o em
  <https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email>.
  Informe só o valor: o adapter monta o header `chave-api-dados`; nunca envie
  o JSON de headers como variável, nem registre ou versione o token.
- As URLs completas dos endpoints vêm do catálogo. A consulta usa
  `codigoSancionado=<CNPJ>` e `pagina=1,2,...`, sem filtro por órgão sancionador.
  Só uma página vazia em HTTP 200 encerra a consulta; página curta ou contendo
  somente CPF não encerra. Página repetida, formato inválido ou limite de 100
  páginas torna a coleta indisponível, sem persistir o resultado parcial.
- Cache separado por cadastro/CNPJ, com TTL do catálogo (seed: um dia), somente
  para consultas completas. O cache contém apenas a whitelist sanitizada e
  mantém a data de coleta original: sua leitura não renova a validade.
  A habilitação no catálogo é verificada antes do cache. Limite por minuto,
  timeout e log de cada página usam a infraestrutura comum (seed: 90/min e 5 s).
- **O limite por minuto é um só para CEIS e CNEP.** As duas fontes usam a mesma chave e o teto
  da CGU é por token, então os dois cadastros dividem um único contador (`CGU_RATE_LIMIT_GROUP`,
  passado como `rateLimitGroup` à infraestrutura comum): a soma das chamadas aos dois nunca passa
  do `rate_limit_per_minute` do catálogo (seed: 90 no total, e não 90 para cada). O teto aplicado
  é o da fonte que está chamando; mantenha o mesmo valor nos dois registros de `data_sources`
  (com valores diferentes, a soma fica limitada pelo maior). Limite atingido, nosso ou HTTP 429,
  vira `UNKNOWN` com motivo `RATE_LIMITED` sem repetir a requisição nem gravar cache.
  **Valor oficial a confirmar:** a página da CGU não pôde ser lida automaticamente; uma cópia da
  documentação (de terceiros) fala em 400/min no horário comercial e 700/min entre 0h e 6h, com
  180/min em oito endpoints restritos, entre os quais não estão o CEIS nem o CNEP, e suspensão do
  token por 8 horas ao exceder. O 90 do seed é conservador diante disso e pode ser ajustado no
  banco, sem deploy, depois de conferido na documentação oficial.
- Cada sanção vira uma evidência `CONFIRMED`, categoria `CONDUTA_ADMINISTRATIVA`,
  ODS 15 e sinal negativo. ID, órgão, tipo e datas são preservados; o link aponta
  ao recurso por ID na API oficial, cujo acesso também exige chave. Ausência
  confirmada vira `NOT_FOUND` e não gera bônus. O motor de scoring é posterior.
- CPF, nomes do sancionado/PessoaDTO, contatos, links fornecidos pela resposta e
  textos livres não entram no cache nem no bruto. Sanções com data final já
  vencida ainda retornadas pela fonte permanecem como registros históricos;
  confirmação da existência do registro não afirma vigência jurídica.
- Falha, timeout, 401/403/404/429 ou resposta parcial não comprovam ausência.
  Sem resposta anterior, a fonte fica `UNKNOWN`; respostas anteriores são
  preservadas e envelhecem para `OUTDATED`. Uma fonte pode responder mesmo
  quando a outra falha. Sem job, o bruto não tem `ingestion_run_id`; cada chamada
  permanece auditada por fonte, CNPJ e origem no log de requisições.

### Lote diário: IBAMA (download e leitura dos dumps)

O IBAMA não tem consulta por CNPJ: publica o dump inteiro de cada recurso, e o MVP ingere dois
(UC14): o **auto de infração** (`.zip` com um CSV por ano, hoje 48 arquivos e cerca de 720 MB
descompactados) e o **termo de embargo** (um `.csv` de cerca de 210 MB). `IbamaDataSource`
(`ibama/`, slug `IBAMA`) **baixa** o dump e entrega um `IbamaDump`, que lê os registros em fluxo.
O adapter não grava nada: a normalização em evidências é a próxima subseção, e o job diário que
agenda, repete e registra tudo isso (checksum, execuções, retry) é a subseção seguinte.

- **Onde estão os arquivos.** `data_sources.base_url` do IBAMA aponta para o armazenamento onde o
  IBAMA os publica (o portal CKAN só aponta para ele), e o adapter acrescenta o caminho de cada
  recurso (`IBAMA_RESOURCES`). Um banco criado antes desta entrega mantém a `base_url` antiga
  (o seed não altera fontes existentes) e passa a receber 404: ajuste `base_url` e
  `request_timeout_ms` (600 000 ms) da fonte no banco.
- **Download em disco, em fluxo.** `RequestDataSourceUseCase` ganhou o modo `download` (mesmo limite
  por minuto, tempo máximo do catálogo e log de requisições): o corpo vai para um arquivo
  temporário, com **limite de tamanho** (1 GiB), **tempo máximo da chamada inteira**, sem seguir
  redirecionamento, e o **SHA-256 é calculado durante a gravação**. Falha, limite ou tempo
  estourado apagam o que foi gravado. O checksum existe para a ingestão encerrar um dump idêntico
  ao da última execução sem reprocessá-lo.
- **404 não é "sem registro".** Para um arquivo, é o dump fora do lugar (URL do catálogo errada ou
  o IBAMA o moveu): o resultado é `UNAVAILABLE`, com a mensagem apontando a `base_url`, nunca
  `NOT_FOUND`.
- **Leitura em fluxo.** CSV com separador `;`, texto livre entre aspas com quebras de linha e, no
  embargo, marca de ordem de bytes (BOM): lido com `csv-parse`; o `.zip`, com `yauzl`, **direto do
  arquivo, sem extrair**. Ler os 712 mil registros do auto de infração leva cerca de 1 minuto e
  usa pouco mais de 120 MB de memória. A soma dos CSVs do `.zip` é limitada a 2 GiB, e o tamanho
  real de cada um é conferido contra o declarado (bomba de descompressão). Uma linha malformada é
  pulada e contada; já **coluna que sumiu** do cabeçalho, `.zip` sem CSV ou cortado é
  `IbamaDumpFormatError`: o IBAMA mudou o dump, e o job deve falhar, não ingerir nada em silêncio.
- **Pessoa física nunca sai do adapter (INL02).** Cada linha passa por `classifyIbamaDocument`
  **antes** de qualquer persistência, inclusive na camada bruta. O **documento decide, não o
  rótulo**: só entra um CNPJ válido (formato e dígitos verificadores, numérico ou alfanumérico). Nos
  dumps de outubro de 2026 há linhas rotuladas `PJ` com um CPF no documento, e o termo de embargo
  nem tem o rótulo; rótulo `PF` descarta mesmo com documento que parece CNPJ. Os descartes são
  contados por motivo (`PESSOA_FISICA`, `SEM_DOCUMENTO`, `DOCUMENTO_INVALIDO`,
  `REGISTRO_MALFORMADO`) e a soma é o `records_discarded` da execução. Nos dumps de hoje: de
  712 288 linhas do auto de infração, 220 108 são de empresa, 458 677 de pessoa física, 32 955 sem
  documento e 548 com documento inválido; do embargo, de 116 865, são 17 737 de empresa e 88 727
  de pessoa física.
- **O que o registro leva.** `IbamaRecord` traz o CNPJ canônico, a referência pública (número e
  série: `1092-A`; os documentos novos têm número alfanumérico e nenhuma série), o identificador
  interno (`SEQ_*`, vazio nos novos) e um payload com **colunas permitidas**
  (`payloadColumns`). Ficam de fora o **nome** do autuado/embargado, o texto livre e as geometrias
  (WKT, que podem pesar megabytes por linha): a empresa já é identificada pelo CNPJ, e o nome é o
  único campo em que um nome de pessoa poderia chegar ao banco.
- **A referência pública não é única.** O mesmo número aparece em mais de uma linha (nos dumps de
  hoje, 425 pares CNPJ e referência se repetem entre os 220 mil do auto de infração). Quem
  normaliza decide como tratar; o adapter entrega as linhas como estão.
- **Quem usa precisa chamar `dispose()`** ao terminar (inclusive em falha): ele apaga a pasta
  temporária do dump. `records()` pode ser chamado de novo (relê o arquivo), e `stats` recomeça.

### Normalização das evidências do IBAMA

`NormalizeIbamaRecordsUseCase` (`ibama/`) transforma os `IbamaRecord` em evidências por CNPJ e as
grava, junto do registro bruto, pela **carga em lote** do módulo de evidências (UC14, passos 3 e
4; RF08). Quem orquestra (o job) abre a carga, baixa e normaliza cada recurso e, se **todos**
deram certo, a encerra:

```ts
const batch = await openEvidenceBatch.execute({ sourceSlug: 'IBAMA', collectedAt, ingestionRunId });
for (const resource of [AUTO_INFRACAO, TERMO_EMBARGO]) {
  const downloaded = await ibama.download(resource, context);
  // ... só segue se FOUND
  try { await normalize.execute({ records: downloaded.data.records(), batch }); }
  finally { await downloaded.data.dispose(); }
}
await batch.finish(); // remove o que o dump deixou de listar
```

- **O que vira evidência.** Cada registro vira uma evidência `CONFIRMED` da categoria e do ODS do
  catálogo (`INFRACAO_AMBIENTAL`, ODS 15, sinal negativo), com a **referência pública** do
  documento (`1092-A`), um **resumo em português** (`Multa simples: Infração da Flora — R$ 6.932,00
  (FORTALEZA/CE)`; `Termo de embargo — Desmatamento — 12,5 ha (Lages/SC)`), **detalhes** com valores
  já convertidos (valor da multa, hectares, município, UF, processo), a **data** do auto ou do
  termo (só o dia, o dump não diz o fuso) e o **link** do conjunto de dados no portal do IBAMA
  (RF09: o dump não traz um link por registro, então a referência identifica o registro nele).
- **Registro anulado não é evidência.** Auto ou termo cancelado (`SIT_CANCELADO = S`), excluído ou
  substituído por outro (`DES_STATUS_FORMULARIO`) é pulado e contado: uma infração anulada não
  aconteceu para efeito de índice, e uma evidência negativa que não vale seria injusta com a
  empresa (IND01). Vale também para o que **passa** a ser anulado: some na carga seguinte.
- **Embargo suspenso continua sendo evidência.** O embargo desembargado aconteceu; o resumo diz
  `desembargado em 01/03/2024` e `details.lifted` o marca. Quanto ele pesa é do cálculo do índice.
- **Identidade da evidência.** O número público se repete no dump, mas o identificador interno
  (`SEQ_*`) não: a chave da evidência é `IBAMA:<cnpj>:AI-<seq>` (auto) ou `TE-<seq>` (termo), e, nos
  documentos novos, que não têm `SEQ`, o número. O prefixo evita colisão entre um auto e um termo
  de mesmo `SEQ`. Dois registros com o mesmo número público e `SEQ` diferentes são duas
  evidências; a mesma linha duas vezes no dump é uma.
- **Registro bruto (auditoria, NFCO02).** Cada registro é gravado em `evidence_raw` uma única vez por
  conteúdo (`payload_hash`, índice único com a fonte): repetir a carga reaproveita o registro e
  mantém a data e a execução da primeira coleta; se o IBAMA **alterar** o registro, nasce uma nova
  versão bruta e a evidência passa a apontar para ela. O payload é o do adapter, **refeito pela lista
  de colunas permitidas** aqui também (sem nome do autuado, texto livre nem geometria).
- **Em fluxo, sem crescer a memória.** Os registros são gravados em lotes de 200, com até 25
  gravações simultâneas (cada uma é o bruto e a evidência). A falha de uma gravação interrompe o
  lote sem iniciar itens novos.
- **Encerrar a carga (`batch.finish()`).** Remove as evidências da fonte, de qualquer empresa,
  coletadas antes da carga: o que o IBAMA deixou de listar, um auto cancelado depois, uma empresa
  que saiu do dump e os `NOT_FOUND` e `UNKNOWN` de antes. **Só se chama depois de todos os recursos
  terem sido carregados**: com um deles faltando, evidências válidas dele seriam removidas. Sem
  chamá-lo (uma carga que falhou), nada é removido, e as evidências anteriores seguem até vencer
  (UC14, fluxo 2.1). A validade de tudo o que a carga grava é renovada (`cache_ttl_seconds`).

### Job diário do IBAMA (consumidor, execuções, retry)

O cron `0 4 * * *` (`QUEUE_SCHEDULES`, id `ibama-daily-ingestion`) publica o job `ingest-ibama-dumps`
na fila `ibama-ingestion`, e o `IbamaIngestionProcessor` (`ibama/infra/queue/`), hospedado
no core, o executa por `IngestIbamaDumpsUseCase` (UC14). O consumidor despacha pelo **nome** do
job; nome desconhecido, payload que não seja um objeto ou job sem identificador falham sem
repetição (`UnrecoverableError`). O mesmo consumidor atende o avulso IBAMA por CNPJ. A consulta CGU
disparada pela consolidação tem fila e consumidor próprios (`environmental-evidences`).

**Decisão do desenho (#262): fila própria + reuso do dump.** Os dumps têm ~330 MB (829 mil linhas)
e o avulso os lê inteiros para achar um CNPJ. Com um só consumidor de concorrência 3, três avulsos
ocupavam todos os workers e os jobs de CGU de quem esperava estouravam o prazo (`UNKNOWN`). Agora:
(1) lote e avulso vivem na fila `ibama-ingestion`, com concorrência 1 — no máximo um download por vez e
nenhuma disputa com a CGU; (2) a `IbamaDumpLease` guarda os dois dumps por 10 minutos
(`IBAMA_DUMP_REUSE_MS`), então avulsos de CNPJs distintos em sequência compartilham **um** download, e
pedidos simultâneos esperam o mesmo download em andamento (single-flight); a leitura é serializada;
(3) a coleta avulsa é datada pelo instante do download, não pelo da leitura; (4) um job que esperou
mais de 1 s na fila registra em log o adiamento (`adiado N s`), e `IbamaDumpLease.stats` expõe
`downloads`, `reuses` e `peakDownloads` para medir o limite de um download por vez. Os arquivos
temporários são apagados quando a janela expira (e ninguém lê), quando são substituídos ou no
encerramento da aplicação.

O fluxo de uma execução, nesta ordem:

1. **Abre a execução** em `ingestion_runs` (`RUNNING`, `run_type = SCHEDULED`, `job_id` do BullMQ).
   O `started_at` é também a **data de coleta** de tudo o que a execução grava.
2. **Baixa os dois dumps** (autos de infração e termos de embargo) e só então decide. Se algum não
   vier, o job falha (`IbamaDumpUnavailableError`, com o motivo de cada um) e a fila o repete.
3. **Compara o checksum.** `dump_checksum` é um só por execução, e o lote tem dois arquivos: guarda-se
   o hash do mapa recurso → SHA-256 de cada arquivo (`combineDumpChecksums`). Muda se **qualquer**
   dos dois muda, não depende da ordem do download e não confunde um arquivo trocado pelo outro. A
   referência é a última execução **agendada `SUCCEEDED`**; uma execução pulada ou falha mais recente não conta.
4. **Dump idêntico** → `SKIPPED_UNCHANGED`: nada é reprocessado, mas a **validade das evidências é
   renovada** (`RenewSourceEvidencesUseCase`: `collected_at` = início da execução e `valid_until` =
   início + janela da fonte, num único `updateMany`, só para `CONFIRMED` e `NOT_FOUND` da fonte; a
   `UNKNOWN` não envelhece e as de outras fontes não são tocadas). Sem isso, o IBAMA republicando o
   mesmo arquivo por um fim de semana deixaria, passados os dois dias de validade, todas as evidências
   `OUTDATED` com o dado vigente.
5. **Dump diferente** → abre a carga, normaliza e grava os dois recursos em fluxo e, **só depois dos
   dois**, encerra a carga (`batch.finish()`), que remove o que o dump deixou de listar. Em nenhuma
   falha o `finish` roda.
6. **Encerra a execução** (`SUCCEEDED`) com `records_read` (linhas lidas dos dois dumps, as
   descartadas incluídas), `records_upserted` (evidências gravadas) e `records_discarded` (as linhas
   descartadas por pessoa física, sem documento, documento inválido ou malformadas, **mais** os registros
   anulados que não viraram evidência).
7. **Apaga os arquivos temporários** dos dois dumps, sempre (`finally`), com sucesso, skip ou falha.

- **Uma execução por job.** As tentativas do mesmo job (`job_id`) reabrem a mesma linha de
  `ingestion_runs` (volta a `RUNNING`, com o início da nova tentativa e sem o erro anterior), em vez de
  gerar uma linha por tentativa. Por isso `started_at` é o início da tentativa que de fato gravou.
- **`FAILED` só na última tentativa.** O consumidor compara `attemptsMade + 1` com as tentativas do
  job: nas intermediárias a execução segue `RUNNING`; na última, ou num erro que não admite repetição
  (fonte `IBAMA` **desabilitada** no catálogo, que falha já na primeira tentativa com
  `UnrecoverableError`), vira `FAILED` com a mensagem (até 500 caracteres, sem dado pessoal). Falhar a
  execução **não apaga evidência alguma**: as anteriores seguem até o fim da validade e então aparecem
  como `OUTDATED` (UC14, fluxo 2.1). Se nem gravar o `FAILED` for possível, o erro original é o que sobe
  para a fila.
- **Retry e backoff.** O agendamento declara 5 tentativas com backoff exponencial de base 5 min (5, 10,
  20 e 40 min) — ver "Filas (BullMQ)". Jobs fora do agendador seguem a política da fila.
- **Concorrência e data.** Lote e avulso compartilham `ibama-ingestion`, com concorrência 1 por
  consumidor. Como o avulso pode reutilizar um dump baixado antes do lote, a persistência compara
  `collected_at`: uma coleta antiga não substitui um retrato mais novo, mesmo se concluir depois.
  Uma reexecução de job mantém as chaves idempotentes e o avulso só altera o CNPJ solicitado.
- **Recálculo do índice fica fora.** O passo 5 do UC14 (recalcular o índice dos CNPJs afetados) é o
  gatilho de ingestão do recálculo por fila (UC15). O conjunto de afetados não é guardado: toda evidência
  da execução tem `collected_at` igual ao `started_at` dela, e o bruto aponta a execução.
- **Disparo manual.** Não há endpoint. Em desenvolvimento, publique o job na fila
  (`queue.add('ingest-ibama-dumps', {})`) ou use a política de teste dos e2e.
- **Bancos criados antes da #69.** O seed não altera fontes existentes: confira `base_url`,
  `request_timeout_ms` (600 000) e `cache_ttl_seconds` (172 800) da fonte `IBAMA`; sem isso o download
  recebe 404.

**Medido com os dumps reais** (21/10/2026, MongoDB e Redis locais, os dois arquivos servidos por um
servidor HTTP local): a primeira execução leva **cerca de 10,5 min** (629 s) para ler 829 239 linhas,
gravar **229 184 evidências** (e o mesmo número de registros brutos) e descartar 600 055 (pessoa física,
sem documento ou inválido, e anulados); o pico de memória do processo de teste foi de 230 MB. O job
não foi dado como travado em nenhum momento (`stalledCounter = 0`), então o `lockDuration` padrão
(30 s) basta enquanto a leitura é assíncrona. A segunda execução, com os mesmos arquivos, terminou
como `SKIPPED_UNCHANGED` em **12 s**: nenhum registro lido, nenhuma evidência nova, e as 229 184
existentes com a validade renovada.

### Consulta local e job avulso do IBAMA por CNPJ

`GetIbamaCompanyEvidencesUseCase` consulta somente o IBAMA e publica a coleta sem esperar
seu resultado (UC07, fluxo 1.1; UC14). O caso de uso é exportado pelo `IbamaModule` para a
consolidação ambiental e o perfil completo; esta entrega não acrescenta endpoint nem altera
a resposta cadastral atual.

- Evidências `CONFIRMED` ou `NOT_FOUND` válidas são devolvidas sem download.
- Se o CNPJ não tem resposta local, a última carga **agendada** `SUCCEEDED` ou
  `SKIPPED_UNCHANGED` ainda válida comprova a ausência: grava `NOT_FOUND` com a data
  de início desse lote e sua janela de validade. A consulta não renova essa janela.
  Uma execução `ON_DEMAND`, um lote falho ou ainda em andamento não comprovam o índice inteiro.
- Sem essa referência, grava `UNKNOWN` antes de publicar o job
  `ingest-ibama-company`, payload `{ cnpj }` canônico, na fila `ibama-ingestion`.
  Um `UNKNOWN` válido evita outra publicação durante 15 minutos. O identificador
  `ibama-cnpj-<cnpj>-<janela de 15 min>` deduplica publicações concorrentes na mesma janela.
  Se a publicação reportar fila indisponível, a consulta preserva a resposta local.
- Respostas anteriores vencidas continuam disponíveis como `OUTDATED` enquanto a atualização
  é publicada; indisponibilidade não as substitui por `UNKNOWN`.

O mesmo consumidor do lote despacha `IngestIbamaCompanyUseCase`. Cada job abre uma execução
`ON_DEMAND` com `cnpj` e `job_id`; os downloads têm trigger `ON_DEMAND_JOB` e apontam
essa execução. Baixa e lê integralmente **os dois** dumps, incluindo a validação de cada
cabeçalho, mas guarda em memória e persiste apenas os achados do CNPJ solicitado.
Um CSV sem cabeçalho ou com colunas obrigatórias ausentes falha mesmo sem linhas de dados;
um cabeçalho válido sem registros confirma um recurso vazio.

Somente após ambas as leituras, `RecordEvidenceEntriesUseCase` grava os brutos com o mesmo
hash usado pelo lote e substitui o retrato dessa empresa. Não chama `batch.finish()`:
evidências de outros CNPJs e de outras fontes ficam intactas. Sem achados, grava
`NOT_FOUND`; falha de download ou formato preserva o retrato anterior, ou deixa
`UNKNOWN` quando nunca houve resposta.

O avulso registra checksum combinado para auditoria, mas seu sucesso não é referência de
checksum nem de atualidade do lote completo. Suas contagens incluem todas as linhas lidas,
as evidências gravadas (inclusive o marcador de ausência) e os descartes do parser, anulados
e registros de outros CNPJs. Repetições reabrem a mesma execução; `FAILED` só na última
tentativa, ou imediatamente se a fonte estiver desabilitada. Usa a política já existente
da fila: 5 tentativas, backoff exponencial de base 5 segundos.

Validação local com os dumps oficiais já baixados na entrega anterior (123 095 496 bytes
+ 210 516 004 bytes): os dois cenários reais passaram em cerca de 184 s no total. O CNPJ
presente gerou 2 535 evidências; o ausente terminou como `NOT_FOUND`, preservando outra
empresa. O arquivo completo teve 829 239 linhas. Essa validação usa os arquivos preservados,
sem afirmar uma nova consulta ao armazenamento público.

Os temporários são descartados no `finally`. A deduplicação é por janela; a guarda temporal
na persistência cobre também jobs de janelas diferentes. O instante do download do avulso
é comparado ao da coleta completa ou avulsa mais recente. O recálculo por fila continua no
UC15 (#80).

## Consulta de empresa por CNPJ

`GET /companies/:cnpj` devolve o perfil cadastral (UC06, RF03, RF05, RF06): razão social, nome
fantasia, situação cadastral, porte, endereço e CNAE principal e secundários com descrição.
Exige sessão. Dados de sócios e administradores não existem no perfil (INL02).

- **CNPJ.** Validado por formato e dígitos verificadores; aceita o numérico e o **alfanumérico**
  (emitido pela Receita desde julho de 2026) e é normalizado (sem pontuação, em maiúsculas)
  antes de virar chave de cache, de job e de consulta. Inválido: `422 INVALID_CNPJ`. A barra
  da máscara deve ir codificada (`%2F`) ou omitida, pois separa segmentos da URL.
- **A consulta não fala com os provedores: pede à fila.** Resolução, do mais barato ao mais
  caro:
  1. **cache** (Redis, namespace `company-profile`), resposta imediata (NFDE02);
  2. **banco**: cadastro guardado dentro da janela de `data_sources.cache_ttl_seconds` da
     fonte que o respondeu, servido sem consulta externa e devolvido ao cache (NFDE01);
  3. **fila**: publica o job e espera, com prazo (`QUEUE_WAIT_TIMEOUT_MS`). Quem atende é o
     `CompanyProfileProcessor`, hospedado no core (descrito abaixo). Os dois lados conversam
     só pela fila (`14-Projeto-e-Arquitetura.md`, seção 2), o que permite movê-lo para um
     processo próprio sem tocar na consulta.
- **Degradação graciosa (NFCO01).** Com os provedores indisponíveis (job falho, prazo
  estourado, Redis fora, resultado fora do contrato), o cadastro guardado é servido mesmo
  vencido, com `refreshed_at` mostrando a idade, e **não** volta ao cache. Sem cadastro
  guardado: `503 COMPANY_DATA_UNAVAILABLE`, que não se confunde com
  `404 COMPANY_NOT_FOUND` (os provedores confirmaram que o CNPJ não existe).
- **Um job por CNPJ por minuto.** O `jobId` é `company-profile-<cnpj>-<janela de 60 s>`:
  pedidos simultâneos, e os repetidos dentro do minuto, compartilham o job **e o resultado**,
  o que poupa o limite de requisições das fontes (NFPD01). A janela existe porque o BullMQ
  ignora a publicação de um `jobId` que já existe e os jobs falhos são mantidos: com um id
  fixo por CNPJ, uma única falha o bloquearia para sempre.

### Consumidor da fila e contrato do job

`CompanyProfileProcessor` (`companies/infra/queue/`) consome a fila `company-profile`
(`QueueName.COMPANY_PROFILE`), com até 5 CNPJs ao mesmo tempo. Por job:

| Item | Valor |
| --- | --- |
| Nome do job | `fetch-company-profile` |
| Payload | `{ "cnpj": "<14 caracteres canônicos>" }` |
| Efeito | Percorre a cadeia de provedores, completa os CNAEs com a descrição do IBGE, mascara CPF e grava `company_profile` |
| Retorno | `{ "outcome": "FOUND" }`, `{ "outcome": "NOT_FOUND" }` ou `{ "outcome": "SOURCES_UNAVAILABLE" }` |
| Falha | Erro nosso (ex.: banco fora): propaga, e a fila repete (3 tentativas, backoff exponencial) |
| Job malformado | Nome desconhecido ou CNPJ que não é canônico e válido: `UnrecoverableError`, **sem repetição** |

"Provedores indisponíveis" é **resultado**, e não erro: quem espera é um usuário, e repetir por
trás dele não ajuda. Quem pede valida o retorno contra o schema
(`CompanyProfileJobResultSchema`): resposta fora do contrato é tratada como fonte indisponível.

O `RefreshCompanyProfileUseCase` faz, nesta ordem:

1. **Cadeia de provedores** (`ReceitaDataSource`): cadastro e provedor que respondeu.
2. **Descrição oficial dos CNAEs** (`ResolveCnaeDescriptionsUseCase`, IBGE): substitui a do
   provedor, para a mesma atividade ter o mesmo texto qualquer que seja a fonte. As descrições
   ficam em cache (namespace `cnae-description`, janela de `IBGE_CNAE`, 30 dias no seed), então
   uma empresa nova com CNAEs conhecidos não chama o IBGE. Ao primeiro "indisponível", a
   rodada para de consultar os demais códigos; sem a descrição oficial, vale a do provedor, e o
   cadastro é gravado do mesmo jeito.
3. **CPF mascarado (INL02).** A Receita grava a razão social de empresário individual e de MEI
   como `NOME 12345678901`. Toda sequência de 11 dígitos (com ou sem a pontuação do CPF) vira
   `***` na razão social e no nome fantasia. O nome do empresário é público por lei; o CPF não
   precisa ser. Só pessoa jurídica chega ao banco: o quadro societário, o e-mail e os telefones
   nunca são lidos pelos adapters.
4. **Hash do conteúdo.** `content_hash` é o SHA-256 de nome, situação, porte, endereço e
   atividades (CNAEs em ordem de código). Ficam **fora** dele o provedor, o instante e o código
   IBGE do município (só alguns provedores o informam), então trocar de provedor não muda o hash.
   Se o conteúdo mudou, o hash que estava gravado vira `previous_content_hash`; reatualizar um
   cadastro igual preserva o histórico da última mudança.
5. **Código IBGE do município.** O OpenCNPJ não o informa; se o município é o mesmo do perfil
   já gravado, o código conhecido é mantido.
6. **Grava e descarta o cache** do perfil, para a próxima leitura trazer o dado novo. Um campo
   que deixou de existir na fonte (o nome fantasia, por exemplo) é gravado como `null`, e não
   omitido, para não sobrar o valor antigo.

Fica fora desta entrega: o perfil ambiental (UC07: evidências e índice por ODS).

## Busca de empresa por nome

`GET /companies?name=<texto>&page=<n>&page_size=<n>` lista as empresas pela razão social ou pelo
nome fantasia (UC06 fluxo 1.1, RF04) para quem não conhece o CNPJ; o usuário escolhe uma e abre o
perfil em `GET /companies/:cnpj`. Exige sessão, como a consulta por CNPJ.

- **Só a base local.** Nenhuma fonte cadastral (BrasilAPI, OpenCNPJ, Minha Receita) oferece busca
  por nome, então a busca opera **apenas sobre os perfis já guardados**: uma empresa que ninguém
  consultou pelo CNPJ não aparece. A busca nunca chama provedor nem publica job
  (`SearchCompaniesByNameUseCase`); quem a abre depois pelo CNPJ dispara a atualização, se o
  cadastro venceu.
- **O que casa.** Aproximação por **início de palavra**: a empresa entra quando *cada* palavra
  digitada começa alguma palavra da razão social ou do nome fantasia, em qualquer ordem. `petro`
  acha `PETROLEO BRASILEIRO S A PETROBRAS`; `limpeza urbana` acha `URBANA LIMPEZA LTDA`; `leo`
  (meio de palavra) não acha. Caixa, acentos e pontuação (`S.A.`) são ignorados nos dois lados:
  o texto digitado é normalizado (`extractNameTerms`: sem acento, maiúsculas, só `A-Z`/`0-9`) e
  cada letra vira a classe que aceita as formas acentuadas do cadastro. Como as palavras só têm
  letras e dígitos, nada do que o usuário digita vira metacaractere da expressão regular.
- **Por que expressão regular e não o índice de texto do MongoDB.** O índice de texto só casa
  palavras inteiras (`petro` não acharia `PETROBRAS`), o que é fraco para "aproximação de nome".
  O índice `@@fulltext` que o schema tinha foi **removido** (schema e DBML), por não ser usado.
  O custo é uma varredura da coleção; aceitável porque a base são só as empresas já consultadas.
  Se ela crescer, o caminho é um campo de busca normalizado e indexado.
- **Limites da consulta.** O texto tem até 100 caracteres, no máximo 8 palavras contam, e é
  preciso **ao menos uma palavra com 3 caracteres ou mais** (`a b do` é recusado): sem isso, a
  busca varreria a base inteira. Fora disso: `422 VALIDATION_FAILED`.
- **Ordem.** Primeiro quem *começa* pela frase digitada (as palavras na ordem digitada, no início
  da razão social ou do nome fantasia); depois as demais. Desempate pela razão social e pelo
  CNPJ, o que torna a paginação estável. `ambev` lista `AMBEV S.A.` antes de
  `DISTRIBUIDORA AMBEV`.
- **Resposta.** `{ data, pagination }`, com `pagination = { page, page_size, total,
  total_pages }` (padrão das listagens, em `pagination.dto.ts`; `page_size` até 100, padrão 20).
  Cada item é o resumo para reconhecer a empresa: `cnpj`, `legal_name`, `trade_name`,
  `registration_status`, `city`, `uf` e o CNAE principal. Nada achado é `200` com `data: []`, e
  não `404`; página além do fim traz a lista vazia e o `total` correto.
- **Dados pessoais (INL02).** A busca lê a razão social já gravada, que tem o CPF do empresário
  individual/MEI mascarado (`***`). Logo, digitar um CPF não encontra o titular, e o nome dele
  (público por lei) continua achável.
- **Uma agregação só.** O `$facet` do pipeline (`company-name-search.pipeline.ts`) devolve a
  janela e a contagem total numa única ida ao banco; a resposta é validada contra o schema antes
  de sair do repositório.

## Evidências (modelo e persistência)

`EvidencesModule` guarda o resultado de consultar cada fonte de evidências para cada empresa
(RF08, UC14). Ainda não há rota: quem grava são as ingestões de cada fonte (IBAMA, CGU, GHG), e
quem lê é o perfil ambiental (UC07). O módulo exporta dois casos de uso.

**Estados (`EvidenceState`).** Nunca um booleano (IND02):

| Estado | Quer dizer | Pontua? |
| --- | --- | --- |
| `CONFIRMED` | a fonte tem um registro da empresa | sim, com o sinal da categoria |
| `NOT_FOUND` | a fonte foi consultada e **não tem** registro | não é sinal negativo |
| `UNKNOWN` | **não foi possível saber** (fonte fora do ar, job em andamento) | não; só reduz a confiança |
| `OUTDATED` | passou da validade; aguarda nova coleta | decidido no cálculo do índice |

- **`OUTDATED` é derivado na leitura**, e não gravado: `ListCompanyEvidencesUseCase` devolve
  `OUTDATED` para a evidência `CONFIRMED` ou `NOT_FOUND` cuja `valid_until` passou. Não há job que
  vire o estado, e uma fonte fora do ar não mantém evidência "viva" além do prazo. `UNKNOWN` não
  envelhece (não há dado a ficar velho) e tem janela própria de nova tentativa de **15 minutos**
  (`UNKNOWN_RETRY_WINDOW_SECONDS`), para não martelar uma fonte que acabou de falhar.
- **Validade.** `valid_until = coletada em + data_sources.cache_ttl_seconds` da fonte; sem janela
  no catálogo vale `CACHE_DEFAULT_TTL`. O seed do IBAMA ganhou 2 dias (o job diário renova; uma
  execução perdida não vence a base). O seed não altera fontes que já existem: um banco antigo
  mantém a janela dele até ser ajustada em `data_sources`.
- **Categoria e ODS vêm do catálogo** (`data_sources.evidence_category` e `ods_id`, via
  `ResolveEvidenceSourceUseCase`), e o **sinal vem da categoria** (`signalForCategory`: emissão de
  GEE positivo; infração e sanção negativos). Quem normaliza um registro só diz a fonte e o que
  encontrou; nunca escolhe categoria, ODS ou sinal.

**Gravação: `RecordEvidenceCollectionUseCase`.** Recebe `{ cnpj, sourceSlug, result }`, em que
`result` é `COLLECTED` (com zero ou mais registros) ou `UNAVAILABLE`. O resultado é um **retrato da
fonte para a empresa**:

- com registros: cada um vira uma evidência `CONFIRMED`; o que a fonte tinha antes e agora não lista
  (inclusive um `NOT_FOUND` ou `UNKNOWN` antigo) é removido. Sem isso, a empresa teria ao mesmo
  tempo uma infração confirmada e um "nada encontrado";
- sem registros: uma evidência `NOT_FOUND` substitui as anteriores da fonte;
- fonte indisponível: **nada é apagado**. Havendo coleta anterior que respondeu, ela fica e
  envelhece até `OUTDATED`; não havendo, grava-se `UNKNOWN`.

**Idempotência.** A `evidence_key` é determinística: `<fonte>:<cnpj>:<referência>` para um registro
e `<fonte>:<cnpj>#NOT_FOUND` / `#UNKNOWN` para o resultado da consulta. O CNPJ entra na chave para
que a mesma referência em duas empresas (um auto com mais de um autuado) nunca sobrescreva a
evidência da outra. Repetir uma coleta atualiza em vez de duplicar, preserva `created_at`, renova
a data e a validade e **limpa** o campo que a fonte deixou de informar (grava `null`, e não omite).
O retrato de uma empresa e fonte usa uma transação MongoDB e um relógio por fonte/CNPJ em
`evidence_collection_clocks`. Assim, inclusão, atualização e remoção obedecem à mesma data de
coleta, inclusive quando o retrato novo está vazio. A coleta `UNAVAILABLE` só grava `UNKNOWN`
quando a transação confirma que não há resposta anterior. A carga em fluxo usa ainda um relógio
do dump completo da fonte. Uma coleta antiga é ignorada; uma data igual pode reprocessar a mesma
coleta. O índice único continua garantindo a identidade de cada evidência.
Antes de ativar esta versão em um banco existente, aplicar `npm run db:push` para criar o
índice único de `scope_key`; sem ele, instâncias simultâneas não disputam o mesmo relógio.

Quando a referência que a fonte exibe **não é única** (o IBAMA repete o número de um auto em
registros diferentes), o registro informa uma `identity`, que passa a compor a chave no lugar da
referência; a referência continua sendo o que se mostra ao usuário (RF09).

**Carga em lote: `OpenEvidenceBatchUseCase`.** Para as fontes em lote (o dump diário do IBAMA, com
centenas de milhares de registros de muitas empresas), o retrato por empresa não serve: a carga é
**em fluxo**. `batch.write(entradas)` grava cada registro ao chegar, o bruto (`evidence_raw`, uma
vez por conteúdo) e a evidência, sem acumular nada na memória; `batch.finish()` remove, ao final,
as evidências da fonte que a carga não renovou (`collected_at` anterior à carga). A fonte e a
validade são lidas do catálogo uma vez, na abertura. Falhar no meio não apaga nada, pois quem não
chamou `finish` não removeu evidência alguma.

Erros de configuração (fonte que não é de evidências, CNPJ não canônico, registro sem referência)
são falhas de programação, e não exceções de domínio: `EvidenceSourceNotFoundError` e
`InvalidEvidenceError`.

## Chaves de API

`POST /api-keys`, `GET /api-keys` e `DELETE /api-keys/:id` (UC11, RF16) deixam o usuário gerar,
listar e revogar as próprias chaves. Exigem sessão (JWT); a **autenticação por chave** nas
rotas públicas é o UC12, descrito mais abaixo.

- **Formato.** `bios_<id público de 8 caracteres>_<segredo de 256 bits em base64url>`. O
  prefixo (`bios_` + id público) é o que a listagem mostra e o que a busca por chave usará;
  o segredo vem do mesmo gerador criptográfico dos demais tokens opacos.
- **Exibição única.** O `POST` devolve a chave completa (`key`) uma só vez. O banco guarda
  apenas o SHA-256 da chave inteira (`key_hash`) e o prefixo; a listagem nunca traz a chave
  nem o resumo. Perdeu a chave: revoga e gera outra.
- **Teto.** Até 10 chaves ativas por usuário (`422 API_KEY_LIMIT_REACHED`, com `details.limit`);
  revogar libera a vaga. O id público tem 62⁸ possibilidades, e uma colisão (índice único em
  `key_prefix`) gera um novo id, com até 3 tentativas.
- **Revogação.** Definitiva e imediata, só pelo dono: a posse faz parte da própria escrita
  (`updateMany` filtrando `id_api_key` + `user_id` + não revogada), sem leitura prévia. Chave
  alheia, inexistente, malformada ou já revogada: o mesmo `404 API_KEY_NOT_FOUND`. O registro
  fica com `revoked_at` e some da listagem.

### API pública (consulta por chave)

`GET /v1/companies/:cnpj` (UC12, RF17) devolve o mesmo perfil da consulta do painel, para
sistemas de terceiros, autenticado pelo cabeçalho `x-api-key` em vez de uma sessão. O `v1`
reserva espaço para evoluir o contrato sem quebrar quem já integrou. A resposta cresce com as
evidências e os índices por ODS quando o perfil ambiental (UC07) existir.

- **`@ApiKeyAuth()`** é o que declara uma rota como API pública: reúne `@Public()` (dispensa a
  sessão), o `ApiKeyGuard`, `@PublicApiRoute()` (liga o limite por chave) e o esquema
  `api-key` no OpenAPI. Quem expõe um endpoint público importa `ApiKeysModule` e usa o
  decorator.
- **Conferência.** O prefixo público (`bios_` + 8) localiza a chave pelo índice único; o SHA-256
  da chave inteira é comparado ao guardado em tempo constante. O resumo é calculado antes da
  busca, para a chave desconhecida não responder mais depressa que a de segredo errado.
- **`401 INVALID_API_KEY`, sempre igual.** Ausente, malformada, desconhecida, com segredo errado
  ou revogada recebem a mesma resposta (a revogação vale na chamada seguinte). Um erro do banco
  não vira 401: propaga como indisponibilidade.
- **Ordem dos guards.** O limite de requisições vem antes da conferência da chave: tentativas
  com chaves inventadas gastam cota e passam a tomar 429, em vez de martelar o banco.
- **Último uso (`last_used_at`).** Gravado na chamada autenticada, com precisão de **1 minuto**
  (`LAST_USED_PRECISION_MS`): dentro da janela a data não é regravada, o que evita transformar
  cada leitura da API em escrita; a condição é da própria escrita (`updateMany`), então chamadas
  simultâneas não gravam duas vezes. Falhar em registrar o uso não derruba uma chamada legítima.
- **Separação das credenciais.** A sessão (JWT) não vale na API pública, e a chave de API não vale
  nas rotas do painel, inclusive no gerenciamento das próprias chaves.

## Inventário GHG Protocol (UC07)

`GhgModule` exporta `GetGhgCompanyEvidencesUseCase.execute(cnpj)`. Ele reutiliza a
evidência local válida ou publica `fetch-ghg-inventory` na fila exclusiva
`ghg-inventory` e aguarda com `data_sources.request_timeout_ms` (padrão 10 s).
Timeout, job falho ou Redis indisponível preservam a resposta anterior; sem ela,
`UNKNOWN`. O job pode concluir depois do timeout do chamador. A consolidação já reúne o GHG
na #75; a exposição no perfil fica na #81. Não há endpoint nem score novo.

O processor lê razão social/nome fantasia do perfil local para localizar até três
candidatos no catálogo público. Os serviços usados pelo próprio portal foram
verificados em `assets/appconfig.json` e no JavaScript público: JSON ABP em
`registropublicodeemissoesapi.fgv.br/api/services/app/EstatisticaPublica/`
(`SearchAllOrganizations` e `GetReportedInventories?organizationId=...`) e PDF em
`sistema-registropublicodeemissoesapi.fgv.br/GenerateReport/GenerateInventoryReport/<org>/<ciclo>/true`.
São recursos do portal sem contrato REST oficial estável. HTML de erro com HTTP
200, HTTP 206/404, erro de envelope, relatório sem identidade ou ano divergente
não são aceitos como dados nem como prova de ausência.

**O cadastro de organizações é paginado.** A única rota que o lista é
`SearchAllOrganizations`, um `POST` com corpo JSON `{ maxResultCount, skipCount }`
que responde `{ total, organizations }`. Sem `maxResultCount` ela devolve só **10**
organizações, o máximo aceito é **1000** (acima disso, HTTP 400) e uma página além do
fim volta vazia, com o `total`. A rota `GetAllOrganizations`, que a primeira versão
usava, **não** é o cadastro: devolve a mesma amostra de 10 organizações, e tomá-la por
ele deixava a coleta cega para a quase totalidade das empresas (em 22/10/2026, o
portal tinha 1029 organizações). Uma página vazia antes do total, um total acima de
20 000 ou uma página fora do contrato são resposta anormal (`UNKNOWN`), nunca dado.

**O cadastro é sincronizado uma vez por dia, e a coleta de cada CNPJ o lê pronto.**
Cada chamada à busca leva cerca de 3 s de latência fixa mais ~5 ms por item (uma
página de 1000 levou ~7 s e pesa ~1,5 MB): a listagem completa levava ~11 s, mais que
os 10 s do catálogo, e era refeita a cada empresa. Hoje:

- **Sincronização.** O job `sync-ghg-organizations` (fila `ghg-inventory`, agendamento
  `ghg-organizations-sync`, todo dia às 03:30) lê o cadastro em páginas de **500** (cada
  chamada fica em ~5 s, bem abaixo do tempo máximo do catálogo) com orçamento próprio de 120 s
  para a listagem inteira, e o guarda no Redis (`GhgOrganizationDirectory`, namespace
  `ghg-organizations`: id e nome de cada organização, mais a data). Repetição: 5 tentativas,
  backoff exponencial de base 1 min (1, 2, 4 e 8 min); fonte desabilitada falha já na primeira,
  sem repetir. As chamadas entram no log de requisições como `SCHEDULED_JOB`, sem CNPJ.
- **Só grava completo.** O cadastro novo substitui o anterior apenas depois de todas as páginas
  lidas e válidas; falha, resposta fora do contrato ou página vazia antes do total não gravam nada,
  e o cadastro anterior segue valendo.
- **Vale sete dias.** Falhas seguidas da sincronização diária não cegam a coleta de imediato.
  É cache, não fonte de verdade: vive no Redis e é reconstruível pela fonte, então **não há
  coleção nem migração**. Se faltar (primeira execução, Redis limpo), a primeira coleta que o
  precisa o sincroniza na hora, antes de o prazo daquela coleta começar a contar, e as seguintes
  o reaproveitam; como a coleta pode então passar do prazo de quem espera, o resultado aparece na
  consulta seguinte, sem repetir a listagem.
- **A coleta de um CNPJ não lista o portal.** Localiza os candidatos no cadastro guardado e só
  então busca os inventários e o relatório (2 chamadas). Empresa sem organização no cadastro
  não faz **nenhuma** chamada externa e fica `UNKNOWN` (janela de 15 min): por isso não há um
  cache negativo à parte.
- **Prazo do catálogo.** O `request_timeout_ms` de 10 s passa a bastar: vale para cada chamada e
  para o fluxo do CNPJ (inventários + PDF), sem a listagem. **Medido com o portal real
  (22/10/2026), com o prazo padrão de 10 s do catálogo, sem ampliá-lo:** o job de sincronização,
  pelo worker real, levou **13,8 s** e guardou as **1029** organizações (três chamadas, de 4,9 s,
  5,7 s e 3,0 s, todas abaixo dos 10 s); a coleta de duas empresas de organizações fora das 10
  primeiras (ids 5979 e 8119, inventário 2025) levou **1,9 s e 1,1 s**, `CONFIRMED`, com duas
  chamadas cada e nenhuma à listagem; uma empresa sem organização no cadastro voltou `UNKNOWN`
  em 0,2 s e **sem nenhuma chamada externa**.

O catálogo não traz CNPJ. Nome é somente uma pista: o CNPJ exato e o ano do PDF
precisam corresponder à empresa e ao inventário listado. Verifica-se o ano mais
recente, sem inferir cobertura histórica ou vínculo entre empresas de um grupo.
Sem cadastro local, candidato ou inventário verificável, registra-se `UNKNOWN`,
com nova tentativa após 15 minutos. Resposta anterior vencida permanece `OUTDATED`.

Cada coleta usa um prazo total; cada chamada respeita também limite, timeout e
log da infraestrutura comum. O PDF (máximo 5 MiB) é lido nas três primeiras páginas
por `pdfjs-dist` em thread descartável, com limite de 128 MiB no heap V8 e prazo restante.
Somente CNPJ, organização, ciclo e ano saem da extração. O bruto é esse retrato
reduzido, sem contato, nome de responsável ou texto integral; o arquivo temporário
é removido. `published_at` permanece nulo: ano inventariado não é publicação.
O cache por CNPJ guarda o mesmo retrato por 30 dias (TTL do catálogo), conservando
`collectedAt`. Fonte desabilitada não usa esse cache nem a rede. A persistência
aplica a guarda temporal por fonte/CNPJ; a falha do portal não apaga uma resposta anterior.

A seed nova aponta para o host JSON. Catálogos existentes que ainda usam
`https://registropublicodeemissoes.fgv.br` continuam compatíveis: o adapter resolve
os dois hosts oficiais, conforme o portal. O seed não sobrescreve configurações.
Nenhuma variável de ambiente ou migração de schema foi adicionada.

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
  job e relatório completo como artefato. A imagem do MongoDB é **fixada no patch**
  (`mongo:8.3.11`), para o CI e cada máquina rodarem o mesmo banco; subir a versão é uma
  mudança deliberada no `docker-compose.yml`. Se a infraestrutura falhar ao subir, um passo
  imprime o log dos contêineres.
- **Runner do job Testes fixo no Ubuntu 22.04.** Do kernel Linux 6.19 ao 7.0.13 o MongoDB 8 se
  recusa a iniciar (incompatibilidade do tcmalloc com o kernel, SERVER-121912, válida para todas as
  imagens e pacotes do 8.x; resolvida no kernel 7.0.14). O `ubuntu-latest` passou a usar um kernel
  dessa faixa, e o passo da infraestrutura falhava com `container bios-mongodb exited (1)`. Um
  passo registra o `uname -r` do runner. Rodar o banco local não é afetado (o kernel do Docker
  Desktop é anterior). Se o 22.04 também chegar a essa faixa, a alternativa é usar o MongoDB 7.0 no
  CI, que não tem o problema.

As actions são fixadas por SHA de commit e atualizadas pelo Dependabot
(`.github/dependabot.yml`), que também abre PRs semanais de dependências npm contra o
`develop`, agrupadas por ecossistema. As majors que a stack não aceita ficam bloqueadas lá,
com o motivo registrado: Prisma 7 (sem suporte a MongoDB), TypeScript 7 (recusado pelos peers
do `@nestjs/swagger` e do `typescript-eslint`) e Vitest 5 (binário nativo do Rolldown que o
npm não instala a partir do lockfile).

#### Imagens do CI fixadas por digest

O job Testes obtém o MongoDB e o Redis por registros alternativos (espelho do Google, ECR
Public e Docker Hub, nesta ordem), e uma tag publicada pode passar a apontar para outro
conteúdo sem aviso. Por isso o conteúdo é decidido pelo **digest do índice multi-arquitetura**
em `.github/ci-images.lock` (o mesmo nos três registros): `pull-ci-images.sh` puxa
`<registro>/<imagem>@sha256:…`, o motor recusa conteúdo diferente e só então aplica a tag
local que o `docker-compose.ci.yml` espera. Imagem do Compose sem digest no lock interrompe a
etapa antes de subir a infraestrutura. O Compose de desenvolvimento segue por tag.

Para subir uma versão (mudança deliberada, em PR próprio):

1. alterar a tag em `docker-compose.yml`, em `docker-compose.ci.yml` e na primeira coluna de
   `.github/ci-images.lock`;
2. rodar `bash .github/scripts/update-ci-images.sh` (precisa de Docker com buildx e rede), que
   resolve o digest atual de cada tag e regrava o lock;
3. rodar `bash .github/scripts/pull-ci-images.test.sh` e `update-ci-images.test.sh` (sem rede).

O Dependabot não atualiza o lock. Quem vigia a defasagem é o job **Imagens do CI** do workflow
de contrato (abaixo), que roda `update-ci-images.sh --check` e falha quando a tag passou a
apontar para outro digest (rebuild da imagem base, por exemplo). A falha é um aviso: o lock só
muda pelo procedimento acima.

#### Testes de contrato das fontes reais

Os e2e simulam cada fonte com a forma que o código supõe, e foi assim que o erro do GHG (10
organizações em vez de 1029) passou. O workflow `.github/workflows/contract.yml` (toda segunda
às 09:00 UTC e sob demanda, em *Actions → Contrato das fontes → Run workflow*) consulta as
fontes reais com os mesmos leitores do código de produção e acusa mudança de formato.
**Não é status check de PR** e não entra em `verify` nem no pre-push.

| Fonte | O que o contrato confere |
| --- | --- |
| IBAMA | Download dos dois dumps em `200` e fora de página HTML; tamanho entre 1 MB e o limite do adapter; cabeçalho do CSV com todas as colunas lidas; amostra de 50 mil linhas com registros de pessoa jurídica que o mapper aceita. |
| CGU (CEIS e CNEP) | `200` em JSON com a chave no cabeçalho `chave-api-dados`; linhas aceitas pelo leitor da página; página 2 diferente da 1; chamada sem chave recusada (`401`/`403`). |
| GHG | `SearchAllOrganizations` entrega a página inteira pedida (não uma amostra) com total acima dela; página seguinte sem repetir organizações; inventário publicado; relatório em PDF (`%PDF`, abaixo do limite) cujo CNPJ e ano o leitor identifica. |

Os endereços vêm do catálogo semeado (`data_sources.seeder.ts`), ou seja, o que vai a produção.
A chave da CGU é o secret `CGU_API_KEY` do repositório: chega só como variável de ambiente do
passo (mascarada nos logs), e os testes não a imprimem nem a repassam a mensagens de erro. No
CI, secret ausente reprova a execução; localmente a suíte da CGU é pulada com aviso.

```bash
npm run test:contract      # as três fontes (baixa ~330 MB do IBAMA); CGU_API_KEY no ambiente
npx vitest run --config vitest.config.contract.ts test/contract/ghg.contract-spec.ts   # uma fonte
```

### Fluxo de contribuição

1. Abrir a issue pelo template adequado (tarefa, bug ou configuração), colando os artefatos
   do bios-docs que a embasam.
2. Criar o branch a partir do `develop` e abrir o PR de volta para ele, com título em
   Conventional Commits (ele vira a mensagem do commit no squash merge).
3. Promover `develop` → `pre-prod` → `main` por PR; `main` e `pre-prod` são protegidos e só
   aceitam merge com os checks **Lint** e **Testes** aprovados (RNF NFSE11).
