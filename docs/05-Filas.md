# 05. Filas (BullMQ)

[Índice da documentação](README.md) · ← [04. Banco de dados e carga inicial](04-Banco-de-Dados.md) · [06. Autenticação e contas](06-Autenticação-e-Contas.md) →

> Filas, consumidores, agendamentos e políticas de repetição.

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
| `ods-scoring` | Recálculo de índice e confiança por ODS (UC15) e varredura por versão de regras | `OdsScoringProcessor` (`scoring/`), concorrência 3 ([Recálculo dos índices por fila](14-Índices-por-ODS.md#recálculo-dos-índices-por-fila-uc15-80)) |
| `email-dispatch` | E-mails transacionais | consumida nesta API (`mailing/`) |

O contrato é `QueueProvider`, com três operações:

```ts
await queues.enqueue(QueueName.EMAIL_DISPATCH, 'send-confirmation', { userId });
const profile = await queues.enqueueAndWait(QueueName.COMPANY_PROFILE, 'fetch', { cnpj });
await queues.schedule({ queue, id: 'ibama-daily-ingestion', jobName, cron: '0 4 * * *' });
```

- **Coalescência exata (`coalesce: true` + `jobId`).** Vários pedidos do mesmo trabalho viram
  um só **enquanto ele não começou**, sem nunca perder uma mudança. O BullMQ trata o mesmo `jobId`
  como o mesmo job enquanto o registro existir, e jobs concluídos ficam por uma hora e os falhos
  para sempre: sem tratamento, um pedido feito depois de o job terminar seria ignorado e devolveria
  o resultado velho. Com `coalesce`: job **pendente** (esperando ou agendado) absorve o pedido (ele
  ainda vai ler os dados mais novos); job **concluído ou falho** é removido e um novo é publicado;
  job **ativo** (pode já ter lido os dados antigos) passa o pedido a um acompanhamento
  `<jobId>~next`, ao qual os seguintes se fundem enquanto ele estiver pendente; se o acompanhamento
  também já começou, o pedido vai ao elo seguinte (`~next~next`...), de modo que nenhum pedido seja
  ignorado por ter o mesmo id de um job em andamento (a cadeia tem o tamanho dos jobs ativos ao mesmo
  tempo, limitado pela concorrência do consumidor). Quem usa tolera dois jobs do mesmo `jobId` ao mesmo tempo:
  o trabalho precisa ser idempotente e não regredir um resultado mais novo (ver o recálculo dos
  índices). Usado pela fila `ods-scoring`; as demais seguem com `jobId` por janela de tempo.
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

---

[Índice da documentação](README.md) · ← [04. Banco de dados e carga inicial](04-Banco-de-Dados.md) · [06. Autenticação e contas](06-Autenticação-e-Contas.md) →
