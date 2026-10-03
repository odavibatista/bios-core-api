import type { Duration } from '../../value-objects/duration.js';

/**
 * Política de retenção de uma coleção: documentos são removidos pelo MongoDB
 * quando a data do campo observado somada à retenção fica no passado.
 */
export interface RetentionPolicy {
  /** Coleção MongoDB (nome físico, conforme `@@map`). */
  collection: string;

  /** Campo de data observado pelo índice TTL. */
  field: string;

  /** Nome do índice, idêntico ao declarado no schema Prisma (`map`). */
  indexName: string;

  /** Tempo de permanência após a data do campo. */
  retention: Duration;
}

/**
 * Resultado da aplicação de uma política sobre o índice correspondente.
 *  - `created`: índice inexistente, criado já com TTL;
 *  - `updated`: índice existente, convertido em TTL ou com prazo alterado;
 *  - `unchanged`: índice já estava com o prazo configurado.
 */
export type RetentionIndexOutcome = 'created' | 'updated' | 'unchanged';
