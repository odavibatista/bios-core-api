# 03. Contrato da API (OpenAPI e CORS)

[Índice da documentação](README.md) · ← [02. Arquitetura e convenções](02-Arquitetura.md) · [04. Banco de dados e carga inicial](04-Banco-de-Dados.md) →

> O documento OpenAPI que o front e os integradores consomem, a geração de cliente e o CORS.

O documento em `/docs/openapi.json` (e a referência em `/docs`) é o contrato que o app Angular e os
sistemas de terceiros consomem (RF17, #330). Ele é gerado dos controllers e dos schemas Zod, e foi
preparado para **geração de cliente**:

- **Modelos nomeados.** Todo schema de requisição e de resposta é um componente em
  `components.schemas`, referenciado por `$ref`: `CompanyFullProfileResponse`, `SearchCompaniesResponse`,
  `ErrorResponse`, `SessionResponse`… são tipos que o front importa, e não objetos anônimos copiados em cada
  rota. O nome vem do `.meta({ id: '...' })` do próprio schema Zod (em inglês, no padrão do código), e
  as peças reaproveitadas viram componentes únicos (`Address`, `PaginationMeta`, `CompanyOdsScore`,
  `ScoreContribution`, `CompanyEvidence`). Antes havia um componente só, `__schema0`, e todo o resto
  era repetido inline (o perfil completo, duas vezes, com 8,6 KB cada).
- **`ErrorResponse` único.** Toda resposta de erro declarada (401, 404, 422, 429, 503…) referencia o
  mesmo componente, que o interceptor de erros do front tipa uma vez.
- **`JsonValue`.** O JSON livre das evidências (`details`) é um tipo recursivo com nome, escrito à mão
  em `json-value.dto.ts`: o `z.json()` do Zod é recursivo sem nome e ganhava o nome automático `__schema0`.
- **`operationId` explícito e estável.** Cada `@ApiOperation` declara o seu (`getCompanyProfile`,
  `searchCompanies`, `exportCompaniesXlsx`, `refreshSession`…), que vira o nome do método no cliente
  gerado. Antes o nome derivava da classe do controller, e renomeá-la (como na #81) mudava o método do
  cliente em silêncio. Os ids (31 operações) são únicos, e o teste do documento tem a lista completa: uma
  rota nova precisa entrar nela.
- **`servers` e versão.** A URL base vem de `API_BASE_URL` (opcional, sem barra no fim; sem ela, a
  relativa `/`), e a versão é a do `package.json`.
- **O arquivo XLSX** é declarado como binário (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
  só na resposta de sucesso; as de erro seguem JSON (`ErrorResponse`).

**CORS (front em outra origem).** `CORS_ORIGINS` diz quais origens podem chamar a API: `*` (padrão) aceita
qualquer uma, e uma lista separada por vírgulas (ex.: `http://localhost:4200`) restringe a ela. A API não usa
cookie (os tokens vão no corpo e no `Authorization`), então não há `credentials`. Os cabeçalhos
`Content-Disposition` (nome do arquivo XLSX) e `Retry-After` (prazo depois de um 429) são expostos
(`cors.config.ts`): sem isso, o navegador os esconderia do JavaScript do front. O teste
`test/integration/cors.e2e-spec.ts` confere no adaptador HTTP real.

**Como o front gera o cliente.** O CI publica o documento como o artefato `openapi`
(`openapi/openapi.json`, com `servers: [{ url: "/" }]`, para quem gera informar a base em tempo de
execução). Localmente, `OPENAPI_EXPORT_PATH=openapi/openapi.json npx vitest run --config ./vitest.config.e2e.ts
test/database/openapi-document.e2e-spec.ts` grava o mesmo arquivo. Conferido com `openapi-typescript`
(7.13): o documento gera os tipos (`components["schemas"]["CompanyFullProfileResponse"]`,
`operations["searchCompanies"]`), e um consumidor em TypeScript estrito compila.

**Como dar nome a um schema novo.** Acrescente `.meta({ id: 'NomeDoModelo' })` ao fim do schema exposto
(depois do `.describe`). O nome precisa ser único no projeto: dois schemas diferentes com o mesmo `id`
viram o mesmo componente. O teste `openapi-document.e2e-spec.ts` reprova resposta ou corpo inline, erro
sem `ErrorResponse`, `__schemaN`, `$ref` sem componente, componente sem uso e `operationId` ausente,
repetido ou derivado do nome da classe.

---

[Índice da documentação](README.md) · ← [02. Arquitetura e convenções](02-Arquitetura.md) · [04. Banco de dados e carga inicial](04-Banco-de-Dados.md) →
