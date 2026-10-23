import { EvidenceCategory, EvidenceState } from '@prisma/client';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import {
  CompanyEnvironmentalEvidencesRequestSchema,
  CompanyEnvironmentalEvidencesResponseSchema,
  groupCompanyEvidences,
} from './company-environmental-evidences.dto.js';
describe('contratos de consolidacao ambiental', () => {
  const cnpj = buildCnpj();
  it('canonicaliza entrada e recusa CNPJ invalido e extras', () => {
    const formatted = cnpj.replace(
      /^(..)(...)(...)(....)(..)$/,
      '$1.$2.$3/$4-$5',
    );
    expect(
      CompanyEnvironmentalEvidencesRequestSchema.parse({ cnpj: formatted }),
    ).toEqual({ cnpj });
    for (const value of [{ cnpj: 'invalido' }, { cnpj, other: true }])
      expect(
        CompanyEnvironmentalEvidencesRequestSchema.safeParse(value).success,
      ).toBe(false);
  });
  it('agrupa categorias, ordena por fonte/chave e mantem referencia e datas', () => {
    const a = storedEvidenceFactory.build({
      cnpj,
      sourceSlug: 'CGU_CEIS',
      category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
      key: 'a',
    });
    const b = storedEvidenceFactory.build({ ...a, key: 'b' });
    const c = storedEvidenceFactory.build({ ...a, sourceSlug: 'CGU_CNEP' });
    const result = groupCompanyEvidences(cnpj, [
      c,
      b,
      a,
      storedEvidenceFactory.build({ sourceSlug: 'OTHER' }),
    ]);
    expect(result.categories).toHaveLength(3);
    const rows = result.categories.find(
      (g) => g.category === EvidenceCategory.CONDUTA_ADMINISTRATIVA,
    )!.evidences;
    expect(rows.map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(rows[0]).toMatchObject({
      source_slug: a.sourceSlug,
      signal: a.signal,
      source_url: a.sourceUrl,
      source_reference: a.sourceReference,
      published_at: a.publishedAt!.toISOString(),
      collected_at: a.collectedAt.toISOString(),
      valid_until: a.validUntil.toISOString(),
      details: a.details,
    });
    expect(
      result.categories.find(
        (g) => g.category === EvidenceCategory.INFRACAO_AMBIENTAL,
      )!.evidences,
    ).toEqual([]);
    expect(
      CompanyEnvironmentalEvidencesResponseSchema.safeParse({
        ...result,
        score: 100,
      }).success,
    ).toBe(false);
  });
  it.each([
    EvidenceState.UNKNOWN,
    EvidenceState.NOT_FOUND,
    EvidenceState.OUTDATED,
  ])('estado %s nao comunica sinal nem cria data publicada', (state) => {
    const e = storedEvidenceFactory.build({ state, publishedAt: null });
    const row = groupCompanyEvidences(cnpj, [e]).categories.flatMap(
      (g) => g.evidences,
    )[0];
    expect(row).toMatchObject({ state, signal: null, published_at: null });
  });
});
