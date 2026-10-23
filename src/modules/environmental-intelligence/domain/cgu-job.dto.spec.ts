import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { CguJobSchema, cguJobId } from './cgu-job.dto.js';

describe('contrato do job da CGU', () => {
  const cnpj = buildCnpj();

  it('exige o CNPJ canônico e recusa campos extras', () => {
    const formatted = cnpj.replace(
      /^(..)(...)(...)(....)(..)$/,
      '$1.$2.$3/$4-$5',
    );

    expect(CguJobSchema.safeParse({ cnpj }).success).toBe(true);
    expect(CguJobSchema.safeParse({ cnpj: formatted }).success).toBe(false);
    expect(CguJobSchema.safeParse({ cnpj, other: true }).success).toBe(false);
  });

  it('deduplica jobs por CNPJ/janela de 15 minutos', () => {
    expect(cguJobId(cnpj, new Date(0))).toBe(`cgu-${cnpj}-0`);
    expect(cguJobId(cnpj, new Date(899999))).toBe(cguJobId(cnpj, new Date(0)));
    expect(cguJobId(cnpj, new Date(900000))).not.toBe(
      cguJobId(cnpj, new Date(0)),
    );
  });
});
