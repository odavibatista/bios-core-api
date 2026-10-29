# 08. Cache de consultas

🇧🇷 **Português** · 🇺🇸 [English](en/08-Cache.md)

[Índice da documentação](README.md) · ← [07. Segurança](07-Segurança.md) · [09. E-mails transacionais](09-E-mails.md) →

> Cache das consultas por CNPJ no Redis, com degradação graciosa.

Evita nova chamada à fonte externa para um CNPJ já consultado dentro da janela de validade
(NFDE01) — é o que faz um perfil já visto responder rápido (NFDE02). O contrato é
`CacheProvider`, implementado sobre a mesma conexão `ioredis` do health check.

```ts
const profile = await cache.get<CompanyProfile>({ namespace, identifier: cnpj });
await cache.set({ namespace, identifier: cnpj }, profile, ttlSeconds);
await cache.invalidate(cnpj); // tudo sobre o CNPJ, em todos os namespaces
```

- **Chave versionada.** `bios:cache:v<formato>:<namespace>:<identificador>`. O namespace separa
  perfil, evidências e notas; a versão do formato aposenta todas as entradas de uma vez quando
  o conteúdo gravado muda de forma, sem precisar limpar o Redis no deploy.
- **Janela por fonte.** O TTL de cada consulta vem de `data_sources.cache_ttl_seconds`
  (`ResolveSourceCacheTtlUseCase`), ajustável no banco sem novo deploy. Sem valor configurado,
  vale `CACHE_DEFAULT_TTL`.
- **Cache nunca derruba nem atrasa a requisição.** Falha do Redis é registrada em log e tratada
  como ausência de dado, e toda operação tem orçamento de latência
  (`CACHE_OPERATION_BUDGET_MS`, 500 ms): o cliente mantém uma fila interna de comandos enquanto
  tenta reconectar, e sem esse corte um `GET` esperaria a reconexão. Esgotado o prazo, a
  consulta segue para a fonte (NFCO01).
- **Invalidação explícita.** `invalidate(cnpj)` apaga todos os namespaces do CNPJ em um único
  `DEL` — sem `SCAN`, cujo custo cresce com o tamanho do banco. É o que se chama depois de
  recalcular os índices, para não servir perfil novo com nota velha. Falha aqui é registrada
  como **erro**, não aviso: dado vencido continuaria servível até o fim do TTL.

---

[Índice da documentação](README.md) · ← [07. Segurança](07-Segurança.md) · [09. E-mails transacionais](09-E-mails.md) →
