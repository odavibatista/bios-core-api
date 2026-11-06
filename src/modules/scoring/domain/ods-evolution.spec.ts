import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
  ScoreMovementCause,
} from '@prisma/client';
import type { StoredEvidence } from '@modules/evidences/domain/dtos/repositories/evidence.repository.js';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { buildOdsEvolution, OdsEvolutionStatus } from './ods-evolution.js';

const CALCULATED_AT = new Date('2026-11-01T12:00:00.000Z');

function ibama(
  key: string,
  publishedAt: string | null,
  details: StoredEvidence['details'] = null,
): StoredEvidence {
  return storedEvidenceFactory.build({
    id: key,
    key,
    category: EvidenceCategory.INFRACAO_AMBIENTAL,
    sourceSlug: 'IBAMA',
    signal: EvidenceSignal.NEGATIVE,
    state: EvidenceState.CONFIRMED,
    odsNumber: 15,
    sourceReference: key,
    sourceUrl: null,
    publishedAt: publishedAt ? new Date(publishedAt) : null,
    details,
    validUntil: new Date('2020-01-01T00:00:00.000Z'),
  });
}

function sanction(
  key: string,
  startDate: string,
  endDate: string,
): StoredEvidence {
  return storedEvidenceFactory.build({
    id: key,
    key,
    category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
    sourceSlug: 'CGU_CEIS',
    signal: EvidenceSignal.NEGATIVE,
    state: EvidenceState.CONFIRMED,
    odsNumber: 15,
    sourceReference: key,
    sourceUrl: null,
    publishedAt: null,
    details: { startDate, endDate },
    validUntil: new Date('2099-01-01T00:00:00.000Z'),
  });
}

const build = (evidences: StoredEvidence[], scoreValue: number) =>
  buildOdsEvolution({
    odsNumber: 15,
    evidences,
    scoreValue,
    calculatedAt: CALCULATED_AT,
  });

describe('buildOdsEvolution', () => {
  it('um degrau por mudança do índice, em ordem, com a evidência que o causou', () => {
    const { status, steps } = build(
      [
        ibama('b', '2024-03-10T00:00:00.000Z'),
        ibama('a', '2022-06-01T00:00:00.000Z'),
      ],
      -80,
    );

    expect(status).toBe(OdsEvolutionStatus.AVAILABLE);
    expect(steps.map(({ scoreValue }) => scoreValue)).toEqual([-40, -80]);
    expect(steps.map(({ evidenceId }) => evidenceId)).toEqual(['a', 'b']);
    expect(steps[1]).toMatchObject({
      cause: ScoreMovementCause.EVIDENCE_ADDED,
      evidenceCount: 1,
    });
  });

  it('evidências do mesmo dia formam um degrau só', () => {
    const { steps } = build(
      [
        ibama('a', '2022-06-01T08:00:00.000Z'),
        ibama('b', '2022-06-01T20:00:00.000Z'),
        sanction('c', '2024-01-10', '2030-01-10'),
      ],
      -85,
    );

    expect(steps.map(({ scoreValue }) => scoreValue)).toEqual([-80, -85]);
    expect(steps[0]?.evidenceCount).toBe(2);
  });

  it('a evidência absorvida pelo teto da categoria não cria degrau', () => {
    const { status, steps } = build(
      [
        ibama('a', '2020-01-10T00:00:00.000Z'),
        ibama('b', '2021-01-10T00:00:00.000Z'),
        ibama('c', '2022-01-10T00:00:00.000Z'),
      ],
      -80,
    );

    expect(status).toBe(OdsEvolutionStatus.AVAILABLE);
    expect(steps.map(({ scoreValue }) => scoreValue)).toEqual([-40, -80]);
  });

  it('o fim da sanção cria um degrau, com o peso reduzido', () => {
    const { steps } = build(
      [
        ibama('a', '2023-02-01T00:00:00.000Z'),
        sanction('b', '2024-06-01', '2025-06-01'),
      ],
      -41.25,
    );

    expect(steps.map(({ scoreValue }) => scoreValue)).toEqual([
      -40, -45, -41.25,
    ]);
    expect(steps.at(-1)).toMatchObject({
      cause: ScoreMovementCause.WEIGHT_CHANGED,
      evidenceId: 'b',
    });
  });

  it('o embargo vale inteiro até a baixa', () => {
    const { steps } = build(
      [
        ibama('a', '2023-02-01T00:00:00.000Z', {
          resource: 'TERMO_EMBARGO',
          lifted: true,
          lifted_at: '2025-02-01T00:00:00.000Z',
        }),
        ibama('b', '2024-02-01T00:00:00.000Z'),
      ],
      -50,
    );

    expect(steps.map(({ scoreValue }) => scoreValue)).toEqual([-40, -80, -50]);
  });

  it('a validade da coleta não apaga o passado', () => {
    const evidences = [
      ibama('a', '2022-06-01T00:00:00.000Z'),
      ibama('b', '2024-03-10T00:00:00.000Z'),
    ];

    expect(evidences[0]?.validUntil.getTime()).toBeLessThan(Date.now());
    expect(build(evidences, -80).status).toBe(OdsEvolutionStatus.AVAILABLE);
  });

  it('evidências em um só ano não têm evolução', () => {
    expect(
      build(
        [
          ibama('a', '2024-01-10T00:00:00.000Z'),
          ibama('b', '2024-09-10T00:00:00.000Z'),
        ],
        -80,
      ),
    ).toEqual({ status: OdsEvolutionStatus.SHORT_HISTORY, steps: [] });
  });

  it('dois anos com um só valor do índice também não têm evolução', () => {
    const { status } = build(
      [
        ibama('a', '2023-01-10T00:00:00.000Z'),
        ibama('b', '2023-01-10T00:00:00.000Z'),
        ibama('c', '2024-01-10T00:00:00.000Z'),
      ],
      -80,
    );

    expect(status).toBe(OdsEvolutionStatus.SHORT_HISTORY);
  });

  it('sem evidência datada, informa o motivo', () => {
    expect(build([ibama('a', null)], -40)).toEqual({
      status: OdsEvolutionStatus.NO_DATED_EVIDENCE,
      steps: [],
    });
  });

  it('série que não chega ao índice gravado não é entregue', () => {
    expect(
      build(
        [
          ibama('a', '2022-06-01T00:00:00.000Z'),
          ibama('b', '2024-03-10T00:00:00.000Z'),
        ],
        -40,
      ),
    ).toEqual({ status: OdsEvolutionStatus.NOT_REPRODUCIBLE, steps: [] });
  });

  it('evidência sem data entre as que pontuam impede reproduzir o índice', () => {
    expect(
      build(
        [
          ibama('a', '2022-06-01T00:00:00.000Z'),
          ibama('b', '2024-03-10T00:00:00.000Z'),
          ibama('c', null),
        ],
        -80,
      ).status,
    ).toBe(OdsEvolutionStatus.NOT_REPRODUCIBLE);
  });

  it('fato depois do cálculo não entra na série', () => {
    expect(
      build(
        [
          ibama('a', '2022-06-01T00:00:00.000Z'),
          ibama('b', '2024-03-10T00:00:00.000Z'),
          ibama('c', '2027-01-01T00:00:00.000Z'),
        ],
        -80,
      ).steps.map(({ scoreValue }) => scoreValue),
    ).toEqual([-40, -80]);
  });
});
