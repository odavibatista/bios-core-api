import {
  IBAMA_CNPJ,
  IBAMA_CNPJ_MASKED,
  IBAMA_OTHER_CNPJ,
} from '@test/factories/ibama/ibama-dump.factory.js';
import { faker } from '@test/support/faker.js';
import {
  IbamaCompanyJobPayloadSchema,
  ibamaCompanyJobId,
} from './ibama-company-job.dto.js';

describe('contrato do job IBAMA por CNPJ', () => {
  it('aceita CNPJ canonico e recusa mascara, DV invalido e payload vazio', () => {
    expect(
      IbamaCompanyJobPayloadSchema.safeParse({ cnpj: IBAMA_CNPJ }).success,
    ).toBe(true);
    for (const payload of [
      { cnpj: IBAMA_CNPJ_MASKED },
      { cnpj: '11222333000182' },
      {},
      null,
    ]) {
      expect(IbamaCompanyJobPayloadSchema.safeParse(payload).success).toBe(
        false,
      );
    }
  });
  it('deduplica por CNPJ e janela de 15 minutos com id aceito pelo BullMQ', () => {
    const boundary =
      Math.floor(faker.date.recent().getTime() / 900000) * 900000;
    const id = ibamaCompanyJobId(IBAMA_CNPJ, new Date(boundary));
    expect(ibamaCompanyJobId(IBAMA_CNPJ, new Date(boundary + 899999))).toBe(id);
    expect(ibamaCompanyJobId(IBAMA_CNPJ, new Date(boundary + 900000))).not.toBe(
      id,
    );
    expect(ibamaCompanyJobId(IBAMA_OTHER_CNPJ, new Date(boundary))).not.toBe(
      id,
    );
    expect(id).not.toContain(':');
    expect(ibamaCompanyJobId(IBAMA_CNPJ)).toMatch(/^ibama-cnpj-/);
  });
});
