## Descrição

<!-- O que este PR entrega e por quê. -->

## Issue

Closes #

## Rastreabilidade

<!-- IDs dos artefatos do bios-docs atendidos (UC, RF, RNF, RIN, HU). Ex.: UC02, RF02, RF20, HU09, NFSE06 -->

## Tipo de mudança

- [ ] `feat` — funcionalidade
- [ ] `fix` — correção de bug
- [ ] `refactor` — refatoração sem mudança de comportamento
- [ ] `test` — testes
- [ ] `chore` / `ci` / `build` / `docs` — configuração, pipeline, dependências ou documentação

## Como testar

<!-- Passos, endpoints, payloads e pré-condições (variáveis de ambiente, dados no banco). -->

## Impacto

- [ ] Baixo
- [ ] Médio
- [ ] Alto — altera contrato da API, schema do banco ou variáveis de ambiente (detalhar abaixo)

## Checklist

- [ ] Branch de destino segue o fluxo `develop` → `pre-prod` → `main`
- [ ] Título do PR e commits no padrão Conventional Commits
- [ ] CI verde: lint, typecheck, testes com cobertura ≥ 75% e e2e
- [ ] Schemas de request e response declarados (validação e OpenAPI)
- [ ] Mudanças de schema refletidas no DBML do bios-docs
- [ ] Novas variáveis de ambiente validadas e documentadas no `.env.example`
- [ ] Nenhum dado pessoal de indivíduo exposto ou persistido (INL02)
