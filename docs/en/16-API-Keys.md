# 16. API keys and public API

🇧🇷 [Português](../16-Chaves-de-API.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [15. Companies](15-Companies.md) · [17. Tests](17-Tests.md) →

> Managing keys from the dashboard and looking up profiles by key (UC11, UC12).

`POST /api-keys`, `GET /api-keys` and `DELETE /api-keys/:id` (UC11, RF16) let users generate, list and
revoke their own keys. They require a session (JWT); **key authentication** on the public routes is
UC12, described further below.

- **Format.** `bios_<8-character public id>_<256-bit secret in base64url>`. The prefix (`bios_` + public
  id) is what the listing shows and what the key lookup uses; the secret comes from the same
  cryptographic generator as the other opaque tokens.
- **Shown once.** The `POST` returns the full key (`key`) only once. The database stores only the
  SHA-256 of the whole key (`key_hash`) and the prefix; the listing never carries the key or the digest.
  Lost the key: revoke it and generate another.
- **Ceiling.** Up to 10 active keys per user (`422 API_KEY_LIMIT_REACHED`, with `details.limit`); revoking
  frees the slot. The public id has 62⁸ possibilities, and a collision (unique index on `key_prefix`)
  generates a new id, with up to 3 attempts.
- **Revocation.** Final and immediate, by the owner only: ownership is part of the write itself
  (`updateMany` filtering on `id_api_key` + `user_id` + not revoked), without a prior read. Someone else's
  key, a nonexistent, malformed or already revoked key: the same `404 API_KEY_NOT_FOUND`. The record keeps
  `revoked_at` and disappears from the listing.

## Public API (lookup by key)

`GET /v1/companies/:cnpj` (UC12, RF17) returns the same profile as the dashboard lookup, for third-party
systems, authenticated by the `x-api-key` header instead of a session. The `v1` leaves room to evolve
the contract without breaking existing integrations. Since #81 the response is the full profile:
registration, evidence and, per SDG, index, confidence and explanation (see [Full company profile](15-Companies.md#full-company-profile)).

- **`@ApiKeyAuth()`** is what declares a route as public API: it bundles `@Public()` (no session needed),
  the `ApiKeyGuard`, `@PublicApiRoute()` (turns on the per-key limit) and the `api-key` scheme in OpenAPI.
  Whoever exposes a public endpoint imports `ApiKeysModule` and uses the decorator.
- **It does not wait for the external sources (#333).** Unlike the dashboard, the public route serves what
  is stored and valid, **publishes** the update of what is missing (CGU, GHG, on-demand IBAMA and the
  index recalculation) and responds without waiting for any of those jobs, flagging what is pending in
  `provenance` (`origin = PENDING`, `scores_pending`, `retry_after_seconds`). Only the registration is
  awaited, because the profile does not exist without it. Before, each new CNPJ held the integrator's
  connection until the queue deadline and piled the collections up behind the response. Whoever sweeps
  CNPJs gets the registration and what was already stored, and comes back after `retry_after_seconds`
  for the rest.
- **The load a sweep generates, and what bounds it.** A lookup of a new CNPJ publishes **at most** one
  CGU job, one GHG job, one on-demand IBAMA job and one recalculation (plus the registration one, if
  missing), each deduplicated by the window identifier; a repeated lookup while the marker is valid does
  not publish again. The inbound pace is the per-key limit (`THROTTLE_PUBLIC_API_LIMIT`, 60 per minute),
  and the outbound traffic to the external sources stays under each source's limit in the catalog
  (NFPD01), because it is the queue consumer that talks to them, not the request. The
  `public-api-load.e2e-spec.ts` e2e test counts the jobs of a burst of distinct CNPJs.
- **The index only counts when it is newer than the last collection.** In no-wait mode, the index read
  from the database may have been calculated before a collection that finished afterwards; while there is
  evidence newer than the calculation, `scores_pending` is true and the profile does not go to the cache.
  The recalculation requested at the end of each lookup closes the gap, and the next lookup already
  returns the current snapshot. An `UNKNOWN` written less than 2 minutes ago (`PENDING_REFRESH_WINDOW_MS`)
  is the mark of an update in progress (`PENDING`); after that it becomes `UNAVAILABLE`.
- **Verification.** The public prefix (`bios_` + 8) finds the key through the unique index; the SHA-256
  of the whole key is compared with the stored one in constant time. The digest is computed before the
  lookup, so an unknown key does not respond faster than one with a wrong secret.
- **`401 INVALID_API_KEY`, always the same.** Missing, malformed, unknown, wrong-secret or revoked keys
  get the same response (revocation applies on the next call). A database error does not become 401: it
  propagates as unavailability.
- **Guard order.** Rate limiting comes before the key check: attempts with made-up keys spend quota and
  start getting 429, instead of hammering the database.
- **Last use (`last_used_at`).** Written on the authenticated call, with a precision of **1 minute**
  (`LAST_USED_PRECISION_MS`): within the window the date is not rewritten, which avoids turning every API
  read into a write; the condition is part of the write itself (`updateMany`), so simultaneous calls do
  not write twice. Failing to record the use does not bring down a legitimate call.
- **Separate credentials.** The session (JWT) does not work on the public API, and the API key does not
  work on the dashboard routes, including managing one's own keys.

---

[Documentation index](README.md) · ← [15. Companies](15-Companies.md) · [17. Tests](17-Tests.md) →
