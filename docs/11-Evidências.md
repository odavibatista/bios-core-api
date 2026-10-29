# 11. Evidências

[Índice da documentação](README.md) · ← [10. Fontes externas (adapters)](10-Fontes-Externas.md) · [12. IBAMA](12-IBAMA.md) →

> Modelo e persistência, consolidação por CNPJ, referências às fontes, motivos de UNKNOWN e a CGU.

**Nesta página**

- [Evidências (modelo e persistência)](#evidências-modelo-e-persistência)
- [Consolidação das evidências por CNPJ (RF07)](#consolidação-das-evidências-por-cnpj-rf07)
- [Referências às fontes originais (RF09)](#referências-às-fontes-originais-rf09)
- [Motivos de UNKNOWN das fontes de evidência (observabilidade)](#motivos-de-unknown-das-fontes-de-evidência-observabilidade)
- [CGU: CEIS e CNEP (conduta administrativa)](#cgu-ceis-e-cnep-conduta-administrativa)

## Evidências (modelo e persistência)

> **Mudar o texto de um resumo não duplica nada (#258).** A evidência é gravada por *upsert* na
> chave `<fonte>:<cnpj>:<referência>`, que não contém o resumo, e o hash do registro bruto cobre só
> `{ chave, bruto }` (o payload vem da fonte, nunca do texto que o BIOS escreve). Corrigir a
> acentuação de um resumo atualiza a linha existente. Evidências já gravadas mantêm o texto antigo
> até a próxima coleta daquele CNPJ: GHG e CGU, quando a validade vence e a coleta se repete; IBAMA,
> no próximo dump alterado (um dump idêntico só renova a validade). Não há migração: o texto antigo
> é correto quanto ao conteúdo e some sozinho. O e2e `evidences.e2e-spec.ts` prova que recolher
> com o resumo novo deixa uma evidência e um bruto só.

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
  mantém a janela dele até ser ajustada em `data_sources` (ou por `npm run catalog:sync`).
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

## Consolidação das evidências por CNPJ (RF07)

`EnvironmentalIntelligenceModule` (módulo `environmental-intelligence`) exporta
`GetCompanyEnvironmentalEvidencesUseCase`, além do consumidor `EnvironmentalEvidencesProcessor`, do
produtor `RequestCguCompanyEvidencesUseCase`, do contrato do job da CGU e do controller de
`GET /companies/:cnpj/evidences`. Recebe um CNPJ (pontuado ou canônico), valida antes de qualquer
efeito e inicia em paralelo a leitura local IBAMA, o produtor CGU e o produtor GHG.

**Sentido das dependências (#254).** O armazenamento (`evidences`: gravação, leitura, relógio de
coleta, modelo e consolidação por categoria) não conhece as fontes que o alimentam nem quem as reúne:
`ibama`, `cgu` e `ghg` dependem de `evidences` (gravam e leem retratos), e
`environmental-intelligence` depende de todos eles, **nunca o contrário**. Isso desfaz o ciclo que
existia quando o orquestrador morava dentro de `evidences`. A regra é imposta pelo ESLint
(`no-restricted-imports` em `eslint.config.mjs` para `src/modules/evidences/**`, que recusa imports
de `ibama`, `cgu`, `ghg` e `environmental-intelligence`, por alias ou por caminho relativo). O que é
específico de uma fonte (ex.: `CGU_SLUGS`) fica com ela; o que é só da orquestração fica em
`environmental-intelligence`. Um módulo de fonte novo entra como dependência dele, e não de
`evidences`.

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

## Referências às fontes originais (RF09)

`GET /companies/:cnpj/evidences` exige sessão JWT e devolve a consolidação por
categoria, validada e documentada no OpenAPI. A rota aceita CNPJ numérico ou
alfanumérico; omita a barra de formatação na URL. CNPJ inválido responde 422 e
ausência de sessão responde 401 antes de consultar fontes.
Um CNPJ válido sem `company_profile` local responde 404 (`COMPANY_NOT_FOUND`)
antes de qualquer leitura de evidências, gravação ou publicação de job. A rota
tem limite próprio por IP (padrão 20 consultas por minuto, `THROTTLE_COMPANY_EVIDENCES_LIMIT`), no lugar do limite global.

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

A composição do perfil completo e da API pública foi entregue na #81 (ver [Perfil completo da empresa](15-Empresas.md#perfil-completo-da-empresa)). Não há alteração de schema Prisma, variáveis de ambiente ou configuração de filas.

## Motivos de UNKNOWN das fontes de evidência (observabilidade)

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

## CGU: CEIS e CNEP (conduta administrativa)

`CguModule` exporta `CeisDataSource`, `CnepDataSource` e
`GetCguCompanyEvidencesUseCase`. O caso de uso recebe CNPJ e `SourceCallContext`,
consulta os dois cadastros separadamente e grava o retrato de cada fonte.
O consumidor ambiental despacha a coleta CGU por fila na consolidação (#75).
A composição do perfil foi entregue na #81; esta entrega não acrescentou endpoint nem cálculo de índice.

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

---

[Índice da documentação](README.md) · ← [10. Fontes externas (adapters)](10-Fontes-Externas.md) · [12. IBAMA](12-IBAMA.md) →
