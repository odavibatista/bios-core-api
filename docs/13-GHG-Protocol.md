# 13. Inventário GHG Protocol

🇧🇷 **Português** · 🇺🇸 [English](en/13-GHG-Protocol.md)

[Índice da documentação](README.md) · ← [12. IBAMA](12-IBAMA.md) · [14. Índices por ODS](14-Índices-por-ODS.md) →

> Inventários de emissões do Registro Público do GHG Protocol (UC07).

`GhgModule` exporta `GetGhgCompanyEvidencesUseCase.execute(cnpj)`. Ele reutiliza a
evidência local válida ou publica `fetch-ghg-inventory` na fila exclusiva
`ghg-inventory` e aguarda com `data_sources.request_timeout_ms` (padrão 10 s).
Timeout, job falho ou Redis indisponível preservam a resposta anterior; sem ela,
`UNKNOWN`. O job pode concluir depois do timeout do chamador. A consolidação já reúne o GHG
na #75; a exposição no perfil foi entregue na #81. Não há endpoint nem score novo.

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
os dois hosts oficiais, conforme o portal. O seed não sobrescreve configurações; para
alinhar um banco antigo ao seed, use `npm run catalog:sync` ([Catálogo de fontes](04-Banco-de-Dados.md#catálogo-de-fontes-carga-e-sincronização)). Nenhuma variável de ambiente ou migração de schema foi adicionada.

**Hosts fixos em código (exceção documentada, #256).** O portal usa dois hosts para o
mesmo serviço: um para a API (`registropublicodeemissoesapi.fgv.br`) e outro para o download
do relatório (`sistema-registropublicodeemissoesapi.fgv.br`), e o catálogo tem uma única
`base_url`. Por isso `ghgBaseUrl` traduz os dois hosts oficiais conhecidos para o host certo de
cada chamada, e o link público do relatório (`toGhgEvidence`) também é fixo. **Na prática, o
catálogo só decide o endereço quando ele não é um dos hosts oficiais** (é assim que os testes
apontam para um servidor local). Mover o host do relatório para o catálogo pediria uma
coluna nova em `data_sources` (schema e DBML) só para um valor que o portal fixa; se um dia
o portal mudar de host, a alteração é uma linha em `ghgBaseUrl` e em `toGhgEvidence`, coberta
pelo teste de contrato (`npm run test:contract`), que acusa o host que deixou de responder.

---

[Índice da documentação](README.md) · ← [12. IBAMA](12-IBAMA.md) · [14. Índices por ODS](14-Índices-por-ODS.md) →
