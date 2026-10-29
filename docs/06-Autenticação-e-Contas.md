# 06. Autenticação e contas

🇧🇷 **Português** · 🇺🇸 [English](en/06-Authentication-and-Accounts.md)

[Índice da documentação](README.md) · ← [05. Filas (BullMQ)](05-Filas.md) · [07. Segurança](07-Segurança.md) →

> Sessões, renovação, guard de autenticação, senha, manutenção da conta e blacklist de domínios.

**Nesta página**

- [Autenticação e sessões](#autenticação-e-sessões)
  - [Renovação de sessão](#renovação-de-sessão)
  - [Guard de autenticação e encerramento de sessão](#guard-de-autenticação-e-encerramento-de-sessão)
  - [Troca e recuperação de senha](#troca-e-recuperação-de-senha)
  - [Manutenção da própria conta](#manutenção-da-própria-conta)
- [Blacklist de domínios pelo administrador (UC13, RF29, #86)](#blacklist-de-domínios-pelo-administrador-uc13-rf29-86)

## Autenticação e sessões

O login (`POST /auth/login`, UC02) confere a senha, registra a tentativa e abre uma sessão: um
**access token JWT** de vida curta e um **refresh token** opaco de uso único.

| Variável | Conteúdo |
| --- | --- |
| `AUTH_ACCESS_TOKEN_SECRET` | Segredo de 32 bytes (base64 ou hexadecimal) que assina o access token com HMAC-SHA256 |
| `AUTH_ACCESS_TOKEN_LIFETIME` | Vida do access token (1m a 60m, padrão `15m`) |
| `AUTH_REFRESH_TOKEN_LIFETIME` | Vida do refresh token (mínimo 1h, padrão `7d`) |

- **O token só identifica a sessão.** Carrega `sub` (usuário), `sid` (elo da sessão), `role` e o
  emissor, sem dado pessoal. Quem decide se a sessão vale é o servidor, comparando o `sid` com
  o elo no banco, o que dá efeito imediato à revogação. Trocar `AUTH_ACCESS_TOKEN_SECRET`
  invalida os access tokens em circulação, mas não as sessões, que seguem renováveis.
- **Algoritmo fixado na verificação.** Só `HS256` é aceito, e o emissor é exigido: o
  `alg: none` e a troca de algoritmo não passam.
- **Refresh token.** São 256 bits aleatórios; só o resumo SHA-256 vai ao banco
  (`user_sessions`). Cada login abre uma família de rotação própria, um dispositivo por
  família.
- **Mesma resposta para e-mail inexistente e senha incorreta**, inclusive no tempo: sem conta,
  a senha é conferida contra um hash descartável. Quem acerta a senha de uma conta não
  confirmada recebe `ACCOUNT_NOT_CONFIRMED` (403) e pode pedir novo link.
- **Bloqueio por tentativas (RF20, NFSE06).** Cinco senhas incorretas seguidas bloqueiam o
  **IP** e/ou a **conta** por 15 minutos; o alvo que chega ao limite primeiro é bloqueado, e
  o titular da conta recebe o alerta de login suspeito. Um login correto zera a contagem, e
  um bloqueio também: as falhas que o causaram não contam de novo. Enquanto durar, nem a
  senha certa entra (`429`, `ACCESS_TEMPORARILY_BLOCKED`, com `retry_after_seconds`).
  Tentativas recusadas por bloqueio ou por conta não confirmada não contam como erro de
  senha. Toda tentativa fica em `login_attempts` (RF19).
- **Limite conhecido.** O bloqueio de conta só existe para e-mail cadastrado; cinco falhas
  vindas de IPs diferentes revelam que a conta existe. O bloqueio por IP, que vale também
  para e-mail desconhecido, restringe esse teste a quem controla muitos endereços.

### Renovação de sessão

`POST /auth/refresh` troca um refresh token válido por um novo par de tokens (UC17, RF32).

- **Rotação de uso único e atômica.** A troca revoga o elo atual como `ROTATED` e cria o
  seguinte na mesma família, numa transação, só se o elo ainda estiver ativo e dentro da
  validade. O elo antigo guarda `replaced_by_session_id` e permanece até a retenção expirar,
  para que o reuso continue detectável. O novo access token traz o papel vigente do usuário.
- **Reuso é indício de vazamento.** Reapresentar um token já rotacionado revoga **todas** as
  sessões ativas do usuário (`REUSE_DETECTED`, todos os dispositivos) e avisa o titular por
  e-mail. Perder a disputa pelo mesmo token contra outro pedido simultâneo recebe o mesmo
  tratamento (fluxo 4.1): o MongoDB aborta a transação de quem chega depois (`P2034`), e o
  repositório converte isso em "elo já consumido".
- **Sem cascata quando não há indício de roubo.** Token desconhecido, expirado ou revogado
  por outro motivo (logout, troca de senha) é só recusado.
- **Uma única resposta para toda recusa** (`401 SESSION_INVALID`), sem revelar se o token é
  desconhecido, expirado, revogado ou reutilizado.

### Guard de autenticação e encerramento de sessão

Toda rota exige sessão, exceto as marcadas com `@Public()` (UC03, NFSE05).

- **Protegido por padrão.** O `AccessTokenGuard` é global: uma rota nova nasce privada, e quem
  deve ser acessível sem sessão — cadastro, confirmação, login, renovação, health check — se
  declara com `@Public()` (método ou controller). Esquecer o decorator numa rota pública a
  deixa inacessível, o que aparece no primeiro teste; o inverso deixaria uma rota privada
  aberta sem ninguém perceber. Nos handlers, `@CurrentUser()` entrega o usuário autenticado
  (`userId`, `sessionId`, `familyId`, `role`).
- **O token é conferido contra a sessão a cada requisição.** Além da assinatura e do prazo,
  o guard consulta o elo (`sid`): ele precisa existir, estar ativo, dentro da validade do
  refresh token e ser do usuário que o token afirma. É isso que dá efeito imediato ao logout,
  à detecção de reuso e, adiante, à troca de senha, sem lista de tokens revogados. Falha ao
  consultar o banco **nunca libera** a requisição.
- **Mesma resposta para toda recusa** (`401 NOT_AUTHENTICATED`): token ausente, malformado,
  adulterado, expirado ou de sessão encerrada.
- **Papel por rota (`@Roles()`, #86).** O `RoleGuard`, também global e registrado logo depois do de
  autenticação, aplica o `@Roles(UserRole.ADMIN)` do método ou do controller (o do método prevalece).
  Lê o papel que o access token traz; a promoção e o rebaixamento encerram as sessões da conta, então
  o token não carrega papel antigo. Sem sessão continua `401`; sessão de outro papel recebe
  `403 INSUFFICIENT_ROLE`. Rota com `@Roles()` sem usuário autenticado (por engano, também `@Public()`)
  responde `401`: o guard fecha por padrão. Rota sem `@Roles()` não tem restrição de papel.
- **Limite antes da autenticação.** O guard de limite de requisições roda primeiro, então
  requisições com token falso tomam 429 sem chegar ao banco.
- **`POST /auth/logout`** encerra o dispositivo atual: revoga a família de rotação da sessão
  como `LOGOUT`, o que invalida o access token e o refresh token juntos, e não toca nas
  sessões dos outros dispositivos. **`POST /auth/logout-all`** revoga todas as sessões
  ativas do usuário como `LOGOUT_ALL_DEVICES`. Ambos respondem `204`.

### Troca e recuperação de senha

Três endpoints cobrem o UC04 (RF24, RF25). A nova senha segue a política do cadastro (8 a 128
caracteres, com letra e número) nos dois fluxos.

| Endpoint | Acesso | O que faz |
| --- | --- | --- |
| `POST /auth/change-password` | sessão | Exige a senha atual e troca a senha; responde `204` |
| `POST /auth/forgot-password` | público | Envia o link de recuperação por e-mail; responde `202` |
| `POST /auth/reset-password` | público | Define a senha nova com o token do link; responde `204` |

- **Troca.** A senha atual precisa conferir (`422 INVALID_CURRENT_PASSWORD`) e a nova precisa
  ser diferente dela (`422 PASSWORD_UNCHANGED`). É a senha atual que impede um computador
  deixado logado, ou um access token roubado, de entregar a conta.
- **Recuperação.** O link usa o token de uso único e vale `AUTH_PASSWORD_RESET_TOKEN_LIFETIME`
  (padrão `2h`); pedir outro invalida o anterior. A resposta ao pedido é a mesma para qualquer
  e-mail, e **só conta ativa recebe link**: a conta não confirmada precisa confirmar o e-mail
  (UC01), e a recuperação a contornaria. O token é gasto antes de a senha ser gravada, mas só
  depois de a senha nova passar na validação, então uma senha fraca não queima o link.
- **Todas as sessões caem.** Troca e redefinição revogam as sessões ativas do usuário em todos
  os dispositivos (`PASSWORD_CHANGE` / `PASSWORD_RESET`), inclusive a que fez o pedido. A senha
  é gravada **antes** de as sessões serem revogadas: na ordem inversa, quem ainda soubesse a
  senha antiga abriria uma sessão nova no intervalo e ela sobreviveria.
- **Rotação de chave de cifragem.** O documento do usuário registra **uma** versão de chave
  para e-mail, endereço e senha. Se a chave ativa é mais nova que a do documento, a troca
  recifra o e-mail e o endereço na mesma gravação; gravar só a senha deixaria o e-mail
  ilegível. Há teste contra o MongoDB real, com chaves v1 e v2.
- **Limite conhecido.** O pedido de recuperação não iguala o tempo de resposta entre e-mail
  existente e inexistente (a diferença é uma gravação e um enfileiramento). A resposta, por
  outro lado, é idêntica.

### Manutenção da própria conta

O UC05 (RF26, RF27) cobre a leitura, a edição, a troca de e-mail e a exclusão. Todas as rotas
exigem sessão, exceto a confirmação da troca de e-mail.

| Endpoint | Acesso | O que faz |
| --- | --- | --- |
| `GET /accounts/me` | sessão | Devolve nome, e-mail, endereço e papel, decifrados só nesta resposta |
| `PATCH /accounts/me` | sessão | Edita o nome e/ou o endereço (`address: null` remove); ao menos um campo |
| `POST /accounts/me/email-change` | sessão | Pede a troca de e-mail; exige a senha atual; responde `202` |
| `POST /accounts/confirm-email-change` | público | Efetiva a troca com o token do link; responde `200` |
| `DELETE /accounts/me` | sessão | Exclui a conta, confirmada com a senha no corpo; responde `204` |

- **Endereço.** CEP, logradouro, número, complemento (opcional), bairro, cidade e UF. É
  serializado em JSON e cifrado; o CEP é guardado só com os dígitos.
- **Troca de e-mail.** O link vai ao **novo** endereço (template `EMAIL_CHANGE_CONFIRMATION`),
  e o e-mail atual vale até ele ser aberto. Exige a senha atual, porque o e-mail é o canal de
  recuperação da conta (um acréscimo ao UC05: sem isso, uma sessão roubada bastaria para
  tomá-la). Domínios da blacklist são recusados. **Se o novo e-mail já é de outra conta, a
  resposta é a mesma do sucesso e nada é enviado**; só o e-mail da própria conta é recusado
  (`EMAIL_UNCHANGED`). Se o endereço passar a ser de outra conta enquanto o link esperava, a
  confirmação responde `409 EMAIL_ALREADY_IN_USE`. As sessões abertas continuam valendo.
- **Versão da chave no token.** O token de troca guarda o novo e-mail cifrado como
  `<versão>:<texto cifrado>`: o link vale por horas, e uma rotação de chave nesse intervalo não
  pode deixar o e-mail indecifrável.
- **Coerência da chave.** Edição de endereço, troca de e-mail e troca de senha passam todas
  pelo `UpdateAccountUseCase`, que recifra os demais campos quando a chave ativa é mais nova
  que a do documento. Há e2e contra o MongoDB real com chaves v1 e v2.
- **Exclusão (LGPD).** Remove a conta e, por cascata do Prisma, sessões, tokens, chaves de API
  e bloqueios; as tentativas de login ficam com IP e data/hora, sem vínculo com o titular
  (`user_id` anulado); os registros de e-mails enviados a ele (que guardam o hash do
  destinatário) são **apagados**. Não há remoção lógica. O access token usado deixa de valer
  na requisição seguinte, porque a sessão sumiu.

## Blacklist de domínios pelo administrador (UC13, RF29, #86)

Exclusivo de `ADMIN` (`[P12]`, `@Roles(UserRole.ADMIN)` no controller): sem sessão, `401`; sessão
de `USER`, `403 INSUFFICIENT_ROLE`; chave de API não autentica aqui.

| Rota | O que faz |
| --- | --- |
| `GET /admin/blocked-email-domains?page=&page_size=` | Página dos domínios bloqueados agora, em ordem alfabética (padrão 20, máximo 100), com `origin` `SEED` (carga inicial) ou `ADMIN` |
| `POST /admin/blocked-email-domains` `{ "domain": "mailinator.com" }` | Valida o formato (só o domínio, sem `@`), grava em minúsculas com `origin=ADMIN` e o administrador responsável (`created_by_user_id`, não exposto); `201` |
| `DELETE /admin/blocked-email-domains/:id` | Remoção lógica (`deleted_at`); `204` |

- **Efeito imediato, sem deploy.** O cadastro e a troca de e-mail consultam o banco a cada vez
  (`CheckEmailDomainAllowedUseCase`, sem cache): a requisição seguinte já usa a lista nova.
- **Contas existentes não são afetadas** (regra 3): a blacklist só é consultada ao cadastrar ou
  trocar e-mail, e uma conta do domínio recém-bloqueado continua entrando.
- **Reincluir restaura.** Um domínio removido volta no mesmo registro (sem duplicar), em nome do
  administrador que o reincluiu (`origin=ADMIN`, mesmo que tenha vindo da carga inicial). A data
  exibida é a da primeira inclusão.
- **Erros (fluxo 4.1):** domínio inválido, `422`; já bloqueado, `409
  BLOCKED_EMAIL_DOMAIN_ALREADY_EXISTS` (inclusões simultâneas do mesmo domínio: uma grava, as outras
  recebem `409`); identificador inexistente, malformado ou já removido, `404
  BLOCKED_EMAIL_DOMAIN_NOT_FOUND`.
- **Sem interface no MVP para quem é administrador:** a promoção é pelo `account:promote`
  ([Carga inicial de um banco novo e primeiro administrador](04-Banco-de-Dados.md#carga-inicial-de-um-banco-novo-e-primeiro-administrador-329)).

---

[Índice da documentação](README.md) · ← [05. Filas (BullMQ)](05-Filas.md) · [07. Segurança](07-Segurança.md) →
