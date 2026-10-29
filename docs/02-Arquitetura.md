# 02. Arquitetura e convenções

[Índice da documentação](README.md) · ← [01. Como rodar](01-Como-Rodar.md) · [03. Contrato da API (OpenAPI e CORS)](03-Contrato-da-API.md) →

> Organização em módulos e camadas, e as convenções de código seguidas em todo o projeto.

Clean Architecture sobre módulos Nest. Cada módulo agrupa entidades fortemente
relacionadas (ex.: `accounts` reúne `User` e `UserToken`), e os módulos são reunidos em
agregadores de domínio — o `AppModule` nunca importa módulos de negócio diretamente.

```
src/
├── app/
│   ├── main.ts                       # bootstrap
│   ├── app.module.ts                 # raiz: SharedModule + agregadores
│   └── domains/                      # agregadores de domínio
│       ├── identity-and-access.module.ts
│       └── sustainability-intelligence.module.ts
├── shared/                           # infraestrutura e contratos transversais
│   ├── config/                       # ambiente (Zod) e documentação da API
│   ├── domain/
│   │   ├── dtos/                     # controllers, errors, requests (schemas Zod)
│   │   ├── errors/                   # DomainException e exceções comuns
│   │   ├── protocols/                # UseCase<TInput, TOutput>
│   │   └── providers/                # contratos de providers
│   ├── http/                         # controllers e decorators compartilhados
│   └── infra/
│       ├── database/                 # schema.prisma (datasource), PrismaService, PrismaRepository
│       ├── filters/                  # AllExceptionsFilter
│       ├── modules/                  # SharedModule
│       ├── pipes/                    # SchemaValidationPipe
│       └── usecases/
└── modules/
    └── <módulo>/
        ├── domain/
        │   ├── dtos/
        │   │   ├── controllers/      # contratos dos controllers
        │   │   ├── errors/           # exceções do módulo (extends DomainException)
        │   │   ├── repositories/     # contratos de repositório (classes abstratas) e DTOs
        │   │   └── requests/         # schemas Zod de request/response
        │   └── providers/            # contratos de providers do módulo
        ├── entity/                   # schemas Prisma (*.prisma) das entidades do módulo
        ├── http/controllers/
        └── infra/
            ├── db/repositories/      # implementações Prisma (extends PrismaRepository)
            ├── modules/              # <módulo>.module.ts
            ├── providers/
            └── usecases/             # extends UseCase<TInput, TOutput>
```

## Módulos

| Agregador | Módulo | Entidades |
| --- | --- | --- |
| Identidade e acesso | `accounts` | `User`, `UserToken` |
| | `authentication` | `UserSession`, `LoginAttempt` |
| | `api-keys` | `ApiKey` |
| | `security` | `AccessBlock`, `HoneypotHit`, `BlockedEmailDomain` |
| | `honeypot` | — (rotas isca com empresas sintéticas; registra em `security`) |
| | `mailing` | `EmailDispatchLog` |
| Inteligência socioambiental | `data-sources` | `DataSource`, `IngestionRun`, `DataSourceRequestLog` |
| | `receita` | — (cadeia cadastral: `brasil-api` → `opencnpj` → `minha-receita`, um adapter por módulo) |
| | `ibge-cnae` | — (adapter da descrição de CNAE) |
| | `ibama`, `cgu`, `ghg` | — (adapters das fontes de evidência; gravam em `evidences`) |
| | `evidences` | `EvidenceRaw`, `EvidenceNormalized`, `EvidenceCollectionClock` |
| | `environmental-intelligence` | — (orquestra as fontes de evidência; sem entidades próprias) |
| | `companies` | `CompanyProfile` |
| | `scoring` | `Ods`, `CompanyOdsScore`, `SectorScoreSnapshot` |

## Convenções de código

- **Injeção por contrato.** Casos de uso dependem de classes abstratas (repositórios e
  providers), registradas no módulo com `{ provide: Contrato, useClass: Implementacao }`.
  Classes abstratas — e não interfaces — porque existem em tempo de execução e servem de
  token de injeção.
- **Casos de uso tipados.** Todo caso de uso estende `UseCase<TInput, TOutput>`; nada de
  `any` na assinatura de `execute`.
- **Repositórios.** Estendem `PrismaRepository`, que recebe o `PrismaService` por injeção.
  Não existe instância global de `PrismaClient`.
- **DTOs com Zod.** Entrada validada no próprio parâmetro (`@Body({ schema })`,
  `@Query({ schema })`, `@Param({ schema })`); saída declarada com `@ResponseSchema(schema)`,
  que documenta a resposta no OpenAPI **e** descarta campos fora do schema na serialização.
- **Erros.** Exceções de negócio estendem `DomainException` (código estável + status HTTP);
  o `AllExceptionsFilter` converte qualquer erro no corpo padronizado `ErrorResponse`.
  Erros de validação respondem 422 com a lista de campos inválidos.
- **Mensagens de erro em português (#398).** As mensagens escritas no domínio e nos schemas têm
  precedência. As padrão do Zod saem do locale pt-BR (`validation-messages.config.ts`, aplicado
  pelo `SharedModule` antes da validação do ambiente, pela CLI `account:promote` e pelo setup dos
  testes unitários), com "Campo obrigatório." para campo ausente. Erros do próprio framework
  (`HttpException` e erros 4xx no formato `http-errors`, como o 413 do body-parser) mantêm o
  `code` derivado do status, mas a mensagem vem da tabela `FRAMEWORK_ERROR_MESSAGES` do filtro: o
  texto original, em inglês, nunca chega ao cliente (`Cannot GET /x`, `Unexpected token ...`).
  Corpo acima do limite padrão do body-parser (100 KB) responde 413 `PAYLOAD_TOO_LARGE`.
- **Controllers** retornam valores — sem `@Res()` —, preservando interceptors, filtros e
  serialização do framework.
- **Imports.** Relativos dentro da mesma área (`app`, `shared` ou um módulo); entre áreas,
  pelos aliases `@app/*`, `@shared/*` e `@modules/*`; os testes de `src/` chegam ao apoio de
  teste (`test/`) por `@test/*`. Por ser ESM, todo import relativo ou por alias termina em
  `.js`.
- **Textos em pt-BR, com acentuação (#258).** Tudo que a API expõe — mensagens de erro,
  descrições do OpenAPI, resumos de evidência e e-mails — é escrito com acento, til e cedilha
  (`inválido`, `índice`, `explicação`). O teste `src/shared/domain/portuguese-accents.spec.ts` varre os
  literais de texto do código de produção e dos e-mails e **reprova** a grafia sem acento de uma
  lista de palavras (`invalido`, `nao`, `indice`...); ao achar uma nova, acrescente a grafia errada à
  lista do teste. Identificadores, nomes de campo das fontes, URLs e comentários ficam de fora.

---

[Índice da documentação](README.md) · ← [01. Como rodar](01-Como-Rodar.md) · [03. Contrato da API (OpenAPI e CORS)](03-Contrato-da-API.md) →
