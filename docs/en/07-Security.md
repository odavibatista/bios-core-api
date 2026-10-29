# 07. Security

🇧🇷 [Português](../07-Segurança.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [06. Authentication and accounts](06-Authentication-and-Accounts.md) · [08. Query cache](08-Cache.md) →

> Rate limiting, encryption of sensitive data and the honeypot.

**On this page**

- [Rate limiting](#rate-limiting)
- [Encryption of sensitive data](#encryption-of-sensitive-data)
  - [Password](#password)
- [Honeypot: decoy routes and IP blocking (RF21, NFSE07, #87/#88)](#honeypot-decoy-routes-and-ip-blocking-rf21-nfse07-8788)

## Rate limiting

`@nestjs/throttler` with a global guard and counters in Redis (NFSE04) — in Redis because the limit
belongs to the consumer, not to the instance: one counter per process would double the effective limit
with two instances running.

| Limit | Window and ceiling | Counted by |
| --- | --- | --- |
| `default` | `THROTTLE_TTL` / `THROTTLE_LIMIT` | IP address |
| `publicApi` | `THROTTLE_PUBLIC_API_TTL` / `THROTTLE_PUBLIC_API_LIMIT` | digest of the API key (`x-api-key`), with the IP as a fallback |
| `companyProfile` | `THROTTLE_TTL` / `THROTTLE_COMPANY_PROFILE_LIMIT` (60) | IP address |
| `companyEvidences` | `THROTTLE_TTL` / `THROTTLE_COMPANY_EVIDENCES_LIMIT` (20) | IP address |
| `companySearch` | `THROTTLE_TTL` / `THROTTLE_COMPANY_SEARCH_LIMIT` (60) | IP address |
| `companyExport` | `THROTTLE_TTL` / `THROTTLE_COMPANY_EXPORT_LIMIT` (10) | IP address |

- **Company routes have their own limit (#335).** No ceiling lives in the route code: each one declares
  `@RouteRateLimit(ThrottlerName.X)` and the value comes from the validated environment variable. The
  route's own limit **replaces** the general one on that route (`default` is skipped), as the old
  `@Throttle({ default: ... })` did, so a ceiling above `THROTTLE_LIMIT` actually applies; the window is
  the general one (`THROTTLE_TTL`). Each limit only applies to the routes that declare it (`skipIf`).
  `SkipRateLimit` still exempts from all of them, because it derives the list from `ThrottlerName`.
- **Why 60 for the profile.** A cached call costs ~20 ms (six measured calls: 40 ms without cache and
  24, 19, 26, 23 and 18 ms with cache), and 20 per minute, one profile every 3 s, choked anyone
  comparing suppliers (429 already on the 21st call). 60 per minute matches the public API's ceiling
  and still protects the path that collects data, which is the minority (the profile cache lasts 5
  minutes). The limit is per IP: several users behind the same NAT share the quota, and the ceiling is
  the variable for whoever needs more.
- **Evidence stays at 20** because NFSE04 (b) requires that value; it only started coming from the
  variable.
- **Search: 60 per minute.** It used to have no limit of its own (only the general one, 120, applied),
  even though the name search scans the profiles with a regular expression. A value below the general
  one protects the database and still allows one search per second, faster than someone typing with
  *debounce*.
- **Export: 10 per minute**, the same value as before, now configurable and backed by a requirement
  (NFSE04, e).

- **`publicApi` only applies to the public API.** It applies only to endpoints marked with
  `@PublicApiRoute()` (which `@ApiKeyAuth()` already applies); on the others it is skipped (`skipIf`).
  Before that, it applied to every endpoint and split 60 requests per window across everything coming
  from the same IP, login included. On the public API both limits add up: `default` per IP and
  `publicApi` per key.
- **The key does not go to Redis.** The counter uses `key:` + the first 32 characters of the key's
  SHA-256, never the plaintext secret. Each made-up value gets its own counter (which expires with the
  window), and the per-IP limit keeps that from becoming a way to fill Redis up.
- **Standard 429.** When the limit is exceeded, the response is `RateLimitExceededException` in the same
  `ErrorResponse` body as other errors, with the stable code `RATE_LIMIT_EXCEEDED` and the
  `Retry-After` header. The library writes the headers of limits other than `default` with the name as
  a suffix (`Retry-After-publicApi`, `X-RateLimit-Limit-publicApi`); the guard adds the standard
  `Retry-After`, which is what HTTP clients honor. Responses within the limit carry
  `X-RateLimit-Limit`, `-Remaining` and `-Reset` (with the suffix, on `publicApi`).
- **Fixed window.** The deadline is set on the window's first request (`PEXPIRE NX`) and is not renewed
  on each call; otherwise, whoever kept up the pace would never see the window expire. Once the limit is
  exceeded, a block key answers the following requests until it expires.
- **A Redis failure lets the request through.** An unavailable counter must not become a closed door —
  that would trade a rate limit for total unavailability. The failure is logged as an error, because
  the protection is not in force during that interval.
- **Exemptions with `@SkipRateLimit()`**, not with the library's `@SkipThrottle()`: without an
  argument, it skips **only** the `default` limit, and the endpoint stays limited by the named ones. The
  project's decorator is derived from the list of declared limits, so it follows new limits without
  revisiting each exemption. `/health` is exempt, because it is probed periodically and a 429 there
  would be read as the API being unavailable.
- **Stricter per-endpoint limits** come from `@Throttle({ default: { limit, ttl } })` on the controller
  itself — that is what the sensitive authentication endpoints use.

## Encryption of sensitive data

Email, address and the password hash are encrypted before reaching the database (NFR NFSE03). The
contract is `EncryptionProvider`, and the implementation uses **AES-256-GCM** with `node:crypto`
(`AesEncryptionProvider`).

| Variable | Content |
| --- | --- |
| `ENCRYPTION_KEYS` | Versioned AES keys: `1:<key>,2:<key>`, each with 32 bytes in base64 or hexadecimal |
| `BLIND_INDEX_KEY` | Single 32-byte key for the blind index |

Generate both with `npm run keys:generate` and paste the output into `.env` (the command also prints
`AUTH_ACCESS_TOKEN_SECRET`, described in [Authentication and sessions](06-Authentication-and-Accounts.md#authentication-and-sessions)).
A missing key, one of the wrong size or a repeated version prevents the application from starting.

- **IV per operation.** Encrypting the same value twice produces different ciphertexts, so two
  documents with the same email cannot be identified by the encrypted content.
- **Integrity checked.** GCM is authenticated: a tampered or truncated ciphertext, or one encrypted
  with another key, does not decrypt, and the exception always responds with the same generic message —
  the technical reason goes in `details`, for the log.
- **Gradual rotation.** The highest version in `ENCRYPTION_KEYS` is the active one, used for new
  encryptions; the previous ones remain available to read documents already stored, which record the
  version used (`encryption_key_version`). To rotate, add the new version
  (`npm run keys:generate -- --version 2`) without removing the old ones.
- **Blind index.** `blindIndex` applies HMAC-SHA256 to the normalized value (lowercase, no surrounding
  spaces), making it possible to find the account by email at login without decrypting the collection.
  Unlike the AES key, `BLIND_INDEX_KEY` is not versioned: changing it would invalidate every index
  already stored.

### Password

The password is never stored, not even reversibly: the `PasswordProvider` contract only knows how to
produce the value to persist (`hash`) and how to check an attempt against it (`verify`). The
implementation (`BcryptPasswordProvider`) combines three steps:

```
password → SHA-256 (base64) → bcrypt (BCRYPT_COST) → AES-256-GCM → database
```

- **Mandatory pre-hash.** bcrypt ignores anything beyond 72 bytes. Without handling, two long passwords
  that only differ after that limit would be accepted for each other — an authentication flaw, not a
  theoretical detail. The base64 SHA-256 digest has 44 characters, always within the limit, and does
  not contain the null byte that would truncate the input in bcrypt implementations written in C.
- **Encrypted hash.** bcrypt resists brute force through its cost; encryption adds a second barrier,
  because the AES key lives outside the database. A leak of the collection alone does not even allow
  testing passwords against the hash. The persisted value is an `EncryptedValue`, with the same key
  version as the document's other protected fields.
- **Configurable cost.** `BCRYPT_COST` (4 to 31, default `12`) sets the work per verification; each
  increment doubles it. Raising it does **not** invalidate the passwords already stored: the cost
  travels in the hash itself and each one keeps being verified with its own.
- **An integrity error is not a wrong password.** `verify` returns `false` only for an incorrect
  password; a tampered value or one encrypted with a missing key version throws `EncryptionException`,
  so a configuration problem does not turn into invalid credentials.

Changing any step of the composition would invalidate every stored password and would require a
rehydration flow on the next login.

## Honeypot: decoy routes and IP blocking (RF21, NFSE07, #87/#88)

Whoever calls a decoy route has the access recorded and the IP **blocked indefinitely, across the whole
API**.

- **Decoy routes** (`honeypot` module, isolated): `GET /v2/companies?page=&page_size=` and
  `GET /v2/companies/:cnpj`. They imitate a new version of the public API that does not exist (the real
  one is `/v1/companies/:cnpj`, with no listing), stay out of OpenAPI and the documentation and are
  public: only someone scanning paths reaches them.
  - **Synthetic data**, never real: companies generated by Faker (pt-BR, its own instance) with a valid
    CNPJ (`cnpjWithCheckDigits`), official CNAE, state, municipality and indexes; the same CNPJ or the
    same page always returns the same content. They read no database, cache or source.
  - **Low volume:** at most 10 per page; a larger `page_size` is reduced to 10.
  - **Deliberately low availability:** `HONEYPOT_FAILURE_RATE` of the calls (default 0.25) respond
    `503 COMPANY_DATA_UNAVAILABLE`, like the real API; the others take up to `HONEYPOT_MAX_DELAY_MS`
    (default 2 s). Only on the decoys.
- **`@Honeypot()`** (`security`): marks the route as public and as a decoy and removes it from OpenAPI.
  Before the decoy responds, it writes `honeypot_hits` (IP, path without the query, method, user-agent,
  date) and the block in `access_blocks` (`scope=IP`, `reason=HONEYPOT`, no `blocked_until`), and
  mirrors the IP into the `bios:blocked-ips` set in Redis. A failure while recording does not change the
  decoy's response. A test prevents the decorator from being used outside the decoy module.
- **Refused on every route** (`BlockedIpMiddleware`, global): the blocked IP gets `403 ACCESS_BLOCKED`
  on any route (real or decoy, public or not), before rate limiting and authentication. The lookup goes
  to Redis; with Redis down, to the database; if neither responds, the request goes through (the
  honeypot does not take the real routes down, NFSE07). On startup, the Redis set is reloaded from the
  database's indefinite blocks. The temporary login lockout (RF20) still applies only to login.
- **Client IP behind a proxy** (`TRUST_PROXY`): `false` (default, no proxy), the number of proxies in
  front of the API or a list of them. **In production behind a proxy, configure it**: without it, every
  access would seem to come from the proxy. `true` is refused, because it would let the client write
  its own IP into `X-Forwarded-For` and make the honeypot block someone else's IP; with the proxy
  declared, forged entries on the left of the header are ignored.
- **Exempt** (`HONEYPOT_EXEMPT_IPS`, IPs and CIDR ranges): never blocked (the call is recorded). The
  default covers loopback and internal networks, where the proxy and monitoring live: a misdeclared
  proxy does not take the whole API down.

---

[Documentation index](README.md) · ← [06. Authentication and accounts](06-Authentication-and-Accounts.md) · [08. Query cache](08-Cache.md) →
