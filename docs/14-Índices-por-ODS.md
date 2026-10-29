# 14. Índices por ODS

🇧🇷 **Português** · 🇺🇸 [English](en/14-SDG-Indexes.md)

[Índice da documentação](README.md) · ← [13. Inventário GHG Protocol](13-GHG-Protocol.md) · [15. Empresas](15-Empresas.md) →

> Índice de aderência e confiança, recálculo por fila, explicação, catálogo de ODS e evolução setorial.

**Nesta página**

- [Índice de aderência por ODS (RF10)](#índice-de-aderência-por-ods-rf10)
- [Recálculo dos índices por fila (UC15, #80)](#recálculo-dos-índices-por-fila-uc15-80)
- [Explicação do índice por ODS (RF12)](#explicação-do-índice-por-ods-rf12)
- [ODS que o BIOS calcula (GET /ods)](#ods-que-o-bios-calcula-get-ods)
- [Evolução setorial (UC10, RF30, #89/#90)](#evolução-setorial-uc10-rf30-8990)

## Índice de aderência por ODS (RF10)

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
pública completa foram entregues na #81 (ver [Perfil completo da empresa](15-Empresas.md#perfil-completo-da-empresa)).

## Recálculo dos índices por fila (UC15, #80)

O motor acima roda dentro de um job da fila `ods-scoring`, `recalculate-scores(cnpj)`, consumido por
`OdsScoringProcessor` (`scoring/`). Quem precisa de um índice novo **pede**; nada chama o motor
direto no fluxo de ingestão ou de consulta. `RequestScoreRecalculationUseCase` publica o pedido e
`RequestScoreRecalculationBatchUseCase`, o de várias empresas (em lotes de 25 publicações ao mesmo
tempo; CNPJ repetido vale um pedido).

**Gatilhos** (os três da issue):

| Gatilho | Quando pede | Espera? |
| --- | --- | --- |
| Ingestão do IBAMA (UC14, passo 5) | O lote diário, depois de `batch.finish()` e **antes** de marcar a execução `SUCCEEDED`: um job por empresa **afetada** (gravada ou com evidência removida pela carga). A coleta avulsa por CNPJ também. Dump idêntico (`SKIPPED_UNCHANGED`) não pede nada. | não |
| Consulta sob demanda (UC07, diagrama 3) | `GetCompanyEnvironmentalEvidencesUseCase`, com as fontes consolidadas e antes de reler as evidências. | **sim**, até `QUEUE_WAIT_TIMEOUT_MS`: prazo estourado ou job falho **degradam** (a consulta responde, o índice fica como estava) |
| Atualização do perfil cadastral | `RefreshCompanyProfileUseCase`, depois de gravar o cadastro: UF, cidade e CNAEs desnormalizados dos índices são reescritos pelo recálculo. | não |

Pedir **nunca falha** o fluxo de quem pediu: fila fora do ar, prazo ou job falho viram `DEGRADED` e um
aviso (só o tipo do erro, sem CNPJ). O índice é derivado e reproduzível.

**Coalescência e ordem.** O `jobId` é `scores-<cnpj>` com `coalesce` (ver [Filas](05-Filas.md)): pedidos simultâneos
viram um job só, e um pedido feito depois de o job terminar gera outro (nunca devolve resultado
velho). Como pode haver o job ativo e o seu acompanhamento ao mesmo tempo, **o índice nunca regride**:
`calculatedAt` é o instante da **leitura** das evidências (tomado antes dela), e
`replaceForCompany` não grava se já existe índice da empresa calculado depois desse instante
(devolve `false`).

**Idempotência.** Reexecutar sem mudança de evidências produz o mesmo resultado (só o instante do
cálculo avança).

**Versão de regras.** `ODS_SCORE_RULES_VERSION` fica gravada em cada índice. Alterá-la deixa os
índices antigos na versão velha, e o job agendado `recalculate-stale-scores` (todo dia às 05:30,
depois da ingestão do IBAMA; `ods-stale-rules-sweep`) reenfileira, por cursor de CNPJ e em páginas de
200, as empresas com índice de outra versão. É retomável (a empresa sai da lista quando seu índice é
regravado) e, se a fila recusar algum pedido, falha ao final para o BullMQ repetir. Para antecipar,
publique o mesmo job na fila `ods-scoring` (`recalculate-stale-scores`, sem carga).

**Cache.** Ao final de cada recálculo são apagados, para o CNPJ, `company-profile`,
`company-evidences` e `company-scores`. Os retratos das fontes (`cgu-ceis`, `cgu-cnep`,
`ghg-inventory`) **ficam**: não dependem do índice, e apagá-los (como faria `CacheProvider.invalidate`,
que limpa tudo do CNPJ) forçaria novas consultas externas a cada recálculo.

**Falhas.** Job malformado e ambiente sem ODS ativo (ou ODS sem regras, `ScoringNotConfiguredError`)
são **irrecuperáveis**: falham na hora, sem as 3 tentativas da fila, e quem espera é avisado sem
esperar o prazo. As demais falhas são repetidas (3 tentativas, backoff exponencial de 1 s).

**Limites conhecidos.** Evidência que chega **depois** do prazo da consulta (GHG ou CGU que
concluem no worker depois que a consulta já respondeu) só entra no índice na próxima consulta ou no
próximo recálculo; esses workers não pedem recálculo por conta própria. Evidências que passam a
`OUTDATED` só pelo passar do tempo também não disparam recálculo.

## Explicação do índice por ODS (RF12)

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

## ODS que o BIOS calcula (`GET /ods`)

`GET /ods` (RF10, #332) lista os ODS **ativos** da coleção `ods`, em ordem de número, com
`ods_number`, `title` e `description` (hoje o 13 e o 15). Exige sessão. É de onde o seletor do
front tira as opções: uma lista de 1 a 17 "funcionaria" e não mostraria nada, porque o BIOS só
calcula os ODS de referência.

- **O mesmo conjunto vale na pesquisa e na exportação.** `ods` em `GET /companies` e em
  `GET /companies/export/xlsx` é conferido contra os ODS ativos (`EnsureActiveOdsUseCase`). Um ODS
  inexistente ou desativado responde **422 `ODS_NOT_AVAILABLE`**, com `details.ods` e a lista dos
  válidos em `details.valid_ods`. Antes, `?ods=7` respondia 200 com índice nulo e `?ods=7&min_score=50`
  respondia 200 com lista vazia, indistinguível de "nenhuma empresa atende". Desativar um ODS
  (`is_active = false`) o tira de `GET /ods` e passa a recusá-lo na pesquisa, sem reiniciar a API
  (a conferência lê a coleção a cada pedido com `ods`; a coleção tem no máximo 17 documentos).
- **ODS ativo sem índice na empresa continua sendo 200.** `?ods=13` devolve `ods_score` com valores
  nulos para a empresa que ainda não tem índice no 13: é ausência de cálculo *da empresa*, e a
  pesquisa por ODS ativo nunca deixa de aceitar o critério.
- **Rótulos em pt-BR dos enums (decisão registrada).** O contrato continua devolvendo os valores
  dos enums (`EvidenceCategory`, `EvidenceState`, `EvidenceSignal`, `coverage_status`,
  `calculation_status`, `weight_reason`) e **não** um dicionário de rótulos: o app Angular é o único
  consumidor com texto para o usuário, e o cliente gerado do OpenAPI (#330) tipa cada enum, então um
  `Record<EvidenceState, string>` no front reprova a compilação se o BIOS ganhar um valor novo. Um
  dicionário na API criaria uma segunda fonte para manter junto dos enums e não serviria às demais
  APIs consumidoras, que trabalham com os códigos. Se um segundo cliente com tela passar a existir, a
  decisão se reabre.

## Evolução setorial (UC10, RF30, #89/#90)

A série histórica é **só dos setores** (`sector_score_snapshots`, indicador IA05): nenhum índice de
empresa é guardado ao longo do tempo nem exposto aqui.

- **Job `aggregate-sector-scores`** (fila `ods-scoring`, agendamento `sector-score-snapshots`): agrega
  `company_ods_scores` por ODS e **divisão do CNAE principal** (2 dígitos, lido do perfil cadastral; empresas
  sem perfil ficam de fora), só com os índices da versão de regras vigente. Grava, na janela do **mês
  corrente** (UTC), o índice médio (das empresas com índice), a confiança média (de todas), as contagens e a
  versão das regras. Reexecutar no mesmo mês sobrescreve o retrato dele (índice único por ODS, setor e início
  da janela), e o setor que deixou de ter empresas sai da janela. Virado o mês, o anterior fica como estava.
- **Agendamento:** `SECTOR_SNAPSHOT_CRON` (padrão `0 6 * * *`, depois da varredura de regras das 05:30). O
  campo `cronSetting` de um agendamento faz o registro ler o cron da variável no lugar do padrão.
- **Amostra mínima** (`SECTOR_SNAPSHOT_MIN_COMPANIES`, padrão 5): com menos empresas com índice, o índice
  médio fica nulo; com menos empresas no setor, a confiança média também. As contagens ficam.
- **`GET /sectors`** (`[P08]`): o seletor de setor do UC10 (fluxo normal 1). Lista as divisões CNAE com ao
  menos uma janela gravada, em ordem crescente, com a descrição oficial (`{ data: [{ cnae_division,
  description }] }`). Só setores, nunca empresas.
- **`GET /sectors/{cnae}/evolution?ods=`** (`[P08]`, qualquer usuário com sessão): o CNAE pode ser a divisão,
  o grupo, a classe ou a subclasse, com ou sem máscara, e vira a divisão, que precisa existir na CNAE 2.3 (a
  divisão `04`, por exemplo, não existe). Devolve a divisão com a descrição oficial
  (`cnae_division_description`, RF06) e as janelas da mais antiga à mais recente; com menos de duas,
  `history_status: INSUFFICIENT` (fluxo 2.1). ODS obrigatório; ODS que o BIOS não calcula,
  `422 ODS_NOT_AVAILABLE` com os válidos; CNAE inválido ou divisão inexistente, `422`.
- **Descrição das divisões:** as 87 divisões da CNAE 2.3, com a descrição do IBGE
  (`servicodados.ibge.gov.br/api/v2/cnae/divisoes`), ficam no código (`scoring/domain/cnae-divisions.ts`). A
  taxonomia só muda numa revisão da CNAE, então não é consultada a cada requisição; a fonte `IBGE_CNAE` segue
  descrevendo a subclasse no perfil da empresa.

---

[Índice da documentação](README.md) · ← [13. Inventário GHG Protocol](13-GHG-Protocol.md) · [15. Empresas](15-Empresas.md) →
