import { Test } from '@nestjs/testing';
import { type Job, UnrecoverableError } from 'bullmq';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { FETCH_COMPANY_PROFILE_JOB } from '../../domain/dtos/providers/company-profile-job.dto.js';
import { RefreshCompanyProfileUseCase } from '../usecases/refresh-company-profile.usecase.js';
import { CompanyProfileProcessor } from './company-profile.processor.js';

const CNPJ = '11222333000181';

function buildJob(
  data: unknown,
  name: string = FETCH_COMPANY_PROFILE_JOB,
  attemptsMade = 0,
): Job<unknown> {
  return { name, data, attemptsMade } as unknown as Job<unknown>;
}

describe('CompanyProfileProcessor', () => {
  const refresh = { execute: vi.fn() };
  let processor: CompanyProfileProcessor;

  beforeEach(async () => {
    refresh.execute.mockResolvedValue({ outcome: 'FOUND' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        CompanyProfileProcessor,
        { provide: RefreshCompanyProfileUseCase, useValue: refresh },
      ],
    }).compile();

    processor = moduleRef.get(CompanyProfileProcessor);
  });

  it('atende a fila company-profile', () => {
    expect(QueueName.COMPANY_PROFILE).toBe('company-profile');
    expect(
      Reflect.getMetadata('bullmq:processor_metadata', CompanyProfileProcessor),
    ).toMatchObject({ name: 'company-profile' });
  });

  it('atualiza o cadastro do CNPJ do job e devolve o resultado ao contrato da fila', async () => {
    refresh.execute.mockResolvedValue({ outcome: 'NOT_FOUND' });

    await expect(processor.process(buildJob({ cnpj: CNPJ }))).resolves.toEqual({
      outcome: 'NOT_FOUND',
    });

    expect(refresh.execute).toHaveBeenCalledWith(CNPJ);
  });

  describe('job malformado: falha sem repetição', () => {
    it('nome de job desconhecido', async () => {
      await expect(
        processor.process(buildJob({ cnpj: CNPJ }, 'outra-coisa')),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      expect(refresh.execute).not.toHaveBeenCalled();
    });

    it.each([
      ['sem payload', undefined],
      ['payload que não é objeto', 'texto'],
      ['sem CNPJ', {}],
      ['CNPJ que não é texto', { cnpj: 11222333000181 }],
      ['CNPJ inválido', { cnpj: '11222333000182' }],
      ['CNPJ com máscara (não canônico)', { cnpj: '11.222.333/0001-81' }],
      ['CNPJ em minúsculas (não canônico)', { cnpj: '12abc34501de35' }],
    ])('%s', async (_case, data) => {
      await expect(processor.process(buildJob(data))).rejects.toBeInstanceOf(
        UnrecoverableError,
      );

      expect(refresh.execute).not.toHaveBeenCalled();
    });
  });

  describe('falha ao atualizar: propaga, para a fila repetir', () => {
    it('devolve o mesmo erro, que não é "sem repetição"', async () => {
      const failure = new Error('banco fora');
      refresh.execute.mockRejectedValue(failure);

      const attempt = processor.process(buildJob({ cnpj: CNPJ }, undefined, 1));

      await expect(attempt).rejects.toBe(failure);
      await expect(attempt).rejects.not.toBeInstanceOf(UnrecoverableError);
    });

    it('trata falha que não é Error', async () => {
      refresh.execute.mockRejectedValue('texto solto');

      await expect(processor.process(buildJob({ cnpj: CNPJ }))).rejects.toBe(
        'texto solto',
      );
    });
  });
});
