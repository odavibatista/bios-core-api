# 08. Query cache

🇧🇷 [Português](../08-Cache.md) · 🇺🇸 **English**

[Documentation index](README.md) · ← [07. Security](07-Security.md) · [09. Transactional emails](09-Emails.md) →

> Caching of CNPJ queries in Redis, with graceful degradation.

It avoids a new call to the external source for a CNPJ already queried within the validity window
(NFDE01) — that is what makes an already seen profile respond quickly (NFDE02). The contract is
`CacheProvider`, implemented on the same `ioredis` connection as the health check.

```ts
const profile = await cache.get<CompanyProfile>({ namespace, identifier: cnpj });
await cache.set({ namespace, identifier: cnpj }, profile, ttlSeconds);
await cache.invalidate(cnpj); // everything about the CNPJ, in every namespace
```

- **Versioned key.** `bios:cache:v<format>:<namespace>:<identifier>`. The namespace separates profile,
  evidence and scores; the format version retires every entry at once when the stored content changes
  shape, without having to clear Redis on deploy.
- **Window per source.** Each query's TTL comes from `data_sources.cache_ttl_seconds`
  (`ResolveSourceCacheTtlUseCase`), adjustable in the database without a new deploy. Without a
  configured value, `CACHE_DEFAULT_TTL` applies.
- **The cache never brings down or delays the request.** A Redis failure is logged and treated as
  missing data, and every operation has a latency budget (`CACHE_OPERATION_BUDGET_MS`, 500 ms): the
  client keeps an internal command queue while it tries to reconnect, and without that cutoff a `GET`
  would wait for the reconnection. Once the deadline is exhausted, the query goes on to the source
  (NFCO01).
- **Explicit invalidation.** `invalidate(cnpj)` deletes all of the CNPJ's namespaces in a single `DEL` —
  no `SCAN`, whose cost grows with the size of the database. It is what gets called after the indexes
  are recalculated, so a new profile is not served with an old score. A failure here is logged as an
  **error**, not a warning: stale data would remain servable until the TTL ends.

---

[Documentation index](README.md) · ← [07. Security](07-Security.md) · [09. Transactional emails](09-Emails.md) →
