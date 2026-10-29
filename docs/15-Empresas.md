# 15. Empresas

🇧🇷 **Português** · 🇺🇸 [English](en/15-Companies.md)

[Índice da documentação](README.md) · ← [14. Índices por ODS](14-Índices-por-ODS.md) · [16. Chaves de API e API pública](16-Chaves-de-API.md) →

> Consulta por CNPJ, perfil completo, pesquisa e exportação em XLSX.

**Nesta página**

- [Consulta de empresa por CNPJ](#consulta-de-empresa-por-cnpj)
  - [Consumidor da fila e contrato do job](#consumidor-da-fila-e-contrato-do-job)
- [Perfil completo da empresa](#perfil-completo-da-empresa)
- [Pesquisa de empresas (nome e filtros)](#pesquisa-de-empresas-nome-e-filtros)
- [Exportação da lista em XLSX](#exportação-da-lista-em-xlsx)

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

O perfil ambiental (UC07: evidências e índice por ODS) acompanha esta resposta desde a #81; ver
"Perfil completo da empresa".

## Perfil completo da empresa

`GET /companies/:cnpj` (painel, sessão) e `GET /v1/companies/:cnpj` (API pública, chave) devolvem
o **perfil completo** (UC06 + UC07, RF05–RF12, #81): o cadastro, as evidências ambientais e, por
ODS, o índice, a confiança e a explicação, numa só resposta. `GetCompanyFullProfileUseCase`
(módulo `environmental-intelligence`) compõe as três partes; os controllers do perfil moram ali,
e não em `companies`, porque o módulo de empresas não depende da orquestração ambiental.

```jsonc
{
  "cnpj": "11222333000181",          // cadastro na raiz, com os mesmos campos de antes
  "legal_name": "…", "main_cnae": { … }, "refreshed_at": "…",
  "evidences": [                      // por categoria, com a referência da fonte original
    { "category": "INFRACAO_AMBIENTAL", "evidences": [ { "source_slug": "IBAMA", "state": "CONFIRMED", "source_reference": "AI-001", … } ] }
  ],
  "ods_scores": [                     // ODS ativos, em ordem de número
    {
      "ods_number": 15,
      "calculation_status": "CALCULATED",   // ou "PENDING"
      "index_status": "AVAILABLE",
      "score_value": -45, "confidence_value": 0.62,   // lado a lado, nunca combinados
      "evidence_count": 2, "coverage_status": "HAS_RECORDS", "sources_without_records": [],
      "rules_version": "rf10-rf11-v3", "calculated_at": "…",
      "contributions": [ { "evidence": { … }, "weight": 40, "signal": "NEGATIVE", "points": -40 } ]
    }
  ],
  "provenance": {
    "sources": [
      { "source_slug": "IBAMA", "origin": "PERSISTED", "evidence_state": "CONFIRMED" },
      { "source_slug": "CGU_CEIS", "origin": "PENDING", "evidence_state": null }
    ],
    "scores_pending": true,
    "retry_after_seconds": 30
  }
}
```

- **Ordem e falha.** Cadastro, depois evidências (que pedem o recálculo dos índices e esperam no
  prazo da fila, #80), depois índices. Cada etapa só roda se a anterior deu certo: CNPJ inválido
  (422), empresa inexistente (404) e cadastro indisponível sem cópia guardada (503) respondem
  antes de qualquer coleta ambiental. Fonte ambiental fora do ar degrada por conta própria
  (evidência `UNKNOWN`, nunca nota baixa).
- **Prazo total.** `COMPANY_PROFILE_REQUEST_TIMEOUT_MS` (padrão 15 000 ms, faixa 2 000–60 000)
  limita a espera das duas rotas. O cadastro recebe o prazo restante com reserva para compor a
  resposta. Se a coleta ambiental ainda estiver em andamento, a API devolve o retrato persistido
  e os índices disponíveis; os jobs publicados podem terminar depois. Sem cadastro local e sem
  resposta dos provedores dentro do prazo, a resposta continua sendo 503, não 404.
- **Proveniência.** Cada fonte de `provenance.sources` traz `origin` (`COLLECTION`, `PERSISTED`,
  `PENDING` ou `UNAVAILABLE`) e `evidence_state` (`CONFIRMED`, `NOT_FOUND`, `UNKNOWN`, `OUTDATED`
  ou `null`). `NOT_FOUND` confirma ausência de registro na fonte consultada; `UNKNOWN` e `null`
  não confirmam ausência. `scores_pending` indica índice ainda não calculado, separado do estado
  de cada fonte. `retry_after_seconds` sugere 30 s para coleta ou índice pendente, ou 900 s para
  indisponibilidade; vale `null` sem pendências. A origem é uma projeção do retrato persistido
  e das datas de coleta, sem gravar estado novo no banco.
- **Explicação embutida.** `contributions` é a mesma explicação de
  `GET /companies/:cnpj/scores/:ods/explanation` (RF12), para quem usa a API pública, que não tem
  a rota de explicação. O índice não é um veredito de sustentabilidade (IND01) e os ODS 13 e 15 não
  formam índice geral.
- **`calculation_status = PENDING`.** ODS sem retrato gravado, ou cujo retrato deixou de ser
  auditável, sai com todos os números nulos e sem contribuições: pendência nunca é nota baixa
  (IND02). O recálculo (UC15) o repõe. Falha de infraestrutura, ao contrário, propaga (não vira
  pendência).
- **Cache.** As partes ambientais ficam nos namespaces `company-evidences` e `company-scores`
  por 5 minutos (`ENVIRONMENTAL_PROFILE_CACHE_TTL_SECONDS`), e só juntas e com todos os ODS
  calculados; o recálculo do índice as apaga (`OdsScoringProcessor`). Com as duas em cache, a
  consulta não coleta nem recalcula. O cadastro segue no namespace `company-profile`.
- **Mesmo retrato da rota de evidências (#334).** O retrato `company-evidences` mora na
  consolidação (`GetCompanyEnvironmentalEvidencesUseCase`), que as duas rotas usam: com ele em
  cache, `GET /companies/:cnpj/evidences` responde sem coletar nem recalcular, e o perfil e a rota
  mostram as mesmas evidências até o próximo recálculo. A rota de evidências também grava o
  retrato, mas só depois de esperar o recálculo terminar (`CALCULATED`), para o índice já refletir
  o que foi guardado; recálculo fora do prazo, ou consulta sem espera (API pública), não grava. A
  rota continua existindo: entrega as evidências com proveniência sem compor índice nem cadastro.
- **Limite.** A rota do painel tem limite próprio por IP, padrão de 60 consultas por minuto
  (`THROTTLE_COMPANY_PROFILE_LIMIT`, #335): consolidar pode disparar coletas externas, mas a chamada
  em cache é barata. A pública conta por chave (NFSE04).
- **Testes.** Os e2e que só exercitam cadastro, autenticação ou limite trocam a consolidação por
  uma que não coleta (`withoutEnvironmentalCollection`), para não baixar os dumps do IBAMA;
  `company-full-profile.e2e-spec.ts` cobre a composição real sobre o que está gravado.

## Pesquisa de empresas (nome e filtros)

`GET /companies` lista as empresas da base local (UC06 fluxo 1.1 e UC08; RF04, RF13, RF14) por nome, UF,
município, CNAE e, para um ODS selecionado, índice e confiança mínimos, e as ordena pelo índice dele; o usuário escolhe uma e abre
o perfil em `GET /companies/:cnpj`. Exige sessão, como a consulta por CNPJ. Os critérios são
opcionais, mas **ao menos um** é obrigatório (`name`, `uf`, `city`, `cnae` ou `ods`), e os que vêm
se somam: a empresa precisa atender a todos. Campo em branco vale como não informado.

- **Só a base local.** Nenhuma fonte cadastral (BrasilAPI, OpenCNPJ, Minha Receita) oferece busca
  por nome, então a busca opera **apenas sobre os perfis já guardados**: uma empresa que ninguém
  consultou pelo CNPJ não aparece. A busca nunca chama provedor nem publica job
  (`SearchCompaniesUseCase`); quem a abre depois pelo CNPJ dispara a atualização, se o
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
- **Filtros cadastrais (#83).** Valem sobre `company_profile`, com ou sem nome:
  - `uf`: sigla das 27 unidades da federação, em qualquer caixa (`rj` vale `RJ`); outra coisa é 422;
  - `city`: o **nome inteiro** do município, sem distinguir acento, caixa nem pontuação
    (`sao paulo` acha `SÃO PAULO`, `santa barbara d oeste` acha `Santa Bárbara d'Oeste`), mas não por
    início de palavra: `sao paulo` não acha `SAO PAULO DO POTENGI`. Sem `uf`, casa o município de
    qualquer estado; para desambiguar, informe a UF;
  - `cnae`: de 2 a 7 dígitos (divisão, grupo, classe ou subclasse), com ou sem a máscara
    (`6201-5/01`), tratado como **prefixo** do código do CNAE principal **ou** de algum secundário.
    `62` acha todas as empresas de tecnologia da informação; `01` não acha `6201501`.
- **ODS selecionado, índice e confiança mínimos (#83).** `ods` (1 a 17) seleciona o ODS a que tudo
  o que é de índice se refere (UC08, regra 2). A pesquisa junta ao perfil o documento de
  `company_ods_scores` daquele ODS (`$lookup` pelo CNPJ e pelo número do ODS) e devolve em cada
  empresa `ods_score = { ods_number, score_value, confidence_value }`, com os dois valores nulos
  quando a empresa não tem índice calculado nesse ODS. `min_score` (-100 a 100) e
  `min_confidence` (0 a 1) filtram por `>=` e **exigem `ods`** (422 sem ele). Empresa sem índice
  calculado no ODS, ou com índice nulo, não passa por `min_score`; sem documento, também não passa
  por `min_confidence`. O mínimo `0` filtra de fato (não equivale a "sem filtro"). Índice e
  confiança vêm em campos separados e nunca combinados. Nada do que explica o índice
  (contribuições, regras, datas) sai na lista: isso é do perfil.
- **Ordenar pelo índice do ODS (#84).** `order=asc` (do menor ao maior índice) ou `order=desc` (do
  maior ao menor), em qualquer caixa; exige `ods` (422 sem ele) e vale para o ODS selecionado, não
  para o outro. **Quem não tem índice vai sempre ao fim, nos dois sentidos**: ausência de índice
  (documento inexistente ou nota nula) não é o menor nem o maior índice, e o índice `0` é um índice,
  que se ordena entre os negativos e os positivos. Entre índices iguais, a maior confiança vem
  primeiro (nos dois sentidos) e o CNPJ desempata, o que torna a paginação estável. **Quem não tem
  índice** vem depois de todos os que têm, por razão social e CNPJ (a confiança dele não entra). A
  ordenação por índice vale mais que a prioridade da frase digitada. O campo auxiliar
  `score_missing` (e `sort_confidence`/`sort_name`) nunca sai na resposta.
- **Como a pesquisa com ODS é executada (#328).** O custo de ler o índice de uma empresa é o de um
  `$lookup`, e partir do perfil e juntar o índice de **todas** as empresas antes de paginar custava cerca
  de 0,14 ms por empresa (2,7 s para 20 000). Por isso há três caminhos, escolhidos pelo que a consulta
  pede (`CompanyProfileRepository.search`):
  1. **A partir do perfil** (`company-search.pipeline.ts`): sem ODS, com **nome**, ou com ODS que só
     aparece na resposta (sem mínimo nem ordenação). Neste último caso o `$lookup` roda **depois** da
     paginação, só para a página (de ~870 ms para ~20 ms em 6 000 empresas);
  2. **A partir dos índices** (`company-scored-search.pipeline.ts`): ODS com mínimo (sem ordenação),
     sem nome. Filtra `company_ods_scores` pelos campos desnormalizados (`uf`, `city`, `cnae_codes`) e
     pelos mínimos, junta o perfil e ordena por razão social;
  3. **Em dois segmentos**: ODS com ordenação, sem nome. Primeiro as empresas **com nota**, direto do
     índice composto (`idx_company_ods_scores_ods_*`), pagina antes de juntar o perfil; depois as
     **sem nota**, lidas do perfil só quando a página chega nelas. O total é a soma dos dois.
  - **`uf` não nulo separa quem tem perfil de quem só tem índice.** A ingestão do IBAMA recalcula o
    índice de empresas que ninguém consultou; elas ficam sem localização (`replaceForCompany` grava a do
    perfil) e **não são da base da pesquisa** (UC08, regra 1). Sem esse corte, em 30 000 índices órfãos a
    contagem passava de 100 ms para 880 ms. Elas nunca entram na lista, por mais alta que seja a nota.
  - **Consistência.** A localização dos índices é eventualmente consistente: o recálculo a atualiza
    (a atualização do perfil o pede), e por isso uma empresa que muda de UF só aparece na UF nova depois
    do recálculo. O teste `company-search-equivalence.e2e-spec.ts` compara os três caminhos com um
    oráculo em memória (mais de cem combinações de critérios, ODS, mínimos, ordem e janelas, inclusive a
    emenda entre os dois segmentos), e `company-search-performance.e2e-spec.ts` reprova a volta do
    varrimento do perfil inteiro.
- **Ordem padrão.** Primeiro quem *começa* pela frase digitada (as palavras na ordem digitada, no início
  da razão social ou do nome fantasia); depois as demais. Desempate pela razão social e pelo
  CNPJ, o que torna a paginação estável. `ambev` lista `AMBEV S.A.` antes de
  `DISTRIBUIDORA AMBEV`. Sem nome, a lista vem por razão social e CNPJ. Com `order`, vale a ordenação
  pelo índice do ODS, descrita acima.
- **Resposta.** `{ data, pagination }`, com `pagination = { page, page_size, total,
  total_pages }` (padrão das listagens, em `pagination.dto.ts`; `page_size` até 100, padrão 20).
  Cada item é o resumo para reconhecer a empresa: `cnpj`, `legal_name`, `trade_name`,
  `registration_status`, `city`, `uf`, o CNAE principal e `ods_score` (nulo quando a pesquisa não
  seleciona ODS). Nada achado é `200` com `data: []`, e
  não `404`; página além do fim traz a lista vazia e o `total` correto.
- **Dados pessoais (INL02).** A busca lê a razão social já gravada, que tem o CPF do empresário
  individual/MEI mascarado (`***`). Logo, digitar um CPF não encontra o titular, e o nome dele
  (público por lei) continua achável.
- **Uma agregação só.** O `$facet` do pipeline (`company-search.pipeline.ts`) devolve a
  janela e a contagem total numa única ida ao banco; a resposta é validada contra o schema antes
  de sair do repositório.

## Exportação da lista em XLSX

`GET /companies/export/xlsx` (UC09, RF15, #85) devolve, em um arquivo XLSX, a lista que a pesquisa de
empresas devolveria. Exige sessão. Aceita os **mesmos critérios e a mesma ordenação** de
`GET /companies` (`name`, `uf`, `city`, `cnae`, `ods`, `min_score`, `min_confidence`, `order`), com as
mesmas regras e o mesmo "ao menos um critério" (422), mas **sem paginação**: `page` e `page_size` são
ignorados, e o arquivo traz a lista inteira. A tradução dos critérios para o repositório é uma só
(`toSearchInput`), então o que se baixa é o que a tela mostra.

- **Conteúdo.** Uma linha por empresa, na ordem da pesquisa: CNPJ, razão social, nome fantasia,
  situação cadastral, UF, município, CNAE principal e descrição do CNAE e, **em colunas separadas para
  cada ODS ativo**, `ODS n - Índice` e `ODS n - Confiança` (RF15). As colunas de índice cobrem **todos**
  os ODS, e não só o selecionado na pesquisa: a planilha serve para comparar empresas. O que não foi
  calculado fica como **célula vazia**, e não como zero; o índice `0` é gravado como `0`. Índice e
  confiança nunca se combinam.
- **Sem dado pessoal (INL02).** Só os campos acima, que já são de pessoa jurídica: o nome do
  empresário individual/MEI sai com o CPF mascarado (`***`), e endereço de rua, hashes, fonte
  cadastral, datas internas e regras do índice não entram no arquivo.
- **Texto é texto.** As células de texto são gravadas como texto (tabela de textos do XLSX), nunca
  como fórmula: uma razão social como `=HYPERLINK(...)` aparece literalmente e não é executada ao
  abrir no Excel. O CNPJ, inclusive o alfanumérico e o com zeros à esquerda, também é texto.
- **Sem resultado, sem arquivo.** Nenhuma empresa atende aos critérios: `404 NO_RESULTS_TO_EXPORT`
  (o UC09 exige ao menos um resultado), e não uma planilha vazia.
- **Teto de empresas: `EXPORT_MAX_COMPANIES` (padrão 5000, de 1 a 20000; #336).** Acima dele,
  `422 EXPORT_TOO_LARGE` com `details = { total, max }`: o arquivo é montado em memória, e a base são
  as empresas já consultadas; refinar os critérios resolve. Recusa a exportar em vez de truncar em
  silêncio. O teto vem da configuração (NFSE04, h), como os demais limites operacionais.
- **Custo medido ponta a ponta (#336).** HTTP, banco (Mongo 8.3.11 local), leitura dos índices de todos
  os ODS ativos e montagem da planilha, dados sintéticos, 2 ODS, melhor de 3 execuções:

  | Empresas | Critério | Tempo | Arquivo | Memória (RSS / heap) |
  | --- | --- | --- | --- | --- |
  | 5 000 | `uf` | 565 ms | 0,25 MB | +28 / +27 MB |
  | 5 000 | `ods=15&order=desc` | 778 ms | 0,24 MB | +42 / +32 MB |
  | 20 000 | `uf` | 2,2 s | 1,00 MB | +83 / +111 MB |
  | 20 000 | `ods=15&order=desc` | 3,1 s | 0,91 MB | +81 / +117 MB |

  O padrão continua 5000 por prudência com a concorrência: o limite de 10 exportações por minuto
  por IP permite dez exportações simultâneas, e dez de 20 000 empresas somariam mais de 1 GB de
  heap, contra ~300 MB com 5 000. Quem eleva o teto deve dimensionar a memória da instância. Gravar
  o arquivo em fluxo (`toStream`) em vez de montar o buffer só se justifica acima de 20 000, que
  o teto máximo não permite; fica como alternativa registrada.
- **A leitura dos índices é em blocos de 100 (#336).** A medição achou o custo fora da planilha: o
  `in` de 5 000 CNPJs no Prisma levou 5,7 s para 10 000 linhas (a mesma consulta direta no MongoDB,
  170 ms), o que fazia a exportação de 5 000 empresas levar 6,4 s (8,0 s com `ods` ordenado). Em
  blocos de 100, lidos em paralelo (`SUMMARY_CHUNK_SIZE`), a leitura caiu para ~130 ms e a
  exportação para os números da tabela. A planilha em si sempre foi barata (372 ms para 5 000 linhas).
- **Resposta.** `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  `Content-Disposition: attachment; filename="empresas-bios-AAAA-MM-DD.xlsx"` e `Content-Length`. A
  planilha se chama `Empresas`, com o cabeçalho em negrito e fixo no topo, colunas com largura e
  índice e confiança com duas casas decimais (o valor gravado não é arredondado).
- **Limite de requisições.** 10 exportações por minuto por IP (`THROTTLE_COMPANY_EXPORT_LIMIT`),
  porque cada chamada monta um arquivo.
- **Só lê a base local.** Como a pesquisa, não chama fonte nem publica job. A rota fica em
  `/companies/export/xlsx` (e não em `/companies/export`) para nunca disputar o caminho com
  `GET /companies/:cnpj`.
- **Biblioteca.** `write-excel-file` (uma dependência, `fflate`), que grava o ZIP e o XML do XLSX sem
  carregar a planilha na memória em objetos pesados. `fflate` também é dependência de desenvolvimento
  direta, para os testes abrirem o arquivo e conferirem as células (`test/support/xlsx-reader.ts`).

---

[Índice da documentação](README.md) · ← [14. Índices por ODS](14-Índices-por-ODS.md) · [16. Chaves de API e API pública](16-Chaves-de-API.md) →
