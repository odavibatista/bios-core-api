import type {
  RetentionIndexOutcome,
  RetentionPolicy,
} from '../dtos/providers/retention-policy.dto.js';

/**
 * Contrato de aplicação de políticas de retenção sobre os índices do banco.
 *
 * Implementações devem ser idempotentes: aplicar a mesma política repetidas
 * vezes (ex.: a cada boot, ou em várias instâncias simultâneas) não pode
 * produzir erro nem efeito adicional.
 */
export abstract class RetentionIndexProvider {
  abstract apply(policy: RetentionPolicy): Promise<RetentionIndexOutcome>;
}
