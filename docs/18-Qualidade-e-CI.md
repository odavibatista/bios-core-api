# 18. Qualidade e integração contínua

[Índice da documentação](README.md) · ← [17. Testes](17-Testes.md)

> Hooks locais, pipeline do CI e fluxo de contribuição.

**Nesta página**

- [Hooks locais (Husky)](#hooks-locais-husky)
  - [Pre-push rápido (#367)](#pre-push-rápido-367)
- [CI (GitHub Actions)](#ci-github-actions)
  - [Imagens do CI fixadas por digest](#imagens-do-ci-fixadas-por-digest)
  - [Testes de contrato das fontes reais](#testes-de-contrato-das-fontes-reais)
- [Fluxo de contribuição](#fluxo-de-contribuição)

## Hooks locais (Husky)

Instalados automaticamente pelo `npm install` (script `prepare`).

| Hook | Verificação | Escopo |
| --- | --- | --- |
| `pre-commit` | ESLint (`--max-warnings=0`), Prettier e testes relacionados (`vitest related`); `prisma format --check` e `prisma validate` quando há `.prisma` no commit | Apenas arquivos em stage (`lint-staged.config.mjs`), em lotes de até 6000 caracteres: o limite padrão do Windows (8191) não conta as aspas dos caminhos com espaço, e um commit com dezenas de arquivos estourava a linha de comando |
| `commit-msg` | Conventional Commits com escopo restrito aos módulos e áreas do projeto | Mensagem do commit (`commitlint.config.mjs`) |
| `pre-push` | `scripts/verify-push.mjs`: typecheck, ESLint do projeto inteiro e só os testes unitários afetados pelos arquivos enviados (`vitest related`) | Todos os commits ainda não publicados; dispensado quando o push não altera código, schema ou configuração |

### Pre-push rápido (#367)

O pre-push rodava `npm run verify` (typecheck, todos os unitários com cobertura e todos os e2e) e
passou a custar cerca de **11 minutos** por push (só o e2e, 593 s na rodada da #333). Agora roda o
que é barato e decisivo antes de publicar, e deixa a suíte completa para o CI:

| Etapa | Onde roda | O que garante |
| --- | --- | --- |
| `pre-commit` | cada commit | ESLint, Prettier e testes afetados pelos arquivos em stage (NFSE09) |
| `pre-push` | cada push com código | typecheck, **ESLint do projeto inteiro** e testes unitários afetados pelos arquivos de todos os commits enviados |
| CI | toda PR e todo push para `develop`, `pre-prod` e `main` | lint, Prettier, typecheck, **todos** os unitários com cobertura mínima de 75% (NFPD03) e **todos** os e2e; é o check exigido pela proteção de branches (NFSE11) |

- **Quais testes rodam.** `vitest related` segue o grafo de imports a partir dos arquivos enviados.
  Mudança em `package.json`, `package-lock.json`, `tsconfig*.json`, configuração do Vitest ou
  schema Prisma roda a suíte inteira de unitários (`forceRerunTriggers` em `vitest.config.ts`: o
  grafo não enxerga esses arquivos). Sem base para comparar ou com mais de 200 arquivos, também
  roda tudo, nunca nada.
- **Por que os e2e saem do push.** Cada arquivo e2e sobe o `AppModule` inteiro; pelo grafo de
  imports, qualquer mudança em `src` afeta todos eles, e um filtro por diff selecionaria a suíte
  inteira de qualquer forma. Eles rodam no CI, e `npm run verify` os roda localmente.
- **O lint entrou no push.** O pre-push antigo não rodava o ESLint, e o erro de tipos inseguros de
  um e2e da #333 só apareceu no CI. O lint-staged do commit corrige o que pode, mas não substitui
  o lint completo.
- **Tempo medido** (Windows, mesma máquina): um arquivo de código alterado, **82 s** (typecheck,
  ESLint e 2 arquivos de teste); schema Prisma, `tsconfig` ou mais de 200 arquivos, 113 a 116 s
  (suíte inteira de unitários); nada de código, 54 s. Antes, ~11 min em qualquer caso.
- **Uso manual.** `npm run verify:push` compara a branch com `origin/develop` (base comum), somando
  o que ainda não foi commitado.

## CI (GitHub Actions)

O workflow `.github/workflows/ci.yml` roda em pull requests e pushes para `develop`, `pre-prod`
e `main`, sem etapa de deploy:

- **Lint**: mensagens de commit e título do PR, schema Prisma, ESLint, Prettier e typecheck;
- **Testes**: unitários com limite de cobertura de 75%, e2e contra o MongoDB e o Redis do
  `docker-compose.yml` (aguardados por `docker compose up --wait`), resumo de cobertura no
  job e relatório completo como artefato. A imagem do MongoDB é **fixada no patch**
  (`mongo:8.3.11`), para o CI e cada máquina rodarem o mesmo banco; subir a versão é uma
  mudança deliberada no `docker-compose.yml`. Se a infraestrutura falhar ao subir, um passo
  imprime o log dos contêineres.
- **Runner do job Testes fixo no Ubuntu 22.04.** Do kernel Linux 6.19 ao 7.0.13 o MongoDB 8 se
  recusa a iniciar (incompatibilidade do tcmalloc com o kernel, SERVER-121912, válida para todas as
  imagens e pacotes do 8.x; resolvida no kernel 7.0.14). O `ubuntu-latest` passou a usar um kernel
  dessa faixa, e o passo da infraestrutura falhava com `container bios-mongodb exited (1)`. Um
  passo registra o `uname -r` do runner. Rodar o banco local não é afetado (o kernel do Docker
  Desktop é anterior). Se o 22.04 também chegar a essa faixa, a alternativa é usar o MongoDB 7.0 no
  CI, que não tem o problema.

As actions são fixadas por SHA de commit e atualizadas pelo Dependabot
(`.github/dependabot.yml`), que também abre PRs semanais de dependências npm contra o
`develop`, agrupadas por ecossistema. As majors que a stack não aceita ficam bloqueadas lá,
com o motivo registrado: Prisma 7 (sem suporte a MongoDB), TypeScript 7 (recusado pelos peers
do `@nestjs/swagger` e do `typescript-eslint`) e Vitest 5 (binário nativo do Rolldown que o
npm não instala a partir do lockfile).

### Imagens do CI fixadas por digest

O job Testes obtém o MongoDB e o Redis por registros alternativos (espelho do Google, ECR
Public e Docker Hub, nesta ordem), e uma tag publicada pode passar a apontar para outro
conteúdo sem aviso. Por isso o conteúdo é decidido pelo **digest do índice multi-arquitetura**
em `.github/ci-images.lock` (o mesmo nos três registros): `pull-ci-images.sh` puxa
`<registro>/<imagem>@sha256:…`, o motor recusa conteúdo diferente e só então aplica a tag
local que o `docker-compose.ci.yml` espera. Imagem do Compose sem digest no lock interrompe a
etapa antes de subir a infraestrutura. O Compose de desenvolvimento segue por tag.

Para subir uma versão (mudança deliberada, em PR próprio):

1. alterar a tag em `docker-compose.yml`, em `docker-compose.ci.yml` e na primeira coluna de
   `.github/ci-images.lock`;
2. rodar `bash .github/scripts/update-ci-images.sh` (precisa de Docker com buildx e rede), que
   resolve o digest atual de cada tag e regrava o lock;
3. rodar `bash .github/scripts/pull-ci-images.test.sh` e `update-ci-images.test.sh` (sem rede).

O Dependabot não atualiza o lock. Quem vigia a defasagem é o job **Imagens do CI** do workflow
de contrato (abaixo), que roda `update-ci-images.sh --check` e falha quando a tag passou a
apontar para outro digest (rebuild da imagem base, por exemplo). A falha é um aviso: o lock só
muda pelo procedimento acima.

### Testes de contrato das fontes reais

Os e2e simulam cada fonte com a forma que o código supõe, e foi assim que o erro do GHG (10
organizações em vez de 1029) passou. O workflow `.github/workflows/contract.yml` (toda segunda
às 09:00 UTC e sob demanda, em *Actions → Contrato das fontes → Run workflow*) consulta as
fontes reais com os mesmos leitores do código de produção e acusa mudança de formato.
**Não é status check de PR** e não entra em `verify` nem no pre-push.

| Fonte | O que o contrato confere |
| --- | --- |
| IBAMA | Download dos dois dumps em `200` e fora de página HTML; tamanho entre 1 MB e o limite do adapter; cabeçalho do CSV com todas as colunas lidas; amostra de 50 mil linhas com registros de pessoa jurídica que o mapper aceita. |
| CGU (CEIS e CNEP) | `200` em JSON com a chave no cabeçalho `chave-api-dados`; linhas aceitas pelo leitor da página; página 2 diferente da 1; chamada sem chave recusada (`401`/`403`). |
| GHG | `SearchAllOrganizations` entrega a página inteira pedida (não uma amostra) com total acima dela; página seguinte sem repetir organizações; inventário publicado; relatório em PDF (`%PDF`, abaixo do limite) cujo CNPJ e ano o leitor identifica. |

Os endereços vêm do catálogo semeado (`data_sources.seeder.ts`), ou seja, o que vai a produção.
A chave da CGU é o secret `CGU_API_KEY` do repositório: chega só como variável de ambiente do
passo (mascarada nos logs), e os testes não a imprimem nem a repassam a mensagens de erro. No
CI, secret ausente reprova a execução; localmente a suíte da CGU é pulada com aviso.

```bash
npm run test:contract      # as três fontes (baixa ~330 MB do IBAMA); CGU_API_KEY no ambiente
npx vitest run --config vitest.config.contract.ts test/contract/ghg.contract-spec.ts   # uma fonte
```

## Fluxo de contribuição

1. Abrir a issue pelo template adequado (tarefa, bug ou configuração), colando os artefatos
   do bios-docs que a embasam.
2. Criar o branch a partir do `develop` e abrir o PR de volta para ele, com título em
   Conventional Commits (ele vira a mensagem do commit no squash merge).
3. Promover `develop` → `pre-prod` → `main` por PR; `main` e `pre-prod` são protegidos e só
   aceitam merge com os checks **Lint** e **Testes** aprovados (RNF NFSE11).

---

[Índice da documentação](README.md) · ← [17. Testes](17-Testes.md)
