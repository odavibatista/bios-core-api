# 07. Segurança

🇧🇷 **Português** · 🇺🇸 [English](en/07-Security.md)

[Índice da documentação](README.md) · ← [06. Autenticação e contas](06-Autenticação-e-Contas.md) · [08. Cache de consultas](08-Cache.md) →

> Limite de requisições, criptografia de dados sensíveis e honeypot.

**Nesta página**

- [Limite de requisições](#limite-de-requisições)
- [Criptografia de dados sensíveis](#criptografia-de-dados-sensíveis)
  - [Senha](#senha)
- [Honeypot: rotas isca e bloqueio do IP (RF21, NFSE07, #87/#88)](#honeypot-rotas-isca-e-bloqueio-do-ip-rf21-nfse07-8788)

## Limite de requisições

`@nestjs/throttler` com guarda global e contadores no Redis (NFSE04) — em Redis porque o
limite é do consumidor, não da instância: um contador por processo dobraria o limite efetivo
com duas instâncias no ar.

| Limite | Janela e teto | Contado por |
| --- | --- | --- |
| `default` | `THROTTLE_TTL` / `THROTTLE_LIMIT` | endereço IP |
| `publicApi` | `THROTTLE_PUBLIC_API_TTL` / `THROTTLE_PUBLIC_API_LIMIT` | resumo da chave de API (`x-api-key`), com o IP como alternativa |
| `companyProfile` | `THROTTLE_TTL` / `THROTTLE_COMPANY_PROFILE_LIMIT` (60) | endereço IP |
| `companyEvidences` | `THROTTLE_TTL` / `THROTTLE_COMPANY_EVIDENCES_LIMIT` (20) | endereço IP |
| `companySearch` | `THROTTLE_TTL` / `THROTTLE_COMPANY_SEARCH_LIMIT` (60) | endereço IP |
| `companyExport` | `THROTTLE_TTL` / `THROTTLE_COMPANY_EXPORT_LIMIT` (10) | endereço IP |

- **Limite próprio das rotas de empresa (#335).** Nenhum teto vive no código das rotas: cada uma
  declara `@RouteRateLimit(ThrottlerName.X)` e o valor vem da variável de ambiente validada. O
  limite próprio **substitui** o geral na rota (o `default` é dispensado), como o antigo
  `@Throttle({ default: ... })` fazia, então um teto acima de `THROTTLE_LIMIT` vale de fato; a
  janela é a geral (`THROTTLE_TTL`). Cada limite só incide nas rotas que o declaram (`skipIf`).
  `SkipRateLimit` continua isentando de todos, porque deriva a lista de `ThrottlerName`.
- **Por que 60 no perfil.** A chamada em cache custa ~20 ms (seis chamadas medidas: 40 ms sem cache
  e 24, 19, 26, 23 e 18 ms com cache), e 20 por minuto, um perfil a cada 3 s, estrangulava quem
  compara fornecedores (429 já na 21ª chamada). Os 60 por minuto igualam o teto da API pública e
  ainda protegem o caminho que coleta, que é a minoria (o cache do perfil dura 5 minutos). O
  limite é por IP: vários usuários atrás do mesmo NAT dividem a cota, e o teto é a variável para
  quem precisar de mais.
- **Evidências ficam em 20** porque o NFSE04 (b) exige esse valor; só passou a vir da variável.
- **Pesquisa: 60 por minuto.** Antes não tinha limite próprio (valia só o geral, 120), apesar de a
  busca por nome varrer os perfis com expressão regular. Um valor abaixo do geral protege o banco
  e ainda deixa uma busca por segundo, acima do ritmo de quem digita com *debounce*.
- **Exportação: 10 por minuto**, o mesmo valor de antes, agora configurável e com requisito
  (NFSE04, e).

- **O `publicApi` só vale na API pública.** Incide apenas nos endpoints marcados com
  `@PublicApiRoute()` (que `@ApiKeyAuth()` já aplica); nos demais é dispensado (`skipIf`). Antes
  disso valia em todo endpoint e dividia 60 requisições por janela entre tudo o que saía do
  mesmo IP, login inclusive. Na API pública os dois limites somam: o `default` por IP e o
  `publicApi` por chave.
- **A chave não vai ao Redis.** O contador usa `key:` + os 32 primeiros caracteres do SHA-256
  da chave, nunca o segredo em claro. Cada valor inventado ganha o próprio contador (que expira
  com a janela), e o limite por IP impede que isso vire um jeito de encher o Redis.
- **429 padronizado.** Excedido o limite, a resposta é `RateLimitExceededException` no mesmo
  corpo `ErrorResponse` dos outros erros, com código estável `RATE_LIMIT_EXCEEDED` e o
  cabeçalho `Retry-After`. A biblioteca escreve os cabeçalhos dos limites que não são o
  `default` com o nome como sufixo (`Retry-After-publicApi`, `X-RateLimit-Limit-publicApi`); o
  guard acrescenta o `Retry-After` padrão, que é o que clientes HTTP respeitam. As respostas
  dentro do limite trazem `X-RateLimit-Limit`, `-Remaining` e `-Reset` (com o sufixo, no
  `publicApi`).
- **Janela fixa.** O prazo é definido na primeira requisição da janela (`PEXPIRE NX`) e não se
  renova a cada chamada; do contrário, quem mantivesse o ritmo nunca veria a janela expirar.
  Excedido o limite, uma chave de bloqueio responde pelas requisições seguintes até vencer.
- **Falha do Redis libera a requisição.** Contador indisponível não pode virar porta fechada —
  seria trocar um limite de taxa por indisponibilidade total. A falha é registrada como erro,
  porque nesse intervalo a proteção não está valendo.
- **Isenções com `@SkipRateLimit()`**, não com o `@SkipThrottle()` da biblioteca: sem
  argumento, ele ignora **apenas** o limite `default`, e o endpoint segue limitado pelos
  nomeados. O decorator do projeto é derivado da lista de limites declarados, então acompanha
  limites novos sem revisitar cada isenção. O `/health` é isento, porque é sondado de forma
  periódica e um 429 ali seria lido como indisponibilidade da API.
- **Limites mais estritos por endpoint** saem de `@Throttle({ default: { limit, ttl } })` no
  próprio controller — é o que os endpoints sensíveis de autenticação vão usar.

## Criptografia de dados sensíveis

E-mail, endereço e o hash da senha são cifrados antes de chegar ao banco (RNF NFSE03). O
contrato é `EncryptionProvider`, e a implementação usa **AES-256-GCM** com `node:crypto`
(`AesEncryptionProvider`).

| Variável | Conteúdo |
| --- | --- |
| `ENCRYPTION_KEYS` | Chaves AES versionadas: `1:<chave>,2:<chave>`, cada uma com 32 bytes em base64 ou hexadecimal |
| `BLIND_INDEX_KEY` | Chave única de 32 bytes do índice cego |

Gere as duas com `npm run keys:generate` e cole a saída no `.env` (o comando imprime também
`AUTH_ACCESS_TOKEN_SECRET`, descrita em [Autenticação e sessões](06-Autenticação-e-Contas.md#autenticação-e-sessões)).
Chave ausente, de tamanho errado ou com versão repetida impede a aplicação de subir.

- **IV por operação.** Cifrar o mesmo valor duas vezes produz textos diferentes, de modo que
  dois documentos com o mesmo e-mail não são identificáveis pelo conteúdo cifrado.
- **Integridade verificada.** O GCM é autenticado: texto adulterado, truncado ou cifrado com
  outra chave não decifra, e a exceção responde sempre a mesma mensagem genérica — o motivo
  técnico fica em `details`, para o log.
- **Rotação gradual.** A maior versão de `ENCRYPTION_KEYS` é a ativa, usada nas novas
  cifragens; as anteriores continuam disponíveis para ler documentos já gravados, que
  guardam a versão usada (`encryption_key_version`). Para rotacionar, acrescente a nova
  versão (`npm run keys:generate -- --version 2`) sem remover as antigas.
- **Índice cego.** `blindIndex` aplica HMAC-SHA256 sobre o valor normalizado (minúsculas, sem
  espaços nas bordas), permitindo localizar a conta pelo e-mail no login sem decifrar a
  coleção. Diferente da chave AES, `BLIND_INDEX_KEY` não é versionada: trocá-la invalidaria
  todos os índices já gravados.

### Senha

A senha nunca é guardada, nem de forma reversível: o contrato `PasswordProvider` só sabe
gerar o valor a persistir (`hash`) e conferir uma tentativa contra ele (`verify`). A
implementação (`BcryptPasswordProvider`) compõe três etapas:

```
senha → SHA-256 (base64) → bcrypt (BCRYPT_COST) → AES-256-GCM → banco
```

- **Pré-hash obrigatório.** O bcrypt ignora o que passa de 72 bytes. Sem tratamento, duas
  senhas longas que só diferem depois desse limite seriam aceitas uma pela outra — falha de
  autenticação, não detalhe teórico. O resumo SHA-256 em base64 tem 44 caracteres, sempre
  dentro do limite, e não contém o byte nulo que truncaria a entrada em implementações do
  bcrypt escritas em C.
- **Hash cifrado.** O bcrypt resiste à força bruta pelo custo; a cifragem acrescenta uma
  segunda barreira, porque a chave AES vive fora do banco. Um vazamento da coleção, sozinho,
  não permite nem testar senhas contra o hash. O valor persistido é um `EncryptedValue`, com
  a mesma versão de chave dos outros campos protegidos do documento.
- **Custo configurável.** `BCRYPT_COST` (4 a 31, padrão `12`) define o trabalho por
  verificação; cada incremento o dobra. Aumentá-lo **não** invalida as senhas já gravadas:
  o custo viaja no próprio hash e cada uma segue sendo verificada com o seu.
- **Erro de integridade não é senha errada.** `verify` devolve `false` só para senha
  incorreta; valor adulterado ou cifrado com versão de chave ausente estoura
  `EncryptionException`, para não transformar um problema de configuração em credencial
  inválida.

Alterar qualquer etapa da composição invalidaria todas as senhas gravadas e exigiria um
fluxo de reidratação no próximo login.

## Honeypot: rotas isca e bloqueio do IP (RF21, NFSE07, #87/#88)

Quem chama uma rota isca tem o acesso registrado e o IP **bloqueado sem prazo, em toda a API**.

- **Rotas isca** (módulo `honeypot`, isolado): `GET /v2/companies?page=&page_size=` e
  `GET /v2/companies/:cnpj`. Imitam uma versão nova da API pública que não existe (a real é
  `/v1/companies/:cnpj`, sem listagem), ficam fora do OpenAPI e da documentação e são públicas:
  só chega a elas quem varre caminhos.
  - **Dados sintéticos**, nunca reais: empresas geradas pelo Faker (pt-BR, instância própria) com
    CNPJ válido (`cnpjWithCheckDigits`), CNAE oficial, UF, município e índices; o mesmo CNPJ ou a
    mesma página devolvem sempre o mesmo conteúdo. Não leem banco, cache nem fontes.
  - **Baixo volume:** no máximo 10 por página; `page_size` maior é reduzido a 10.
  - **Baixa disponibilidade proposital:** `HONEYPOT_FAILURE_RATE` das chamadas (padrão 0,25)
    responde `503 COMPANY_DATA_UNAVAILABLE`, como a API real; as demais demoram até
    `HONEYPOT_MAX_DELAY_MS` (padrão 2 s). Só nas iscas.
- **`@Honeypot()`** (`security`): marca a rota como pública e isca e a tira do OpenAPI. Antes de a
  isca responder, grava `honeypot_hits` (IP, caminho sem a query, método, user-agent, data) e o
  bloqueio em `access_blocks` (`scope=IP`, `reason=HONEYPOT`, sem `blocked_until`), e espelha o IP
  no conjunto `bios:blocked-ips` do Redis. Falha no registro não muda a resposta da isca. Um teste
  impede o uso do decorator fora do módulo das iscas.
- **Recusa em toda rota** (`BlockedIpMiddleware`, global): o IP bloqueado recebe `403
  ACCESS_BLOCKED` em qualquer rota (real ou isca, pública ou não), antes do limite de requisições
  e da autenticação. A consulta é ao Redis; com o Redis fora, ao banco; se nenhum responder, a
  requisição segue (o honeypot não derruba as rotas reais, NFSE07). Na subida, o conjunto do Redis
  é recarregado dos bloqueios sem prazo do banco. O bloqueio temporário de login (RF20) continua
  valendo só no login.
- **IP do cliente atrás de proxy** (`TRUST_PROXY`): `false` (padrão, sem proxy), o número de
  proxies na frente da API ou a lista deles. **Em produção atrás de proxy, configure**: sem isto,
  todo acesso pareceria vir do proxy. `true` é recusado, porque deixaria o cliente escrever o
  próprio IP em `X-Forwarded-For` e fazer o honeypot bloquear o IP de outra pessoa; com o proxy
  declarado, entradas forjadas à esquerda do cabeçalho são ignoradas.
- **Isentos** (`HONEYPOT_EXEMPT_IPS`, IPs e faixas CIDR): nunca bloqueados (a chamada é registrada).
  O padrão cobre loopback e redes internas, onde ficam o proxy e o monitoramento: um proxy mal
  declarado não derruba a API inteira.

---

[Índice da documentação](README.md) · ← [06. Autenticação e contas](06-Autenticação-e-Contas.md) · [08. Cache de consultas](08-Cache.md) →
