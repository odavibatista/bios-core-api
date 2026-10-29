# 06. Authentication and accounts

🇧🇷 [Português](../06-Autenticação-e-Contas.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [05. Queues (BullMQ)](05-Queues.md) · [07. Security](07-Security.md) →

> Sessions, renewal, authentication guard, password, account maintenance and the domain blocklist.

**On this page**

- [Authentication and sessions](#authentication-and-sessions)
  - [Session renewal](#session-renewal)
  - [Authentication guard and ending sessions](#authentication-guard-and-ending-sessions)
  - [Password change and recovery](#password-change-and-recovery)
  - [Maintaining your own account](#maintaining-your-own-account)
- [Domain blocklist managed by the administrator (UC13, RF29, #86)](#domain-blocklist-managed-by-the-administrator-uc13-rf29-86)

## Authentication and sessions

Login (`POST /auth/login`, UC02) checks the password, records the attempt and opens a session: a
short-lived **JWT access token** and a single-use opaque **refresh token**.

| Variable | Content |
| --- | --- |
| `AUTH_ACCESS_TOKEN_SECRET` | 32-byte secret (base64 or hexadecimal) that signs the access token with HMAC-SHA256 |
| `AUTH_ACCESS_TOKEN_LIFETIME` | Access token lifetime (1m to 60m, default `15m`) |
| `AUTH_REFRESH_TOKEN_LIFETIME` | Refresh token lifetime (minimum 1h, default `7d`) |

- **The token only identifies the session.** It carries `sub` (user), `sid` (session link), `role` and
  the issuer, with no personal data. The server decides whether the session is valid, comparing the
  `sid` with the link in the database, which makes revocation take effect immediately. Changing
  `AUTH_ACCESS_TOKEN_SECRET` invalidates the access tokens in circulation, but not the sessions, which
  remain renewable.
- **Algorithm pinned on verification.** Only `HS256` is accepted, and the issuer is required:
  `alg: none` and algorithm switching do not get through.
- **Refresh token.** It is 256 random bits; only the SHA-256 digest goes to the database
  (`user_sessions`). Each login opens its own rotation family, one device per family.
- **Same response for a nonexistent email and a wrong password**, including timing: without an
  account, the password is checked against a throwaway hash. Whoever gets the password of an
  unconfirmed account right receives `ACCOUNT_NOT_CONFIRMED` (403) and can request a new link.
- **Lockout after attempts (RF20, NFSE06).** Five wrong passwords in a row block the **IP** and/or the
  **account** for 15 minutes; whichever target reaches the limit first is blocked, and the account
  holder receives the suspicious login alert. A correct login resets the count, and so does a block:
  the failures that caused it do not count again. While it lasts, not even the right password gets in
  (`429`, `ACCESS_TEMPORARILY_BLOCKED`, with `retry_after_seconds`). Attempts refused because of a block
  or an unconfirmed account do not count as password errors. Every attempt is stored in
  `login_attempts` (RF19).
- **Known limitation.** Account lockout only exists for a registered email; five failures from
  different IPs reveal that the account exists. The IP lockout, which also applies to unknown emails,
  restricts that test to someone who controls many addresses.

### Session renewal

`POST /auth/refresh` exchanges a valid refresh token for a new pair of tokens (UC17, RF32).

- **Single-use, atomic rotation.** The exchange revokes the current link as `ROTATED` and creates the
  next one in the same family, in one transaction, only if the link is still active and within its
  validity. The old link keeps `replaced_by_session_id` and stays until retention expires, so that
  reuse remains detectable. The new access token carries the user's current role.
- **Reuse is a sign of a leak.** Presenting an already rotated token again revokes **all** of the
  user's active sessions (`REUSE_DETECTED`, every device) and warns the holder by email. Losing the race
  for the same token to another simultaneous request gets the same treatment (flow 4.1): MongoDB aborts
  the transaction of whoever arrives later (`P2034`), and the repository turns that into "link already
  consumed".
- **No cascade when there is no sign of theft.** An unknown, expired token, or one revoked for another
  reason (logout, password change) is simply refused.
- **A single response for every refusal** (`401 SESSION_INVALID`), without revealing whether the token
  is unknown, expired, revoked or reused.

### Authentication guard and ending sessions

Every route requires a session, except those marked with `@Public()` (UC03, NFSE05).

- **Protected by default.** `AccessTokenGuard` is global: a new route is born private, and whatever
  must be reachable without a session — sign-up, confirmation, login, renewal, health check — declares
  itself with `@Public()` (method or controller). Forgetting the decorator on a public route makes it
  unreachable, which shows up in the first test; the opposite would leave a private route open without
  anyone noticing. In the handlers, `@CurrentUser()` provides the authenticated user (`userId`,
  `sessionId`, `familyId`, `role`).
- **The token is checked against the session on every request.** Besides the signature and the expiry,
  the guard looks up the link (`sid`): it has to exist, be active, be within the refresh token's
  validity and belong to the user the token claims. That is what gives immediate effect to logout,
  reuse detection and password changes, without a list of revoked tokens. A failure to query the
  database **never lets** the request through.
- **Same response for every refusal** (`401 NOT_AUTHENTICATED`): missing, malformed, tampered or expired
  token, or one from an ended session.
- **Role per route (`@Roles()`, #86).** `RoleGuard`, also global and registered right after the
  authentication guard, applies the `@Roles(UserRole.ADMIN)` of the method or the controller (the
  method's prevails). It reads the role carried by the access token; promotion and demotion end the
  account's sessions, so the token never carries an old role. Without a session it is still `401`; a
  session with another role gets `403 INSUFFICIENT_ROLE`. A route with `@Roles()` and no authenticated
  user (mistakenly also `@Public()`) responds `401`: the guard fails closed. A route without `@Roles()`
  has no role restriction.
- **Rate limit before authentication.** The rate-limiting guard runs first, so requests with a fake
  token get 429 without reaching the database.
- **`POST /auth/logout`** ends the current device: it revokes the session's rotation family as
  `LOGOUT`, which invalidates the access token and the refresh token together, and does not touch the
  sessions of other devices. **`POST /auth/logout-all`** revokes all of the user's active sessions as
  `LOGOUT_ALL_DEVICES`. Both respond `204`.

### Password change and recovery

Three endpoints cover UC04 (RF24, RF25). The new password follows the sign-up policy (8 to 128
characters, with a letter and a number) in both flows.

| Endpoint | Access | What it does |
| --- | --- | --- |
| `POST /auth/change-password` | session | Requires the current password and changes it; responds `204` |
| `POST /auth/forgot-password` | public | Sends the recovery link by email; responds `202` |
| `POST /auth/reset-password` | public | Sets the new password with the link's token; responds `204` |

- **Change.** The current password must match (`422 INVALID_CURRENT_PASSWORD`) and the new one must be
  different from it (`422 PASSWORD_UNCHANGED`). The current password is what stops a computer left
  logged in, or a stolen access token, from handing over the account.
- **Recovery.** The link uses the single-use token and is valid for
  `AUTH_PASSWORD_RESET_TOKEN_LIFETIME` (default `2h`); requesting another one invalidates the previous
  one. The response to the request is the same for any email, and **only an active account receives a
  link**: an unconfirmed account has to confirm its email (UC01), and recovery would bypass that. The
  token is spent before the password is saved, but only after the new password passes validation, so a
  weak password does not burn the link.
- **Every session drops.** Change and reset revoke the user's active sessions on every device
  (`PASSWORD_CHANGE` / `PASSWORD_RESET`), including the one that made the request. The password is
  saved **before** the sessions are revoked: in the reverse order, someone who still knew the old
  password could open a new session in between and it would survive.
- **Encryption key rotation.** The user document records **one** key version for email, address and
  password. If the active key is newer than the document's, the change re-encrypts the email and the
  address in the same write; saving only the password would leave the email unreadable. There is a
  test against the real MongoDB, with keys v1 and v2.
- **Known limitation.** The recovery request does not equalize the response time between an existing
  and a nonexistent email (the difference is one write and one enqueue). The response, on the other
  hand, is identical.

### Maintaining your own account

UC05 (RF26, RF27) covers reading, editing, changing the email and deleting. Every route requires a
session, except the confirmation of the email change.

| Endpoint | Access | What it does |
| --- | --- | --- |
| `GET /accounts/me` | session | Returns name, email, address and role, decrypted only in this response |
| `PATCH /accounts/me` | session | Edits the name and/or the address (`address: null` removes it); at least one field |
| `POST /accounts/me/email-change` | session | Requests the email change; requires the current password; responds `202` |
| `POST /accounts/confirm-email-change` | public | Applies the change with the link's token; responds `200` |
| `DELETE /accounts/me` | session | Deletes the account, confirmed with the password in the body; responds `204` |

- **Address.** Postal code (CEP), street, number, complement (optional), neighborhood, city and state
  (UF). It is serialized as JSON and encrypted; the CEP is stored with digits only.
- **Email change.** The link goes to the **new** address (`EMAIL_CHANGE_CONFIRMATION` template), and
  the current email remains valid until it is opened. It requires the current password, because the
  email is the account's recovery channel (an addition to UC05: without it, a stolen session would be
  enough to take the account over). Blocklisted domains are refused. **If the new email already
  belongs to another account, the response is the same as on success and nothing is sent**; only the
  account's own email is refused (`EMAIL_UNCHANGED`). If the address becomes another account's while
  the link was waiting, the confirmation responds `409 EMAIL_ALREADY_IN_USE`. Open sessions remain
  valid.
- **Key version in the token.** The change token stores the new encrypted email as
  `<version>:<ciphertext>`: the link is valid for hours, and a key rotation in that interval must not
  leave the email undecryptable.
- **Key consistency.** Address editing, email change and password change all go through
  `UpdateAccountUseCase`, which re-encrypts the other fields when the active key is newer than the
  document's. There is an e2e test against the real MongoDB with keys v1 and v2.
- **Deletion (LGPD).** Removes the account and, through Prisma's cascade, sessions, tokens, API keys
  and blocks; login attempts keep IP and date/time, with no link to the holder (`user_id` cleared); the
  records of emails sent to them (which store the recipient's hash) are **deleted**. There is no soft
  delete. The access token used stops working on the next request, because the session is gone.

## Domain blocklist managed by the administrator (UC13, RF29, #86)

Exclusive to `ADMIN` (`[P12]`, `@Roles(UserRole.ADMIN)` on the controller): without a session, `401`;
a `USER` session, `403 INSUFFICIENT_ROLE`; an API key does not authenticate here.

| Route | What it does |
| --- | --- |
| `GET /admin/blocked-email-domains?page=&page_size=` | Page of the currently blocked domains, in alphabetical order (default 20, maximum 100), with `origin` `SEED` (initial load) or `ADMIN` |
| `POST /admin/blocked-email-domains` `{ "domain": "mailinator.com" }` | Validates the format (domain only, no `@`), stores it in lowercase with `origin=ADMIN` and the responsible administrator (`created_by_user_id`, not exposed); `201` |
| `DELETE /admin/blocked-email-domains/:id` | Soft delete (`deleted_at`); `204` |

- **Immediate effect, no deploy.** Sign-up and email change query the database every time
  (`CheckEmailDomainAllowedUseCase`, no cache): the next request already uses the new list.
- **Existing accounts are not affected** (rule 3): the blocklist is only checked when signing up or
  changing the email, and an account on a newly blocked domain keeps logging in.
- **Re-adding restores.** A removed domain comes back in the same record (no duplicate), on behalf of
  the administrator who re-added it (`origin=ADMIN`, even if it came from the initial load). The date
  shown is that of the first inclusion.
- **Errors (flow 4.1):** invalid domain, `422`; already blocked, `409
  BLOCKED_EMAIL_DOMAIN_ALREADY_EXISTS` (simultaneous inclusions of the same domain: one writes, the
  others get `409`); nonexistent, malformed or already removed identifier, `404
  BLOCKED_EMAIL_DOMAIN_NOT_FOUND`.
- **No interface in the MVP for deciding who is an administrator:** promotion is done through
  `account:promote`
  ([Initial load of a new database and first administrator](04-Database.md#initial-load-of-a-new-database-and-first-administrator-329)).

---

[Documentation index](README.md) · ← [05. Queues (BullMQ)](05-Queues.md) · [07. Security](07-Security.md) →
