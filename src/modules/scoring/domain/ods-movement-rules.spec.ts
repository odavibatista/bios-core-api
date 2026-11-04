import { describe, expect, it } from 'vitest';
import {
  detectOdsMovement,
  type MovementContribution,
  type MovementScoreState,
} from './ods-movement-rules.js';

const RULES = 'rf10-rf11-v3';

function infraction(evidenceId: string, points = -40): MovementContribution {
  return { evidenceId, category: 'INFRACAO_AMBIENTAL', points };
}

function sanction(evidenceId: string, points = -5): MovementContribution {
  return { evidenceId, category: 'CONDUTA_ADMINISTRATIVA', points };
}

function score(
  contributions: readonly MovementContribution[],
  rulesVersion = RULES,
): MovementScoreState {
  return {
    scoreValue: contributions.length
      ? contributions.reduce((sum, { points }) => sum + points, 0)
      : null,
    rulesVersion,
    contributions,
  };
}

describe('detectOdsMovement', () => {
  describe('sentido', () => {
    it('índice que desce é DECREASED, com a evidência nova como causa', () => {
      expect(
        detectOdsMovement(
          score([sanction('a')]),
          score([sanction('a'), infraction('b')]),
        ),
      ).toEqual({
        direction: 'DECREASED',
        cause: 'EVIDENCE_ADDED',
        evidenceCategory: 'INFRACAO_AMBIENTAL',
      });
    });

    it('índice que sobe por saída de evidência negativa é INCREASED', () => {
      expect(
        detectOdsMovement(
          score([sanction('a'), infraction('b')]),
          score([sanction('a')]),
        ),
      ).toEqual({
        direction: 'INCREASED',
        cause: 'EVIDENCE_REMOVED',
        evidenceCategory: 'INFRACAO_AMBIENTAL',
      });
    });

    it('primeiro índice é AVAILABLE', () => {
      expect(detectOdsMovement(null, score([infraction('a')]))).toEqual({
        direction: 'AVAILABLE',
        cause: 'EVIDENCE_ADDED',
        evidenceCategory: 'INFRACAO_AMBIENTAL',
      });
    });

    it('índice nulo que passa a ter valor é AVAILABLE', () => {
      expect(
        detectOdsMovement(score([]), score([infraction('a')]))?.direction,
      ).toBe('AVAILABLE');
    });

    it('índice que deixa de existir é UNAVAILABLE', () => {
      expect(detectOdsMovement(score([infraction('a')]), score([]))).toEqual({
        direction: 'UNAVAILABLE',
        cause: 'EVIDENCE_REMOVED',
        evidenceCategory: 'INFRACAO_AMBIENTAL',
      });
    });
  });

  describe('causa', () => {
    it('quando entra e sai evidência, a causa é a que entrou', () => {
      expect(
        detectOdsMovement(
          score([infraction('a', -10)]),
          score([sanction('b', -20)]),
        ),
      ).toEqual({
        direction: 'DECREASED',
        cause: 'EVIDENCE_ADDED',
        evidenceCategory: 'CONDUTA_ADMINISTRATIVA',
      });
    });

    it('mesmas evidências com peso diferente são WEIGHT_CHANGED', () => {
      expect(
        detectOdsMovement(
          score([sanction('a', -5), infraction('b', -40)]),
          score([sanction('a', -1.25), infraction('b', -40)]),
        ),
      ).toEqual({
        direction: 'INCREASED',
        cause: 'WEIGHT_CHANGED',
        evidenceCategory: 'CONDUTA_ADMINISTRATIVA',
      });
    });

    it('evidência nova sem pontos, zerada pelo teto, não é a causa', () => {
      expect(
        detectOdsMovement(
          score([infraction('a', -40)]),
          score([infraction('a', -10), infraction('b', 0)]),
        )?.cause,
      ).toBe('WEIGHT_CHANGED');
    });

    it('evidência que saiu sem pontos também não é a causa', () => {
      expect(
        detectOdsMovement(
          score([infraction('a', 0), sanction('b', -5)]),
          score([sanction('b', -1.25)]),
        )?.cause,
      ).toBe('WEIGHT_CHANGED');
    });
  });

  describe('categoria', () => {
    it('é a da contribuição de maior efeito no índice', () => {
      expect(
        detectOdsMovement(
          score([]),
          score([sanction('a', -5), infraction('b', -40)]),
        )?.evidenceCategory,
      ).toBe('INFRACAO_AMBIENTAL');
    });

    it('no peso, conta a diferença de pontos, e não o tamanho da contribuição', () => {
      expect(
        detectOdsMovement(
          score([infraction('a', -40), sanction('b', -5)]),
          score([infraction('a', -39), sanction('b', -1.25)]),
        )?.evidenceCategory,
      ).toBe('CONDUTA_ADMINISTRATIVA');
    });

    it('no empate, vale a evidência de menor identificador, em qualquer ordem', () => {
      const first = [sanction('a', -5), infraction('b', -5)];

      expect(detectOdsMovement(score([]), score(first))?.evidenceCategory).toBe(
        'CONDUTA_ADMINISTRATIVA',
      );
      expect(
        detectOdsMovement(score([]), score([...first].reverse()))
          ?.evidenceCategory,
      ).toBe('CONDUTA_ADMINISTRATIVA');
    });
  });

  describe('o que não é movimentação', () => {
    it('índice igual, mesmo com evidências trocadas', () => {
      expect(
        detectOdsMovement(score([infraction('a')]), score([infraction('b')])),
      ).toBeNull();
    });

    it('duas leituras sem índice (IND02)', () => {
      expect(detectOdsMovement(score([]), score([]))).toBeNull();
      expect(detectOdsMovement(null, score([]))).toBeNull();
    });

    it('mudança da versão das regras, mesmo com o índice diferente', () => {
      expect(
        detectOdsMovement(
          score([infraction('a', -40)], 'rf10-rf11-v2'),
          score([infraction('a', -30)]),
        ),
      ).toBeNull();
    });

    it('retrato antigo inconsistente não derruba o recálculo', () => {
      expect(
        detectOdsMovement(
          { scoreValue: -40, rulesVersion: RULES, contributions: [] },
          score([]),
        ),
      ).toBeNull();
    });
  });
});
