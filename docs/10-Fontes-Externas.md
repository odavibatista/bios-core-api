# 10. Fontes externas (adapters)

🇧🇷 **Português** · 🇺🇸 [English](en/10-External-Sources.md)

[Índice da documentação](README.md) · ← [09. E-mails transacionais](09-E-mails.md) · [11. Evidências](11-Evidências.md) →

> Adapters das fontes públicas, cadeia de fallback cadastral e descrição dos CNAEs.

**Nesta página**

- [Cadastro: CadastralRecord e o adapter da BrasilAPI](#cadastro-cadastralrecord-e-o-adapter-da-brasilapi)
- [Cadeia de fallback cadastral](#cadeia-de-fallback-cadastral)
- [Descrição dos CNAEs: IBGE](#descrição-dos-cnaes-ibge)

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

## Cadastro: `CadastralRecord` e o adapter da BrasilAPI

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
- **Situação cadastral em conjunto fechado (#338).** `normalizeRegistrationStatus` leva a situação
  de qualquer provedor ao conjunto `ATIVA`, `SUSPENSA`, `INAPTA`, `BAIXADA`, `NULA` ou
  `NAO_RECONHECIDA`, declarado como enum no OpenAPI (`RegistrationStatus`) para o front traduzir,
  filtrar e colorir:
  - a descrição é comparada só pelas letras, sem caixa, acento ou pontuação (`ATIVA`, `Ativa`);
    o código da Receita (`situacao_cadastral`: 1, 2, 3, 4 e 8) vale quando a descrição falta, não
    casa ou vem no lugar dela;
  - situação informada fora das cinco **não descarta o cadastro nem se perde**: vira
    `NAO_RECONHECIDA`, com o texto do provedor em `registration_status_unrecognized` (no perfil e
    no banco); só a ausência de situação continua recusando a resposta;
  - cadastros gravados antes do conjunto fechado são lidos pela mesma regra (perfil e pesquisa):
    a descrição antiga fora do conjunto sai como `NAO_RECONHECIDA`, com o texto guardado;
  - o hash de conteúdo das situações reconhecidas é o mesmo de antes; a não reconhecida entra pelo
    texto do provedor.
  - Um filtro de situação na pesquisa ficou de fora: a HU23 pede CNAE, UF, município e mínimos por
    ODS, e não situação.

`MinhaReceitaDataSource` (`minha-receita/`, slug `MINHA_RECEITA`, prioridade 3, fallback
final) fecha a cadeia. A BrasilAPI e o Minha Receita servem os mesmos dados da Receita **no
mesmo formato**, então os dois leem a resposta pelo mapper comum
`data-sources/domain/receita-open-data.mapper.ts`: assim nenhum módulo de adapter depende do
outro (NFPD02), e, se um deles divergir do formato, o mapper dele passa a ser próprio. O
OpenCNPJ tem formato próprio e mapper próprio. Um teste de consistência garante que a mesma
empresa resulte no mesmo `CadastralRecord` em qualquer provedor (salvo o código IBGE, que o
OpenCNPJ não informa).

## Cadeia de fallback cadastral

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

## Descrição dos CNAEs: IBGE

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
diário do IBAMA, definem o próprio fluxo de ingestão (ver [IBAMA](12-IBAMA.md)).

---

[Índice da documentação](README.md) · ← [09. E-mails transacionais](09-E-mails.md) · [11. Evidências](11-Evidências.md) →
