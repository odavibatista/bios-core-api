# 17. Testes

[Índice da documentação](README.md) · ← [16. Chaves de API e API pública](16-Chaves-de-API.md) · [18. Qualidade e integração contínua](18-Qualidade-e-CI.md) →

> Cobertura, testes e2e em paralelo e dados de teste.

**Nesta página**

- [Cobertura](#cobertura)
- [Testes e2e](#testes-e2e)
  - [E2E em paralelo (#368)](#e2e-em-paralelo-368)
- [Dados de teste](#dados-de-teste)

Vitest com a API de mocks equivalente à do Jest (`vi.fn`, `vi.spyOn`). Dependências são
substituídas pelo container do Nest com `Test.createTestingModule(...).overrideProvider()`,
sem mock de módulo inteiro. Mocks são limpos e restaurados automaticamente entre testes. Nos
unitários, `test/setup/validation-messages.setup.ts` aplica as mensagens de validação em
português (#398), como a aplicação: um schema testado isoladamente dá o mesmo texto que a API
devolve. Nos e2e quem as aplica é o próprio `SharedModule`.

## Cobertura

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

## Testes e2e

| Pasta | Escopo |
| --- | --- |
| `test/http/` | Pipeline HTTP sobre o `AppModule`, com dependências substituídas via `overrideProvider` |
| `test/database/` | `AppModule` completo contra um MongoDB real e descartável |
| `test/integration/` | Módulos de infraestrutura contra o serviço real (ex.: filas contra o Redis) |

A infraestrutura de teste é montada e desmontada pelo setup global
(`test/setup/infrastructure.global-setup.ts`) a cada execução de `npm run test:e2e`:

1. sincroniza coleções e índices de cada banco de worker com o schema Prisma (`prisma db push`,
   em paralelo);
2. limpa o banco de cada worker no Redis (`FLUSHDB`), para que jobs de uma execução anterior não
   interfiram na seguinte;
3. cria vazia a pasta temporária de cada worker;
4. disponibiliza a infraestrutura às suítes, que preparam o banco com `PrismaService.reset()`
   e `PrismaService.seed(seeders)`;
5. remove os bancos (`dropDatabase`) e as pastas ao final.

Os endereços base são `bios_test` no MongoDB e o banco `1` no Redis do `docker-compose.yml`;
outros podem ser informados em `E2E_DATABASE_URL` e `E2E_REDIS_URL`. Cada um tem garantias de
descarte: `seed` e `reset` só executam com `NODE_ENV=test` **e** em banco com sufixo `_test`
(fora disso lançam `UnsafeDatabaseOperationException`); no Redis, o setup recusa o banco `0`,
que é o de uso geral, e recusa limpar um banco que contenha chave fora dos prefixos do projeto
(`bios:`, `bull:`) — o que protege de outro Redis ocupando a porta 6379 na mesma máquina.

Um job ainda na fila quando um teste termina seria processado durante o seguinte. Por isso as
suítes esperam a fila esvaziar **antes** da limpeza (`test/support/database-testing-app.ts`):

- `waitForEmailQueue(app)`: nas suítes que registram os e-mails num dublê do transporte. Sem a
  espera, o aviso de um teste aparecia no dublê do seguinte; e, com `email_dispatch_logs` já
  apagado, a tentativa falhava e o BullMQ reenviava o mesmo e-mail mais tarde. Também vem antes
  de afirmar que **nenhum** e-mail saiu, já que o envio é assíncrono;
- `waitForScoringQueue(app)`: antes de limpar `company_ods_scores`, e sempre no `app.close()`.

### E2E em paralelo (#368)

Os arquivos e2e rodam em paralelo, e cada worker do Vitest tem a própria infraestrutura. Dentro
de um worker os arquivos continuam um de cada vez, então cada arquivo segue sozinho no seu banco
e na sua fila, como na execução em série:

| Recurso | Worker 1 | Worker 2 | Worker *n* |
| --- | --- | --- | --- |
| MongoDB | `bios_w1_test` | `bios_w2_test` | `bios_w<n>_test` (o sufixo `_test` continua no fim) |
| Redis | banco `1` | banco `2` | índice da `E2E_REDIS_URL` + *n* − 1, até o `15` |
| Pasta temporária | `<tmp>/bios-e2e/w1` | `<tmp>/bios-e2e/w2` | `<tmp>/bios-e2e/w<n>` |

- **Número de workers:** `E2E_WORKERS` (padrão 4, limitado aos núcleos da máquina; o CI fixa 4,
  um por vCPU do runner). `E2E_WORKERS=1` volta à execução em série.
- **Como as suítes chegam à infraestrutura do worker:**
  - `test/setup/worker-infrastructure.setup.ts` aponta `DATABASE_URL`, `REDIS_URL` e
    `TMPDIR`/`TEMP`/`TMP` do processo para os recursos do worker antes de cada arquivo;
  - as suítes que montam a configuração à mão usam `testDatabaseUrl()`, `testRedisUrl()` e
    `testDatabaseName()` (`test/support/infrastructure.ts`), e não um `inject` comum a todos os
    workers;
  - `buildTestEnvironment()` já devolve o banco e o Redis do worker;
  - o `env` de `vitest.config.e2e.ts` traz endereços inexistentes (`*.invalid`) para banco e
    Redis: se o setup do worker não os trocar, a aplicação falha ao conectar, em vez de ler o
    `.env` de desenvolvimento ou dividir os recursos de outro worker.
- **Isolamento testado:** `test/integration/worker-infrastructure.e2e-spec.ts` confere que o
  processo, o `os.tmpdir()` e o `buildTestEnvironment()` apontam para os recursos do próprio
  worker, que eles são distintos entre workers, e as regras de nome e de `E2E_WORKERS`.
- **Estado global, revisado:**
  - filas e agendamentos do BullMQ, cache e contadores do throttler ficam no Redis, então cada
    worker tem os seus;
  - os servidores falsos das fontes e o próprio app ouvem em porta livre (`listen(0)`);
  - as suítes que conferem se um adapter apagou a pasta temporária leem a pasta do próprio
    worker, sem ver as de outro.
- **Tempo medido** (Windows, 12 núcleos lógicos; 58 arquivos e 915 testes, mais a suíte de
  isolamento nas duas últimas rodadas, com 59 e 928; todos passando em todas as rodadas):

  | Execução | Tempo |
  | --- | --- |
  | Em série (antes) | 642 s |
  | 2 workers | 314 s |
  | **4 workers (padrão)** | **187 a 206 s** (cinco rodadas) |
  | 6 workers | 197 s |
  | 8 workers | 211 s |

  Acima de 4 workers o ganho para porque o piso é um arquivo só:
  `company-search-equivalence.e2e-spec.ts` leva ~175 s sozinho (os demais, no máximo 29 s), e
  os outros 57 arquivos cabem nos workers restantes enquanto ele roda. Mais workers só aumentam
  a disputa de CPU na importação do `AppModule`. Reduzir abaixo disso exige dividir aquele
  arquivo.

**Aviso de vazamento de ouvintes (#259).** O Node emite `MaxListenersExceededWarning` quando mais de 10
ouvintes se acumulam num emissor. Nos e2e vinha de requisições simultâneas via supertest (`Promise.all`
de 10 ou mais chamadas) contra o servidor HTTP do app ainda sem `listen`: o supertest sobe o servidor a
cada requisição e enfileira as demais em `once('listening' | 'error' | 'close')`. A correção está na raiz,
sem `setMaxListeners`: `createDatabaseTestingApp` faz `app.listen(0)` (porta livre) uma vez, e as
requisições vão direto. Para o aviso não voltar, `test/setup/listener-leak.setup.ts` (registrado em
`vitest.config.e2e.ts`) **reprova o arquivo e2e** que emitir esse aviso. Para achar a origem de um aviso
novo, rode com `NODE_OPTIONS=--trace-warnings` (mostra a pilha de quem adicionou o ouvinte).

Sem MongoDB ou sem Redis acessível, as suítes correspondentes são ignoradas localmente (com
aviso) e as demais seguem normalmente; no CI a ausência reprova a execução. Para rodá-las
localmente, suba a infraestrutura antes: `npm run docker:up`.

Os catálogos de referência (ODS, fontes de dados e blacklist de domínios) têm seeders
idempotentes nos próprios módulos (`infra/db/seeders/`), reunidos em
`src/app/database/catalog.seeders.ts` na ordem de dependência.

## Dados de teste

Todas as suítes, unitárias e e2e, geram seus dados com o Faker (locale pt-BR). Valores
arbitrários não são fixados à mão; ficam fixos apenas os valores que são a própria regra
testada, como os ODS de referência, os padrões da configuração ou as mensagens de erro.

- **Instância única**: os testes importam `faker` de `test/support/faker.ts`. O ESLint
  bloqueia o import direto de `@faker-js/faker` nos testes; o código de produção (ex.:
  honeypot, RF21) continua livre para usá-lo.
- **Factories**: registros e objetos de domínio vêm de `test/factories/<módulo>/`, criados
  com `defineFactory`. `build(overrides)` gera um objeto completo e fixa só os campos do
  cenário; `buildMany(n, overrides)` gera vários.
- **Respeitar os limites do schema**: o valor sorteado precisa caber em qualquer semente. Um
  exemplo: `faker.lorem.word()` às vezes devolve só `"a"`, abaixo do mínimo de 2 caracteres
  do nome de uma chave de API, e o teste falhava em cerca de uma execução a cada mil. Para
  esse campo, `faker.lorem.words(2)`.
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

---

[Índice da documentação](README.md) · ← [16. Chaves de API e API pública](16-Chaves-de-API.md) · [18. Qualidade e integração contínua](18-Qualidade-e-CI.md) →
