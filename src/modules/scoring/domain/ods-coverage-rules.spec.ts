import { EvidenceCategory, EvidenceState } from '@prisma/client';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { summarizeOdsCoverage } from './ods-coverage-rules.js';

describe('summarizeOdsCoverage', () => {
  const now = new Date('2026-10-22T12:00:00.000Z');
  const future = new Date('2026-11-22T12:00:00.000Z');
  const past = new Date('2026-09-01T12:00:00.000Z');
  const build = (
    sourceSlug: string,
    category: EvidenceCategory,
    state: EvidenceState,
    validUntil = future,
  ) =>
    storedEvidenceFactory.build({
      odsNumber: 15,
      sourceSlug,
      category,
      state,
      validUntil,
    });
  const ibama = (state: EvidenceState, validUntil = future) =>
    build('IBAMA', EvidenceCategory.INFRACAO_AMBIENTAL, state, validUntil);
  const ceis = (state: EvidenceState, validUntil = future) =>
    build(
      'CGU_CEIS',
      EvidenceCategory.CONDUTA_ADMINISTRATIVA,
      state,
      validUntil,
    );
  const cnep = (state: EvidenceState, validUntil = future) =>
    build(
      'CGU_CNEP',
      EvidenceCategory.CONDUTA_ADMINISTRATIVA,
      state,
      validUntil,
    );

  it('marca ausência confirmada em todas as fontes do ODS 15', () => {
    expect(
      summarizeOdsCoverage(
        15,
        [
          ibama(EvidenceState.NOT_FOUND),
          ceis(EvidenceState.NOT_FOUND),
          cnep(EvidenceState.NOT_FOUND),
        ],
        0,
        now,
      ),
    ).toEqual({
      coverageStatus: 'NO_RECORDS_IN_ALL_SOURCES',
      sourcesWithoutRecords: ['IBAMA', 'CGU_CEIS', 'CGU_CNEP'],
    });
  });

  it('marca ausência parcial quando outra fonte está inconclusiva', () => {
    expect(
      summarizeOdsCoverage(
        15,
        [
          ibama(EvidenceState.NOT_FOUND),
          ceis(EvidenceState.UNKNOWN),
          cnep(EvidenceState.NOT_FOUND),
        ],
        0,
        now,
      ),
    ).toEqual({
      coverageStatus: 'NO_RECORDS_IN_SOME_SOURCES',
      sourcesWithoutRecords: ['IBAMA', 'CGU_CNEP'],
    });
  });

  it('não conta ausência vencida nem fonte sem resposta', () => {
    expect(
      summarizeOdsCoverage(
        15,
        [ibama(EvidenceState.NOT_FOUND, past), ceis(EvidenceState.UNKNOWN)],
        0,
        now,
      ),
    ).toEqual({ coverageStatus: 'NO_DATA', sourcesWithoutRecords: [] });
    expect(summarizeOdsCoverage(15, [], 0, now)).toEqual({
      coverageStatus: 'NO_DATA',
      sourcesWithoutRecords: [],
    });
  });

  it('com contribuição o status é HAS_RECORDS e lista só as fontes sem registro', () => {
    expect(
      summarizeOdsCoverage(
        15,
        [
          ibama(EvidenceState.CONFIRMED),
          ceis(EvidenceState.NOT_FOUND),
          cnep(EvidenceState.NOT_FOUND),
        ],
        1,
        now,
      ),
    ).toEqual({
      coverageStatus: 'HAS_RECORDS',
      sourcesWithoutRecords: ['CGU_CEIS', 'CGU_CNEP'],
    });
  });

  it('fonte com achado confirmado vigente não é "sem registros"', () => {
    expect(
      summarizeOdsCoverage(
        15,
        [ibama(EvidenceState.NOT_FOUND), ibama(EvidenceState.CONFIRMED)],
        1,
        now,
      ).sourcesWithoutRecords,
    ).toEqual([]);
  });

  it('ignora fonte fora do ODS e recusa ODS sem regras', () => {
    expect(
      summarizeOdsCoverage(
        13,
        [
          build(
            'GHG_PROTOCOL',
            EvidenceCategory.EMISSAO_GEE,
            EvidenceState.NOT_FOUND,
          ),
          ibama(EvidenceState.NOT_FOUND),
        ],
        0,
        now,
      ),
    ).toEqual({
      coverageStatus: 'NO_RECORDS_IN_ALL_SOURCES',
      sourcesWithoutRecords: ['GHG_PROTOCOL'],
    });
    expect(() => summarizeOdsCoverage(99, [], 0, now)).toThrow(/sem regras/);
  });
});
