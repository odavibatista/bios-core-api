# 12. IBAMA

🇧🇷 **Português** · 🇺🇸 [English](en/12-IBAMA.md)

[Índice da documentação](README.md) · ← [11. Evidências](11-Evidências.md) · [13. Inventário GHG Protocol](13-GHG-Protocol.md) →

> Dumps do IBAMA: download, leitura, normalização, job diário e consulta avulsa por CNPJ.

**Nesta página**

- [Lote diário: IBAMA (download e leitura dos dumps)](#lote-diário-ibama-download-e-leitura-dos-dumps)
- [Normalização das evidências do IBAMA](#normalização-das-evidências-do-ibama)
- [Job diário do IBAMA (consumidor, execuções, retry)](#job-diário-do-ibama-consumidor-execuções-retry)
- [Consulta local e job avulso do IBAMA por CNPJ](#consulta-local-e-job-avulso-do-ibama-por-cnpj)

## Lote diário: IBAMA (download e leitura dos dumps)

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

## Normalização das evidências do IBAMA

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

## Job diário do IBAMA (consumidor, execuções, retry)

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
  20 e 40 min) — ver [Filas](05-Filas.md). Jobs fora do agendador seguem a política da fila.
- **Concorrência e data.** Lote e avulso compartilham `ibama-ingestion`, com concorrência 1 por
  consumidor. Como o avulso pode reutilizar um dump baixado antes do lote, a persistência compara
  `collected_at`: uma coleta antiga não substitui um retrato mais novo, mesmo se concluir depois.
  Uma reexecução de job mantém as chaves idempotentes e o avulso só altera o CNPJ solicitado.
- **Recálculo do índice fica fora.** O passo 5 do UC14 (recalcular o índice dos CNPJs afetados) é o
  gatilho de ingestão do recálculo por fila (UC15). O conjunto de afetados não é guardado: toda evidência
  da execução tem `collected_at` igual ao `started_at` dela, e o bruto aponta a execução.
- **Disparo manual.** Não há endpoint. Em desenvolvimento, publique o job na fila
  (`queue.add('ingest-ibama-dumps', {})`) ou use a política de teste dos e2e.
- **Bancos criados antes da #69.** O seed não altera fontes existentes (use `npm run catalog:sync` para ver e aplicar a diferença): confira `base_url`,
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

## Consulta local e job avulso do IBAMA por CNPJ

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

---

[Índice da documentação](README.md) · ← [11. Evidências](11-Evidências.md) · [13. Inventário GHG Protocol](13-GHG-Protocol.md) →
