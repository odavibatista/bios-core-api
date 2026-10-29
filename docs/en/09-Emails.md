# 09. Transactional emails

🇧🇷 [Português](../09-E-mails.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [08. Query cache](08-Cache.md) · [10. External sources (adapters)](10-External-Sources.md) →

> Templates, sending through the queue and auditing of every dispatch.

Sign-up confirmation, email change, password recovery and the suspicious access alert (RF18). The
business flows call `SendTransactionalEmailUseCase`, which **renders and enqueues**; the sending is done
by `EmailDispatchProcessor`, the consumer of the `email-dispatch` queue hosted in this API.

```ts
const dispatchLogId = await sendTransactionalEmail.execute({
  template: EmailTemplate.EMAIL_CONFIRMATION,
  to: email,
  context: { name, token, validity: '2 horas' },
  userId,
});
```

The context is checked against the chosen template: asking for `SUSPICIOUS_LOGIN_ALERT` with the data
of a confirmation link does not compile.

| Template | Context | Link |
| --- | --- | --- |
| `EMAIL_CONFIRMATION` | name, token, validity | `/confirmar-email/<token>` |
| `EMAIL_CHANGE_CONFIRMATION` | name, token, validity | `/confirmar-novo-email/<token>` |
| `PASSWORD_RESET` | name, token, validity | `/redefinir-senha/<token>` |
| `SUSPICIOUS_LOGIN_ALERT` | name, IP, date/time | — (none) |

- **Versioned templates in `src/modules/mailing/templates/`**, in pt-BR: one HTML `.hbs` and one plain
  text `.hbs` per message, plus the shared frame (`layout.html.hbs`). The plain text is not decoration —
  it serves people who read email without HTML and improves delivery, because an HTML-only message is a
  spam signal for many filters. `nest build` copies the `.hbs` files to `dist/` (see `nest-cli.json`);
  without that, rendering would fail only in production.
- **Variables escaped** by Handlebars (`{{ }}`). The token goes in a **path segment**, not in a query
  parameter, because Handlebars escapes `=`: a `?token=abc` would show up as `?token&#x3D;abc` in the
  message source. The link's base is `FRONTEND_URL` — the front end's address, not the API's.
- **The suspicious access alert has no link or secret.** No token, no password and no clickable anchor:
  an intrusion alert is a classic phishing target, and a link there would train the user to click.
  There is a test that ensures this.
- **Rendering before enqueuing** is deliberate: the job carries the finished message, so changing a
  template does not alter the content of an email that was already in the queue, and the consumer does
  not need the templates to send.
- **An email failure does not bring down the originating flow.** Sign-up, login and password recovery
  complete even with SMTP down: the dispatch stays in the queue and is resent with backoff (5 attempts,
  see `queue.config.ts`).
- **Auditing in `email_dispatch_logs`.** The record is born `QUEUED` pointing to the job, becomes `SENT`
  with `sent_at` when the sending completes and `FAILED` with `failure_reason` **only on the last
  attempt** — a `FAILED` before that would be a lie, because there are still resends to come.
- **Recipient only as a hash.** The collection and the logs store `recipient_email_hash` (the email's
  blind index); the plaintext address exists only in the job payload, for the duration of the sending
  (INL02).
- **Single sender**, from `MAIL_FROM`: whoever triggers chooses recipient and content, never where the
  email comes from.
- **In development**, point `SMTP_HOST`/`SMTP_PORT` to a local capture server (Mailpit, for example),
  never to a real provider. The suites never open an SMTP connection: they use Nodemailer's own
  `jsonTransport` or a test double.

---

[Documentation index](README.md) · ← [08. Query cache](08-Cache.md) · [10. External sources (adapters)](10-External-Sources.md) →
