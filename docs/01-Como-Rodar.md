# 01. Como rodar

[Índice da documentação](README.md) · [02. Arquitetura e convenções](02-Arquitetura.md) →

> Pré-requisitos, primeiros passos e scripts do projeto.

## Pré-requisitos

| Ferramenta | Versão |
| --- | --- |
| Node.js | ≥ 22.22.3 |
| npm | ≥ 11 |
| Docker com Compose | Sobe o MongoDB 8 (replica set) e o Redis 7 do `docker-compose.yml` |

O `.env` precisa de um servidor SMTP (a API não sobe sem ele: a confirmação de cadastro e a recuperação de
senha dependem de envio) e, para as sanções da CGU, do token `CGU_API_KEY`, que é opcional. Cada variável
está comentada no `.env.example`.

## Como rodar

```bash
npm install                 # instala dependências e gera o Prisma Client
cp .env.example .env        # ajuste as variáveis se necessário
npm run keys:generate       # gera as chaves de criptografia e cole-as no .env
npm run docker:up           # MongoDB (replica set) e Redis
npm run db:push             # cria coleções e índices a partir do schema Prisma
npm run start:dev           # API em http://localhost:3000
```

| Endereço | Conteúdo |
| --- | --- |
| `GET /health` | Situação da API, do banco e do Redis |
| `/docs` | Referência interativa da API (Scalar) |
| `/docs/openapi.json` | Documento OpenAPI (modelos nomeados, `operationId` estável; ver [Contrato da API](03-Contrato-da-API.md)) |

## Scripts

| Script | Função |
| --- | --- |
| `start:dev` / `start:debug` / `start:prod` | Executa a API (watch / debug / build compilado) |
| `build` | Compila para `dist/` |
| `lint` / `lint:check` | ESLint com e sem correção automática |
| `format` / `format:check` | Prettier com e sem reescrita |
| `typecheck` | Verificação de tipos sem emitir arquivos |
| `test` / `test:watch` / `test:cov` | Testes unitários (com limite de cobertura de 75%) |
| `test:e2e` | Testes ponta a ponta (pipeline HTTP, banco real e filas no Redis) |
| `verify` | Typecheck, testes com cobertura e e2e: a suíte completa, a mesma do CI |
| `verify:push` | O que roda no pre-push: typecheck, ESLint do projeto inteiro e só os testes unitários afetados pelo diff contra `origin/develop` |
| `prisma:generate` / `prisma:validate` / `prisma:format` | Operações sobre o schema Prisma |
| `keys:generate` | Gera as chaves de criptografia do `.env` (`-- --version N` para rotacionar) |
| `db:push` | Sincroniza coleções e índices do MongoDB com o schema |
| `catalog:sync` | Compara o catálogo de fontes do banco com o seed (dry-run); `-- --apply` grava. Ver [Catálogo de fontes](04-Banco-de-Dados.md#catálogo-de-fontes-carga-e-sincronização) |
| `catalog:bootstrap` | Carga inicial de ODS, fontes e blacklist num banco novo (dry-run; `-- --apply` grava). Ver [Carga inicial](04-Banco-de-Dados.md#carga-inicial-de-um-banco-novo-e-primeiro-administrador-329) |
| `account:promote` | Promove uma conta a `ADMIN` (`-- --email <e-mail>`; `--demote` rebaixa; `--apply` grava) e encerra as sessões dela |
| `docker:up` / `docker:down` | Sobe/derruba a infraestrutura local |

---

[Índice da documentação](README.md) · [02. Arquitetura e convenções](02-Arquitetura.md) →
