import type { CacheKey } from '../dtos/providers/cache-key.dto.js';

/**
 * Contrato de cache de consultas (NFDE01, NFDE02).
 *
 * Evita nova chamada à fonte externa para um CNPJ já consultado dentro da
 * janela de validade, o que é o que sustenta a resposta rápida de um perfil já
 * visto (NFDE02).
 *
 * **Nenhuma operação falha por causa do cache.** Cache indisponível é tratado
 * como ausência de dado: a leitura devolve `undefined` e a escrita não acontece,
 * sem erro para quem chamou (NFCO01). Cache é otimização, nunca fonte de
 * verdade — o dado continua no MongoDB.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class CacheProvider {
  /**
   * Devolve o valor guardado, ou `undefined` quando não há entrada válida —
   * seja por nunca ter sido gravada, por ter vencido ou por o cache estar
   * indisponível.
   */
  abstract get<T>(key: CacheKey): Promise<T | undefined>;

  /**
   * Guarda o valor pela janela informada.
   *
   * @param ttlSeconds janela de validade, em segundos.
   */
  abstract set<T>(key: CacheKey, value: T, ttlSeconds: number): Promise<void>;

  /** Remove uma entrada. */
  abstract delete(key: CacheKey): Promise<void>;

  /**
   * Remove tudo o que está guardado sobre um identificador, em todos os
   * namespaces. É o que se usa depois de recalcular os índices de uma empresa:
   * perfil, evidências e notas saem juntos, para não servir uma combinação
   * incoerente.
   */
  abstract invalidate(identifier: string): Promise<void>;
}
