# 09. E-mails transacionais

[Índice da documentação](README.md) · ← [08. Cache de consultas](08-Cache.md) · [10. Fontes externas (adapters)](10-Fontes-Externas.md) →

> Templates, envio pela fila e auditoria de cada disparo.

Confirmação de cadastro, troca de e-mail, recuperação de senha e alerta de acesso suspeito
(RF18). Os fluxos de negócio chamam `SendTransactionalEmailUseCase`, que **renderiza e
enfileira**; quem envia é o `EmailDispatchProcessor`, consumidor da fila `email-dispatch`
hospedado nesta API.

```ts
const dispatchLogId = await sendTransactionalEmail.execute({
  template: EmailTemplate.EMAIL_CONFIRMATION,
  to: email,
  context: { name, token, validity: '2 horas' },
  userId,
});
```

O contexto é verificado contra o template escolhido: pedir `SUSPICIOUS_LOGIN_ALERT` com os
dados de um link de confirmação não compila.

| Template | Contexto | Link |
| --- | --- | --- |
| `EMAIL_CONFIRMATION` | nome, token, validade | `/confirmar-email/<token>` |
| `EMAIL_CHANGE_CONFIRMATION` | nome, token, validade | `/confirmar-novo-email/<token>` |
| `PASSWORD_RESET` | nome, token, validade | `/redefinir-senha/<token>` |
| `SUSPICIOUS_LOGIN_ALERT` | nome, IP, data/hora | — (nenhum) |

- **Templates versionados em `src/modules/mailing/templates/`**, em pt-BR: um `.hbs` de HTML e
  um de texto simples por mensagem, mais a moldura comum (`layout.html.hbs`). O texto simples
  não é enfeite — atende quem lê e-mail sem HTML e melhora a entrega, porque mensagem só-HTML
  é sinal de spam para boa parte dos filtros. O `nest build` copia os `.hbs` para `dist/`
  (ver `nest-cli.json`); sem isso a renderização falharia só em produção.
- **Variáveis escapadas** pelo Handlebars (`{{ }}`). O token vai em **segmento de caminho**, e
  não em parâmetro de consulta, porque o Handlebars escapa `=`: um `?token=abc` apareceria
  como `?token&#x3D;abc` no código-fonte da mensagem. A base do link é `FRONTEND_URL` — o
  endereço do front-end, não o da API.
- **O alerta de acesso suspeito não tem link nem segredo.** Nenhum token, nenhuma senha e
  nenhuma âncora clicável: alerta de invasão é alvo clássico de phishing, e um link ali
  treinaria o usuário a clicar. Há teste que garante isso.
- **Renderizar antes de enfileirar** é deliberado: o job carrega a mensagem pronta, então
  mudar um template não altera o conteúdo de um e-mail que já estava na fila, e o consumidor
  não precisa dos templates para enviar.
- **Falha de e-mail não derruba o fluxo de origem.** O cadastro, o login e a recuperação de
  senha concluem mesmo com o SMTP fora do ar: o disparo fica na fila e é reenviado com
  backoff (5 tentativas, ver `queue.config.ts`).
- **Auditoria em `email_dispatch_logs`.** O registro nasce `QUEUED` apontando para o job, vira
  `SENT` com `sent_at` quando o envio conclui e `FAILED` com `failure_reason` **só na última
  tentativa** — um `FAILED` antes disso mentiria, porque ainda há reenvio por vir.
- **Destinatário só em hash.** A coleção e os logs guardam `recipient_email_hash` (índice cego
  do e-mail); o endereço em claro existe apenas na carga do job, pelo tempo do envio (INL02).
- **Remetente único**, de `MAIL_FROM`: quem dispara escolhe destinatário e conteúdo, nunca de
  onde o e-mail parte.
- **Em desenvolvimento**, aponte `SMTP_HOST`/`SMTP_PORT` para um servidor local de captura
  (Mailpit, por exemplo), nunca para um provedor real. As suítes nunca abrem conexão SMTP:
  usam o `jsonTransport` do próprio Nodemailer ou um dublê.

---

[Índice da documentação](README.md) · ← [08. Cache de consultas](08-Cache.md) · [10. Fontes externas (adapters)](10-Fontes-Externas.md) →
