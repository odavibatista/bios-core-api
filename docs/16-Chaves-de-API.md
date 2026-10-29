# 16. Chaves de API e API pública

[Índice da documentação](README.md) · ← [15. Empresas](15-Empresas.md) · [17. Testes](17-Testes.md) →

> Gestão das chaves pelo painel e a consulta de perfil por chave (UC11, UC12).

`POST /api-keys`, `GET /api-keys` e `DELETE /api-keys/:id` (UC11, RF16) deixam o usuário gerar,
listar e revogar as próprias chaves. Exigem sessão (JWT); a **autenticação por chave** nas
rotas públicas é o UC12, descrito mais abaixo.

- **Formato.** `bios_<id público de 8 caracteres>_<segredo de 256 bits em base64url>`. O
  prefixo (`bios_` + id público) é o que a listagem mostra e o que a busca por chave usará;
  o segredo vem do mesmo gerador criptográfico dos demais tokens opacos.
- **Exibição única.** O `POST` devolve a chave completa (`key`) uma só vez. O banco guarda
  apenas o SHA-256 da chave inteira (`key_hash`) e o prefixo; a listagem nunca traz a chave
  nem o resumo. Perdeu a chave: revoga e gera outra.
- **Teto.** Até 10 chaves ativas por usuário (`422 API_KEY_LIMIT_REACHED`, com `details.limit`);
  revogar libera a vaga. O id público tem 62⁸ possibilidades, e uma colisão (índice único em
  `key_prefix`) gera um novo id, com até 3 tentativas.
- **Revogação.** Definitiva e imediata, só pelo dono: a posse faz parte da própria escrita
  (`updateMany` filtrando `id_api_key` + `user_id` + não revogada), sem leitura prévia. Chave
  alheia, inexistente, malformada ou já revogada: o mesmo `404 API_KEY_NOT_FOUND`. O registro
  fica com `revoked_at` e some da listagem.

## API pública (consulta por chave)

`GET /v1/companies/:cnpj` (UC12, RF17) devolve o mesmo perfil da consulta do painel, para
sistemas de terceiros, autenticado pelo cabeçalho `x-api-key` em vez de uma sessão. O `v1`
reserva espaço para evoluir o contrato sem quebrar quem já integrou. Desde a #81 a resposta é o
perfil completo: cadastro, evidências e, por ODS, índice, confiança e explicação (ver [Perfil completo da empresa](15-Empresas.md#perfil-completo-da-empresa)).

- **`@ApiKeyAuth()`** é o que declara uma rota como API pública: reúne `@Public()` (dispensa a
  sessão), o `ApiKeyGuard`, `@PublicApiRoute()` (liga o limite por chave) e o esquema
  `api-key` no OpenAPI. Quem expõe um endpoint público importa `ApiKeysModule` e usa o
  decorator.
- **Não espera as fontes externas (#333).** Diferente do painel, a rota pública serve o que está
  guardado e válido, **publica** a atualização do que falta (CGU, GHG, IBAMA avulso e o recálculo
  dos índices) e responde sem esperar nenhum desses jobs, marcando o que ficou pendente em
  `provenance` (`origin = PENDING`, `scores_pending`, `retry_after_seconds`). Só o cadastro é
  aguardado, porque o perfil não existe sem ele. Antes, cada CNPJ novo segurava a conexão do
  integrador até o prazo da fila e empilhava as coletas atrás da resposta. Quem varre CNPJs
  recebe o cadastro e o que já estava guardado, e volta depois de `retry_after_seconds` para
  o restante.
- **Carga que uma varredura gera, e o que a limita.** Uma consulta de CNPJ novo publica **no máximo**
  um job de CGU, um de GHG, um avulso de IBAMA e um recálculo (mais o cadastral, se faltar), cada
  um deduplicado pelo identificador da janela; consulta repetida enquanto o marcador vale não
  publica de novo. O ritmo de entrada é o limite por chave (`THROTTLE_PUBLIC_API_LIMIT`, 60 por
  minuto), e a saída para as fontes externas continua sob o limite de cada fonte no catálogo
  (NFPD01), porque quem fala com elas é o consumidor da fila e não a requisição. O e2e
  `public-api-load.e2e-spec.ts` conta os jobs de uma rajada de CNPJs distintos.
- **O índice só vale quando é posterior à última coleta.** No modo sem espera, o índice lido do
  banco pode ter sido calculado antes de uma coleta que terminou depois; enquanto houver evidência
  mais nova que o cálculo, `scores_pending` é verdadeiro e o perfil não vai ao cache. O recálculo
  pedido ao fim de cada consulta fecha a lacuna, e a consulta seguinte já devolve o retrato atual.
  Um `UNKNOWN` gravado há menos de 2 minutos (`PENDING_REFRESH_WINDOW_MS`) é a marca de uma
  atualização em andamento (`PENDING`); depois disso passa a `UNAVAILABLE`.
- **Conferência.** O prefixo público (`bios_` + 8) localiza a chave pelo índice único; o SHA-256
  da chave inteira é comparado ao guardado em tempo constante. O resumo é calculado antes da
  busca, para a chave desconhecida não responder mais depressa que a de segredo errado.
- **`401 INVALID_API_KEY`, sempre igual.** Ausente, malformada, desconhecida, com segredo errado
  ou revogada recebem a mesma resposta (a revogação vale na chamada seguinte). Um erro do banco
  não vira 401: propaga como indisponibilidade.
- **Ordem dos guards.** O limite de requisições vem antes da conferência da chave: tentativas
  com chaves inventadas gastam cota e passam a tomar 429, em vez de martelar o banco.
- **Último uso (`last_used_at`).** Gravado na chamada autenticada, com precisão de **1 minuto**
  (`LAST_USED_PRECISION_MS`): dentro da janela a data não é regravada, o que evita transformar
  cada leitura da API em escrita; a condição é da própria escrita (`updateMany`), então chamadas
  simultâneas não gravam duas vezes. Falhar em registrar o uso não derruba uma chamada legítima.
- **Separação das credenciais.** A sessão (JWT) não vale na API pública, e a chave de API não vale
  nas rotas do painel, inclusive no gerenciamento das próprias chaves.

---

[Índice da documentação](README.md) · ← [15. Empresas](15-Empresas.md) · [17. Testes](17-Testes.md) →
