import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import { faker } from '@test/support/faker.js';
import {
  resolveEvidenceState,
  signalForCategory,
  UNKNOWN_RETRY_WINDOW_SECONDS,
} from './evidence-rules.js';

describe('signalForCategory', () => {
  it.each([
    [EvidenceCategory.INFRACAO_AMBIENTAL, EvidenceSignal.NEGATIVE],
    [EvidenceCategory.CONDUTA_ADMINISTRATIVA, EvidenceSignal.NEGATIVE],
    [EvidenceCategory.EMISSAO_GEE, EvidenceSignal.POSITIVE],
  ])('%s tem sinal %s', (category, signal) => {
    expect(signalForCategory(category)).toBe(signal);
  });

  it('toda categoria tem um sinal', () => {
    for (const category of Object.values(EvidenceCategory)) {
      expect(Object.values(EvidenceSignal)).toContain(
        signalForCategory(category),
      );
    }
  });
});

describe('resolveEvidenceState', () => {
  const now = faker.date.recent();
  const past = new Date(now.getTime() - 1_000);
  const future = new Date(now.getTime() + 1_000);

  it.each([EvidenceState.CONFIRMED, EvidenceState.NOT_FOUND])(
    '%s dentro da validade continua como está',
    (state) => {
      expect(resolveEvidenceState(state, future, now)).toBe(state);
    },
  );

  it.each([EvidenceState.CONFIRMED, EvidenceState.NOT_FOUND])(
    '%s vencida vira OUTDATED',
    (state) => {
      expect(resolveEvidenceState(state, past, now)).toBe(
        EvidenceState.OUTDATED,
      );
    },
  );

  it('vence no instante exato da validade (a validade é exclusiva)', () => {
    expect(resolveEvidenceState(EvidenceState.CONFIRMED, now, now)).toBe(
      EvidenceState.OUTDATED,
    );
  });

  it('UNKNOWN não envelhece: continua UNKNOWN mesmo vencida', () => {
    expect(resolveEvidenceState(EvidenceState.UNKNOWN, past, now)).toBe(
      EvidenceState.UNKNOWN,
    );
  });

  it('OUTDATED continua OUTDATED', () => {
    expect(resolveEvidenceState(EvidenceState.OUTDATED, future, now)).toBe(
      EvidenceState.OUTDATED,
    );
  });

  it('sem o instante, usa o agora', () => {
    vi.useFakeTimers({ now });

    expect(resolveEvidenceState(EvidenceState.CONFIRMED, past)).toBe(
      EvidenceState.OUTDATED,
    );
    expect(resolveEvidenceState(EvidenceState.CONFIRMED, future)).toBe(
      EvidenceState.CONFIRMED,
    );

    vi.useRealTimers();
  });
});

describe('UNKNOWN_RETRY_WINDOW_SECONDS', () => {
  it('é curta: a fonte volta a ser consultada em minutos, não em horas', () => {
    expect(UNKNOWN_RETRY_WINDOW_SECONDS).toBeGreaterThan(0);
    expect(UNKNOWN_RETRY_WINDOW_SECONDS).toBeLessThanOrEqual(3_600);
  });
});
