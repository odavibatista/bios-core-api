# 04. Banco de dados e carga inicial

[Índice da documentação](README.md) · ← [03. Contrato da API (OpenAPI e CORS)](03-Contrato-da-API.md) · [05. Filas (BullMQ)](05-Filas.md) →

> Prisma sobre MongoDB, retenção por índices TTL e a carga dos catálogos num banco novo.

**Nesta página**

- [Banco de dados (Prisma)](#banco-de-dados-prisma)
- [Retenção de dados (índices TTL)](#retenção-de-dados-índices-ttl)
- [Catálogo de fontes: carga e sincronização](#catálogo-de-fontes-carga-e-sincronização)
- [Carga inicial de um banco novo e primeiro administrador (#329)](#carga-inicial-de-um-banco-novo-e-primeiro-administrador-329)

## Banco de dados (Prisma)

O schema é multiarquivo e fica distribuído pelos módulos:

- `src/shared/infra/database/schema.prisma` — apenas `generator` e `datasource`;
- `src/modules/<módulo>/entity/*.prisma` — modelos, tipos compostos e enums do módulo.

O `prisma.config.ts` aponta a raiz do schema para `src/`, e o Prisma reúne recursivamente
todos os arquivos `.prisma`. Para criar uma entidade, adicione o arquivo na pasta `entity/`
do módulo dono e rode `npm run prisma:generate` (e `npm run db:push` para criar índices).

Convenções: chave primária `id_<entidade>` (ObjectId em `_id`), chave estrangeira
`<entidade>_id`, campos em snake_case, coleções no plural com `@@map` e índices nomeados
`idx_<coleção>_<campos>`. Empresas são referenciadas pela chave natural `cnpj`, sem relação
Prisma, pois evidências podem existir antes do perfil cadastral.

O MongoDB precisa rodar como **replica set** (o `docker-compose.yml` já o configura): o
Prisma usa transações para as ações referenciais emuladas, como a cascata na exclusão de
conta.

## Retenção de dados (índices TTL)

Tokens, sessões, bloqueios e logs são removidos automaticamente pelo MongoDB após um prazo
configurável por variável de ambiente:

| Variável | Coleção | Conta a partir de | Padrão |
| --- | --- | --- | --- |
| `DATA_RETENTION_USER_TOKENS` | `user_tokens` | `expires_at` | `7d` |
| `DATA_RETENTION_USER_SESSIONS` | `user_sessions` | `expires_at` | `30d` |
| `DATA_RETENTION_ACCESS_BLOCKS` | `access_blocks` | `blocked_until` (bloqueios sem prazo nunca expiram) | `90d` |
| `DATA_RETENTION_LOGIN_ATTEMPTS` | `login_attempts` | `attempted_at` | `90d` |
| `DATA_RETENTION_HONEYPOT_HITS` | `honeypot_hits` | `hit_at` | `180d` |
| `DATA_RETENTION_EMAIL_DISPATCH_LOGS` | `email_dispatch_logs` | `created_at` | `180d` |
| `DATA_RETENTION_DATA_SOURCE_REQUEST_LOGS` | `data_source_request_logs` | `requested_at` | `90d` |

Durações exigem unidade (`m`, `h`, `d`, `w`; mínimo `1m`) e são validadas no boot.

Como o Prisma não declara índices TTL, cada campo acima tem um índice simples no schema do
módulo dono da coleção (criado pelo `db push`), e a API o converte em TTL a cada
inicialização (`DataRetentionModule`):

- índice ausente → criado já com TTL;
- índice simples ou TTL com outro prazo → ajustado via `collMod`, sem recriação;
- índice com o prazo configurado → nenhuma operação.

A sincronização roda em segundo plano e não bloqueia o boot; com o banco indisponível, é
adiada para a próxima inicialização. Desative com `DATA_RETENTION_SYNC_ON_BOOT=false`. As
regras ficam em `src/shared/config/data-retention.config.ts`, e um teste garante que cada
índice citado ali exista no schema Prisma correspondente.

## Catálogo de fontes: carga e sincronização

O seeder de fontes só **cria** o que falta: `update` vazio, de propósito, para que um novo
seed nunca desfaça ajustes feitos em produção. O preço é que um banco criado antes de um
ajuste do seed (`base_url` e timeout do IBAMA, host do GHG) nunca o recebe. O comando
`catalog:sync` (#256) fecha essa lacuna **sob demanda e sem surpresa**:

```bash
npm run catalog:sync              # dry-run: mostra o que mudaria; não grava nada
npm run catalog:sync -- --apply   # grava o que o dry-run mostrou
```

- **Nunca roda sozinho.** Não faz parte do boot da API, dos testes nem de nenhum hook. O banco
  alvo é o de `DATABASE_URL`; o comando imprime só o **nome** do banco (nunca a connection
  string) e, sem `--apply`, não escreve nada.
- **Diff antes de aplicar.** Para cada fonte: `CRIAR`, `ATUALIZAR` (campo a campo, `de -> para`)
  ou `igual`; fontes que estão no banco e o código não conhece são só listadas.
- **O que ele sincroniza:** o contrato da fonte (`name`, `base_url`, `role`, `ingestion_mode`,
  `evidence_category`, `request_timeout_ms`, `cache_ttl_seconds`) e a criação de fontes ausentes.
  **O que ele nunca altera:** o que a operação ajusta (`is_enabled`, `rate_limit_per_minute`,
  `fallback_priority`); quando o banco diverge do seed nesses campos, o dry-run avisa com
  `(mantido)`, e a divergência continua sendo uma decisão consciente.
- **Pré-requisito para criar fontes:** os ODS precisam existir (o comando recusa, sem gravar
  nada, se faltarem). Num banco **novo**, quem carrega os ODS, as fontes e a blacklist é o `catalog:bootstrap` (seção
  "Carga inicial de um banco novo e primeiro administrador"); `PrismaService.seed` segue recusando
  fora de `NODE_ENV=test` e de banco `*_test`.
- **Idempotente:** rodar de novo converge para o mesmo estado e, em sincronia, informa
  "O catálogo já está em sincronia com o código".

**Runbook (banco existente após atualizar a API):**

1. `npm run catalog:sync` e leia o diff, em especial as linhas `(mantido)`;
2. se estiver de acordo, `npm run catalog:sync -- --apply`;
3. rode `npm run catalog:sync` de novo: deve dizer que já está em sincronia;
4. para um valor que você quer diferente do seed, ajuste no banco e mantenha o seed como
   está; campos de contrato divergentes voltam a aparecer no diff a cada execução, de propósito.

## Carga inicial de um banco novo e primeiro administrador (#329)

Um banco novo não tem nada: sem ODS ativo o cálculo não gera índice algum, sem fontes nenhum
adapter consulta, e sem a blacklist o RF22 (b) não se cumpre. Os seeders só rodam nos testes, então
há dois comandos para a produção. Os dois seguem o mesmo padrão do `catalog:sync`: **dry-run por
padrão**, `-- --apply` grava, nada roda no boot da API, rodam fora do Nest e nunca imprimem a
connection string.

```bash
npm run catalog:bootstrap              # mostra o que seria carregado
npm run catalog:bootstrap -- --apply   # carrega ODS, fontes de dados e blacklist
npm run account:promote -- --email adm@exemplo.com            # dry-run
npm run account:promote -- --email adm@exemplo.com --apply    # promove a ADMIN
```

**`catalog:bootstrap`.** Roda os seeders de catálogo na ordem de dependência (ODS, fontes,
blacklist), os mesmos dos testes. É **idempotente** e **só cria o que falta**: uma fonte que já existe
nunca é alterada (ajustes de operação, como `rate_limit_per_minute` e `is_enabled`, prevalecem; para
alinhar o contrato de uma fonte existente, use `catalog:sync`), e um domínio da blacklist removido pelo
administrador não é recriado. Os ODS, de título e descrição oficiais, são reaplicados. O resumo mostra,
por catálogo, quantos itens seriam criados e quantos já existem; sai com `0` se tudo certo, `1` se algo
falhar ou restar item por carregar e `2` para opção desconhecida.

**`account:promote`.** Troca o papel de uma conta entre `USER` e `ADMIN`: o administrador é a mesma
entidade da conta comum, e a promoção não tem interface no MVP (`11-Permissões.md`, §11.3).

- **Localiza pelo e-mail** com o mesmo índice cego do login (`BLIND_INDEX_KEY`), normalizado (caixa e
  espaços), então `  Adm@Exemplo.COM ` acha a conta. O ambiente é validado como a API valida; a chave
  nunca é impressa, e o comando mostra só o identificador e o papel da conta, nunca o e-mail nem o nome.
- **Encerra as sessões abertas da conta** (`revocation_reason = ROLE_CHANGE`), na mesma transação da
  troca. O papel viaja no access token, e o token só vence em até 15 minutos: sem isso, um administrador
  **rebaixado** seguiria administrador até lá, e um recém-promovido não veria o papel novo. Com a revogação,
  o token antigo e o refresh token passam a dar `401`, e o novo login já traz o papel certo.
- **Só promove conta com o e-mail confirmado** (`is_active`): um ADMIN com e-mail não verificado
  seria um acesso privilegiado sem dono comprovado.
- **`--demote`** devolve um `ADMIN` a `USER` e **recusa rebaixar o último administrador ativo**, para a
  gestão da blacklist (RF29) nunca ficar sem quem a opere.
- Conta que já tem o papel pedido: nada é alterado e as sessões ficam como estão (exit `0`).

**Runbook de banco novo:** (1) `npm run docker:up` ou o MongoDB de destino no ar, com `DATABASE_URL`
apontando para ele; (2) `npm run db:push`; (3) `npm run catalog:bootstrap`, lendo o resumo, e depois
`-- --apply`; (4) a pessoa que será administradora se cadastra e confirma o e-mail pela API;
(5) `npm run account:promote -- --email ...` e depois `-- --apply`.

---

[Índice da documentação](README.md) · ← [03. Contrato da API (OpenAPI e CORS)](03-Contrato-da-API.md) · [05. Filas (BullMQ)](05-Filas.md) →
