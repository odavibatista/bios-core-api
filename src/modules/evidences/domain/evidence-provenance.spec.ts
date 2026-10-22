import { EvidenceState } from '@prisma/client';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import {
  EvidenceSourceUrlSchema,
  projectEvidenceProvenance,
} from './evidence-provenance.js';
import {
  CompanyEnvironmentalEvidencesResponseSchema,
  groupCompanyEvidences,
} from './company-environmental-evidences.dto.js';
describe('proveniência auditável RF09', () => {
  const cnpj = buildCnpj();
  const row = (over: Parameters<typeof storedEvidenceFactory.build>[0] = {}) =>
    storedEvidenceFactory.build(over);
  const project = (
    over: Parameters<typeof storedEvidenceFactory.build>[0] = {},
  ) =>
    groupCompanyEvidences(cnpj, [row(over)]).categories.flatMap(
      (g) => g.evidences,
    )[0];
  it('expõe o nome público do catálogo e mantém identificador/link/datas', () => {
    const e = row();
    const projected = groupCompanyEvidences(cnpj, [e]).categories.flatMap(
      (g) => g.evidences,
    )[0];
    expect(projected).toMatchObject({
      source: e.sourceName,
      source_slug: e.sourceSlug,
      source_reference: e.sourceReference,
      source_url: e.sourceUrl,
      state: 'CONFIRMED',
      collected_at: e.collectedAt.toISOString(),
      valid_until: e.validUntil.toISOString(),
    });
  });
  it.each([
    'http://ibama.gov.br/a',
    '/relative',
    'javascript:alert(1)',
    'https://',
    'not a URL',
    'https://user:secret@ibama.gov.br/a',
  ])('schema recusa URL insegura ou não absoluta %s', (sourceUrl) => {
    expect(EvidenceSourceUrlSchema.safeParse(sourceUrl).success).toBe(false);
    const valid = groupCompanyEvidences(cnpj, [row()]);
    valid.categories[0].evidences[0].source_url = sourceUrl;
    expect(
      CompanyEnvironmentalEvidencesResponseSchema.safeParse(valid).success,
    ).toBe(false);
  });
  it('URL nula não é preenchida com um endereço suposto quando há identificador', () => {
    expect(
      project({ sourceUrl: null, sourceReference: '  AI-42  ' }),
    ).toMatchObject({
      source_reference: 'AI-42',
      source_url: null,
      state: 'CONFIRMED',
    });
  });
  it('link HTTPS original basta para rastrear quando o identificador não foi informado', () => {
    expect(
      project({
        sourceReference: null,
        sourceUrl:
          'https://dadosabertos.ibama.gov.br/dataset/fiscalizacao-auto-de-infracao',
      }),
    ).toMatchObject({
      state: 'CONFIRMED',
      source_reference: null,
      source_url:
        'https://dadosabertos.ibama.gov.br/dataset/fiscalizacao-auto-de-infracao',
    });
  });
  it.each([null, '', '   '])(
    'CONFIRMED sem referência/link vira UNKNOWN neutro na projeção (%s)',
    (sourceReference) => {
      const e = row({ sourceReference, sourceUrl: null });
      const before = structuredClone(e);
      expect(projectEvidenceProvenance(e)).toMatchObject({
        state: EvidenceState.UNKNOWN,
        sourceReference: null,
        sourceUrl: null,
        summary: null,
        details: null,
      });
      expect(
        groupCompanyEvidences(cnpj, [e]).categories.flatMap(
          (g) => g.evidences,
        )[0],
      ).toMatchObject({
        state: 'UNKNOWN',
        signal: null,
        summary: null,
        details: null,
      });
      expect(e).toEqual(before);
    },
  );
  it('URL inválida sem identificador não sustenta confirmação', () => {
    expect(
      project({ sourceReference: null, sourceUrl: 'http://ibama.gov.br/a' }),
    ).toMatchObject({ state: 'UNKNOWN', source_url: null, signal: null });
  });
  it('URL inválida é removida mesmo com referência válida, sem descartar o identificador', () => {
    expect(
      project({ sourceReference: 'AI-42', sourceUrl: 'javascript:alert(1)' }),
    ).toMatchObject({
      state: 'CONFIRMED',
      source_url: null,
      source_reference: 'AI-42',
    });
  });
  it.each(['UNKNOWN', 'NOT_FOUND', 'OUTDATED'] as const)(
    'preserva %s sem forjar proveniência',
    (state) => {
      expect(
        project({ state, sourceReference: null, sourceUrl: null }),
      ).toMatchObject({
        state,
        signal: null,
        source_reference: null,
        source_url: null,
      });
    },
  );
  it('schema recusa CONFIRMED sem nenhum caminho de auditoria', () => {
    const response = groupCompanyEvidences(cnpj, [row()]);
    const e = response.categories[0].evidences[0];
    e.source_reference = null;
    e.source_url = null;
    expect(
      CompanyEnvironmentalEvidencesResponseSchema.safeParse(response).success,
    ).toBe(false);
  });
});
