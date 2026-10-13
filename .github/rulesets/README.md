# Rulesets dos branches

Proteção dos branches do fluxo `develop` → `pre-prod` → `main` (RNF NFSE11), versionada
como código. Os arquivos seguem o formato de exportação de rulesets do GitHub.

| Arquivo | Branches | Regras |
| --- | --- | --- |
| `protecao-main-pre-prod.json` | `main`, `pre-prod` | PR obrigatório, apenas **merge commit** (promoções mantêm o mesmo histórico entre os branches), checks **Lint** e **Testes** aprovados, conversas resolvidas, sem force push nem exclusão |
| `protecao-main-pre-prod.json` | `main`, `pre-prod` | PR obrigatório, apenas **merge commit** (promoções mantêm o mesmo histórico entre os branches), checks **Lint** e **Testes** aprovados com branch atualizado, conversas resolvidas, sem force push nem exclusão |

Os checks são os jobs do workflow `.github/workflows/ci.yml`, restritos ao GitHub Actions
(`integration_id` 15368). Nenhum PR exige aprovação de revisor, pois o projeto tem um único
integrante; a barreira de qualidade é o CI. Não há atores com permissão de ignorar as regras.

## Exigência de branch atualizado

`strict_required_status_checks_policy` (em *Settings*, "Require branches to be up to date
before merging") vale **só no `develop`**:

- **No `develop` ela protege de verdade.** Um branch de tarefa fica aberto enquanto o
  `develop` avança, e dois conjuntos de mudanças que passam isolados podem se contradizer
  quando juntos. Exigir o branch atualizado força esse encontro antes do merge.
- **Nas promoções ela só atrapalha.** Cada promoção cria um merge commit **no destino**, que
  nunca volta para a origem: terminada a primeira, o `pre-prod` já está permanentemente
  "atrás" da `main`, e o `develop`, atrás do `pre-prod`. Com a regra ligada, toda promoção
  exigiria antes um merge de volta (`main` → `pre-prod` → `develop`) — dois merges extras por
  entrega, invertendo o fluxo de mão única do projeto e enchendo o `develop` de commits de
  sincronia.

Desligá-la nas promoções **não afrouxa o CI**: `Lint` e `Testes` continuam obrigatórios e,
como o workflow roda no evento `pull_request`, o GitHub os executa sobre o *merge* de origem e
destino — ou seja, o que é testado já é o resultado da promoção, e não o branch de origem
isolado. A exigência de branch atualizado seria uma segunda checagem do mesmo fato.

## Como aplicar

Em **Settings → Rules → Rulesets → New ruleset → Import a ruleset**, importe cada arquivo e
salve. Para alterar uma regra, edite o JSON neste diretório e reimporte, mantendo o
repositório como fonte de verdade.

## Demais configurações do repositório

Não são exportáveis como ruleset e devem ser feitas em **Settings**:

| Onde | Configuração |
| --- | --- |
| General → Default branch | `develop` |
| General → Pull Requests | Permitir **merge commits** e **squash merging**; desabilitar **rebase merging**; marcar **Automatically delete head branches** |
| Actions → General → Workflow permissions | **Read repository contents and packages permissions**; desmarcar **Allow GitHub Actions to create and approve pull requests** |
| Code security | Habilitar **Dependency graph**, **Dependabot alerts** e **Dependabot security updates** |
| Issues → Labels | `back-end`, `feature`, `bugs`, `chore`, `dependencies` e as etiquetas de tipo de teste do quadro (unitário, integração, e2e, funcional) |
