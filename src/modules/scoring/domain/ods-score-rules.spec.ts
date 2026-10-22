import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import {
  ODS_SCORE_RULES_VERSION,
  scoreOdsEvidences,
} from './ods-score-rules.js';

describe('RF10: regras fixas por ODS', () => {
  const ibama = (key: string) =>
    storedEvidenceFactory.build({
      key,
      category: EvidenceCategory.INFRACAO_AMBIENTAL,
      signal: EvidenceSignal.NEGATIVE,
      odsNumber: 15,
      sourceReference: key,
      sourceUrl: null,
    });
  const cgu = (key: string) =>
    storedEvidenceFactory.build({
      key,
      category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
      sourceSlug: 'CGU_CEIS',
      signal: EvidenceSignal.NEGATIVE,
      odsNumber: 15,
      sourceReference: key,
      sourceUrl: null,
    });
  const ghg = (key: string) =>
    storedEvidenceFactory.build({
      key,
      category: EvidenceCategory.EMISSAO_GEE,
      sourceSlug: 'GHG_PROTOCOL',
      signal: EvidenceSignal.POSITIVE,
      odsNumber: 13,
      sourceReference: key,
      sourceUrl: null,
    });

  it('versiona regras e falha explicitamente para ODS ativo sem regra', () => {
    expect(ODS_SCORE_RULES_VERSION).toBe('rf10-rf11-v2');
    expect(() => scoreOdsEvidences(16, [])).toThrow('ODS 16 sem regras');
  });

  it('sem achado confirmado rastreável registra índice indisponível e confiança mínima', () => {
    expect(scoreOdsEvidences(13, [])).toEqual({
      scoreValue: null,
      confidenceValue: 0,
      evidenceCount: 0,
      contributions: [],
    });
    expect(
      scoreOdsEvidences(15, [
        { ...ibama('unknown'), state: EvidenceState.UNKNOWN },
      ]),
    ).toMatchObject({
      scoreValue: null,
      confidenceValue: 0,
      evidenceCount: 0,
    });
  });

  it.each([
    [EvidenceState.UNKNOWN],
    [EvidenceState.NOT_FOUND],
    [EvidenceState.OUTDATED],
  ])('%s não pontua nem cria bônus para ausência', (state) => {
    const result = scoreOdsEvidences(
      15,
      [ibama(`state-${state}`), cgu(`cgu-${state}`)].map((e) => ({
        ...e,
        state,
      })),
    );
    expect(result.scoreValue).toBeNull();
    expect(result.contributions).toEqual([]);
  });

  it('ODS 13 soma somente inventário rastreável positivo, sem comparação com ODS 15', () => {
    const result = scoreOdsEvidences(13, [ghg('ghg-1'), ibama('ibama-1')]);
    expect(result.scoreValue).toBe(60);
    expect(result.contributions).toEqual([
      expect.objectContaining({
        category: EvidenceCategory.EMISSAO_GEE,
        signal: EvidenceSignal.POSITIVE,
        weight: 60,
        points: 60,
      }),
    ]);
    expect(result.confidenceValue).toBeLessThanOrEqual(0.25);
  });

  it('ODS 15 dá peso menor e teto menor para conduta administrativa', () => {
    const rows = [ibama('ibama-1'), cgu('cgu-1')];
    const result = scoreOdsEvidences(15, rows);
    expect(result.scoreValue).toBe(-45);
    expect(
      result.contributions.map((c) => [c.category, c.weight, c.points]),
    ).toEqual([
      [EvidenceCategory.CONDUTA_ADMINISTRATIVA, 5, -5],
      [EvidenceCategory.INFRACAO_AMBIENTAL, 40, -40],
    ]);
    expect(result.contributions.reduce((sum, c) => sum + c.points, 0)).toBe(
      result.scoreValue,
    );
  });

  it('aplica tetos por categoria sem superar 100 pontos e mantém uma contribuição por evidência', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => ibama(`ibama-${i}`)),
      ...Array.from({ length: 6 }, (_, i) => cgu(`cgu-${i}`)),
    ];
    const result = scoreOdsEvidences(15, rows);
    expect(result.scoreValue).toBe(-100);
    expect(result.contributions).toHaveLength(11);
    expect(result.evidenceCount).toBe(11);
    expect(
      result.contributions
        .filter((c) => c.category === EvidenceCategory.CONDUTA_ADMINISTRATIVA)
        .reduce((sum, c) => sum + c.points, 0),
    ).toBe(-20);
    expect(
      result.contributions
        .filter((c) => c.category === EvidenceCategory.INFRACAO_AMBIENTAL)
        .reduce((sum, c) => sum + c.points, 0),
    ).toBe(-80);
  });

  it('não pontua sinal contraditório nem confirmação sem referência rastreável', () => {
    const result = scoreOdsEvidences(15, [
      { ...ibama('wrong-sign'), signal: EvidenceSignal.POSITIVE },
      {
        ...ibama('missing'),
        sourceReference: '  ',
        sourceUrl: 'http://ibama.gov.br/registro',
      },
    ]);
    expect(result).toMatchObject({
      scoreValue: null,
      evidenceCount: 0,
      confidenceValue: 0,
    });
  });

  it('aceita URL HTTPS original como única referência e recusa credencial embutida', () => {
    const valid = {
      ...ghg('url-only'),
      sourceReference: null,
      sourceUrl: 'https://fgv.br/inventario',
    };
    const invalid = {
      ...ghg('url-credential'),
      sourceReference: null,
      sourceUrl: 'https://user:secret@fgv.br/inventario',
    };
    expect(scoreOdsEvidences(13, [valid, invalid])).toMatchObject({
      scoreValue: 60,
      evidenceCount: 1,
    });
  });

  it('UNKNOWN e OUTDATED reduzem somente a confiança, sem mudar o índice', () => {
    const confirmed = ibama('confirmed');
    const baseline = scoreOdsEvidences(15, [confirmed]);
    const degraded = scoreOdsEvidences(15, [
      confirmed,
      { ...ibama('unknown'), state: EvidenceState.UNKNOWN },
      { ...ibama('outdated'), state: EvidenceState.OUTDATED },
    ]);
    expect(degraded.scoreValue).toBe(baseline.scoreValue);
    expect(degraded.confidenceValue).toBeLessThan(baseline.confidenceValue);
  });

  it('CONFIRMED com validade expirada não pontua mesmo antes de ser projetado OUTDATED', () => {
    const now = new Date();
    const expired = {
      ...ibama('expired'),
      validUntil: new Date(now.getTime() - 1),
    };
    expect(scoreOdsEvidences(15, [expired], now)).toMatchObject({
      scoreValue: null,
      confidenceValue: 0,
      evidenceCount: 0,
    });
  });

  it('mais achados confirmados não reduzem confiança; ODS 13 mantém teto estrutural baixo', () => {
    const one = scoreOdsEvidences(15, [ibama('one')]);
    const two = scoreOdsEvidences(15, [ibama('one'), ibama('two')]);
    expect(two.confidenceValue).toBeGreaterThanOrEqual(one.confidenceValue);
    expect(
      scoreOdsEvidences(13, [ghg('one'), ghg('two')]).confidenceValue,
    ).toBeLessThan(0.25);
    expect(
      scoreOdsEvidences(13, [
        ghg('one'),
        { ...ghg('unknown'), state: EvidenceState.UNKNOWN },
      ]).confidenceValue,
    ).toBeLessThan(scoreOdsEvidences(13, [ghg('one')]).confidenceValue);
  });

  it('ordem da coleta não muda as contribuições nem altera a entrada', () => {
    const rows = [cgu('z'), ibama('b'), cgu('a')];
    const before = structuredClone(rows);
    expect(scoreOdsEvidences(15, rows)).toEqual(
      scoreOdsEvidences(15, [...rows].reverse()),
    );
    expect(rows).toEqual(before);
  });
});
