import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import {
  COMPANY_PROFILE_JOB_DEDUP_WINDOW_SECONDS,
  CompanyProfileJobResultSchema,
  companyProfileJobId,
} from './company-profile-job.dto.js';

describe('CompanyProfileJobResultSchema', () => {
  it.each(['FOUND', 'NOT_FOUND', 'SOURCES_UNAVAILABLE'])(
    'aceita o resultado %s',
    (outcome) => {
      expect(CompanyProfileJobResultSchema.safeParse({ outcome }).success).toBe(
        true,
      );
    },
  );

  it.each([
    undefined,
    null,
    'FOUND',
    {},
    { outcome: 'found' },
    { outcome: 'ERROR' },
    { outcome: 1 },
  ])('recusa o resultado fora do contrato %j', (result) => {
    expect(CompanyProfileJobResultSchema.safeParse(result).success).toBe(false);
  });
});

describe('companyProfileJobId', () => {
  const cnpj = buildCnpj();
  const windowMs = COMPANY_PROFILE_JOB_DEDUP_WINDOW_SECONDS * 1_000;
  const start = new Date(Math.floor(Date.now() / windowMs) * windowMs);

  it('pedidos do mesmo CNPJ na mesma janela caem no mesmo job', () => {
    const later = new Date(start.getTime() + windowMs - 1);

    expect(companyProfileJobId(cnpj, start)).toBe(
      companyProfileJobId(cnpj, later),
    );
  });

  it('na janela seguinte o job é outro, para que uma falha não bloqueie o CNPJ para sempre', () => {
    const next = new Date(start.getTime() + windowMs);

    expect(companyProfileJobId(cnpj, start)).not.toBe(
      companyProfileJobId(cnpj, next),
    );
  });

  it('CNPJs diferentes nunca compartilham job', () => {
    expect(companyProfileJobId('11222333000181', start)).not.toBe(
      companyProfileJobId('33000167000101', start),
    );
  });

  it('não usa ":", que o BullMQ não aceita em identificador', () => {
    expect(companyProfileJobId(cnpj, start)).not.toContain(':');
  });

  it('usa o relógio atual quando não recebe a data', () => {
    expect(companyProfileJobId(cnpj)).toMatch(
      new RegExp(`^company-profile-${cnpj}-\\d+$`),
    );
  });
});
