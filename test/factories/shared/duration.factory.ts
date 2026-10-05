import { Duration } from '@shared/domain/value-objects/duration.js';
import { faker } from '../../support/faker.js';

interface DurationRange {
  /** Mínimo, em segundos (padrão: 1 minuto). */
  min?: number;
  /** Máximo, em segundos (padrão: 365 dias). */
  max?: number;
}

/**
 * Duração aleatória em segundos inteiros. A faixa padrão cobre os prazos de
 * sessão e de retenção de dados aceitos pela aplicação.
 */
export function buildDuration({
  min = 60,
  max = 365 * 86_400,
}: DurationRange = {}): Duration {
  return Duration.ofSeconds(faker.number.int({ min, max }));
}
