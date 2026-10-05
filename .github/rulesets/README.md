# Rulesets dos branches

Proteção dos branches do fluxo `develop` → `pre-prod` → `main` (RNF NFSE11), versionada
como código. Os arquivos seguem o formato de exportação de rulesets do GitHub.

| Arquivo | Branches | Regras |
| --- | --- | --- |
| `protecao-develop.json` | `develop` | PR obrigatório, apenas **squash merge** (um commit por tarefa), checks **Lint** e **Testes** aprovados com branch atualizado, conversas resolvidas, sem force push nem exclusão |
| `protecao-main-pre-prod.json` | `main`, `pre-prod` | PR obrigatório, apenas **merge commit** (promoções mantêm o mesmo histórico entre os branches), checks **Lint** e **Testes** aprovados com branch atualizado, conversas resolvidas, sem force push nem exclusão |

Os checks são os jobs do workflow `.github/workflows/ci.yml`, restritos ao GitHub Actions
(`integration_id` 15368). Nenhum PR exige aprovação de revisor, pois o projeto tem um único
integrante; a barreira de qualidade é o CI. Não há atores com permissão de ignorar as regras.

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
