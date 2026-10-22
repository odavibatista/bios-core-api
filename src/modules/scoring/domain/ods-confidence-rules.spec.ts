import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { scoreOdsEvidences } from './ods-score-rules.js';

describe('RF11: confianca separada do indice', () => {
  const now = new Date('2026-10-22T12:00:00.000Z');
  const validUntil = new Date('2026-10-23T12:00:00.000Z');
  const ibama = (key: string) =>
    storedEvidenceFactory.build({
      key,
      sourceSlug: 'IBAMA',
      odsNumber: 15,
      category: EvidenceCategory.INFRACAO_AMBIENTAL,
      signal: EvidenceSignal.NEGATIVE,
      sourceReference: key,
      sourceUrl: null,
      validUntil,
    });
  const cgu = (key: string, sourceSlug = 'CGU_CEIS') =>
    storedEvidenceFactory.build({
      key,
      sourceSlug,
      odsNumber: 15,
      category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
      signal: EvidenceSignal.NEGATIVE,
      sourceReference: key,
      sourceUrl: null,
      validUntil,
    });
  const ghg = (key: string) =>
    storedEvidenceFactory.build({
      key,
      sourceSlug: 'GHG_PROTOCOL',
      odsNumber: 13,
      category: EvidenceCategory.EMISSAO_GEE,
      signal: EvidenceSignal.POSITIVE,
      sourceReference: key,
      sourceUrl: null,
      validUntil,
    });

  it('combina quantidade, cobertura e qualidade com valores verificaveis', () => {
    const one = scoreOdsEvidences(15, [ibama('ibama-1')], now);
    const all = scoreOdsEvidences(
      15,
      [ibama('ibama-1'), cgu('ceis-1'), cgu('cnep-1', 'CGU_CNEP')],
      now,
    );
    expect(one.scoreValue).toBe(-40);
    expect(one.confidenceValue).toBeCloseTo(1 / 9);
    expect(all.scoreValue).toBe(-50);
    expect(all.confidenceValue).toBeCloseTo(0.75 * (2.5 / 3.5));
    expect(all.confidenceValue).toBeGreaterThan(one.confidenceValue);
  });

  it('NOT_FOUND vigente amplia cobertura somente com achado confirmado; nao pontua', () => {
    const confirmed = ibama('ibama-1');
    const absent = { ...cgu('ceis-empty'), state: EvidenceState.NOT_FOUND };
    const baseline = scoreOdsEvidences(15, [confirmed], now);
    const covered = scoreOdsEvidences(15, [confirmed, absent], now);
    expect(covered.scoreValue).toBe(baseline.scoreValue);
    expect(covered.confidenceValue).toBeGreaterThan(baseline.confidenceValue);
    expect(scoreOdsEvidences(15, [absent], now)).toMatchObject({
      scoreValue: null,
      confidenceValue: 0,
    });
  });

  it('UNKNOWN e OUTDATED de cada fonte reduzem apenas a confianca', () => {
    const confirmed = ibama('ibama-1');
    const baseline = scoreOdsEvidences(15, [confirmed], now);
    const withUnknown = scoreOdsEvidences(
      15,
      [confirmed, { ...cgu('ceis-unknown'), state: EvidenceState.UNKNOWN }],
      now,
    );
    const withOutdated = scoreOdsEvidences(
      15,
      [
        confirmed,
        { ...cgu('ceis-unknown'), state: EvidenceState.UNKNOWN },
        { ...cgu('cnep-old', 'CGU_CNEP'), state: EvidenceState.OUTDATED },
      ],
      now,
    );
    expect(withUnknown.scoreValue).toBe(baseline.scoreValue);
    expect(withUnknown.confidenceValue).toBeCloseTo(
      baseline.confidenceValue / 2,
    );
    expect(withOutdated.scoreValue).toBe(baseline.scoreValue);
    expect(withOutdated.confidenceValue).toBeCloseTo(
      baseline.confidenceValue / 3,
    );
  });

  it('validade vencida reduz confianca como OUTDATED mesmo antes da projecao', () => {
    const confirmed = ibama('ibama-1');
    const expired = {
      ...cgu('ceis-expired'),
      validUntil: new Date('2026-10-22T11:59:59.999Z'),
    };
    const baseline = scoreOdsEvidences(15, [confirmed], now);
    const result = scoreOdsEvidences(15, [confirmed, expired], now);
    expect(result.scoreValue).toBe(baseline.scoreValue);
    expect(result.confidenceValue).toBeCloseTo(baseline.confidenceValue / 2);
  });

  it('fonte complementar pesa menos e inventario GHG respeita teto estrutural', () => {
    const direct = scoreOdsEvidences(15, [ibama('ibama-1')], now);
    const indirect = scoreOdsEvidences(15, [cgu('ceis-1')], now);
    expect(indirect.confidenceValue).toBeLessThan(direct.confidenceValue);
    const climate = scoreOdsEvidences(13, [ghg('ghg-1')], now);
    expect(climate.confidenceValue).toBeCloseTo(1 / 12);
    expect(
      scoreOdsEvidences(13, [ghg('ghg-1'), ghg('ghg-2')], now).confidenceValue,
    ).toBeLessThan(0.25);
  });

  it('mais achados concluidos nunca reduzem; estados inconclusivos nunca aumentam', () => {
    for (let count = 1; count <= 6; count++) {
      const confirmed = Array.from({ length: count }, (_, i) =>
        ibama(`ibama-${i}`),
      );
      const baseline = scoreOdsEvidences(15, confirmed, now);
      const extra = scoreOdsEvidences(
        15,
        [...confirmed, cgu(`ceis-${count}`)],
        now,
      );
      expect(extra.confidenceValue).toBeGreaterThanOrEqual(
        baseline.confidenceValue,
      );
      for (const state of [EvidenceState.UNKNOWN, EvidenceState.OUTDATED]) {
        const degraded = scoreOdsEvidences(
          15,
          [...confirmed, { ...cgu(`ceis-${state}`), state }],
          now,
        );
        expect(degraded.scoreValue).toBe(baseline.scoreValue);
        expect(degraded.confidenceValue).toBeLessThanOrEqual(
          baseline.confidenceValue,
        );
      }
    }
  });

  it('ignora fonte incorreta e nao gera NaN para contribuicao fora do catalogo', () => {
    const wrongSource = { ...ibama('other'), sourceSlug: 'OUTRA_FONTE' };
    expect(scoreOdsEvidences(15, [wrongSource], now)).toMatchObject({
      scoreValue: -40,
      confidenceValue: 0,
    });
    const baseline = scoreOdsEvidences(15, [ibama('valid')], now);
    const withWrongSource = scoreOdsEvidences(
      15,
      [ibama('valid'), wrongSource],
      now,
    );
    expect(withWrongSource.confidenceValue).toBe(baseline.confidenceValue);
  });
});
