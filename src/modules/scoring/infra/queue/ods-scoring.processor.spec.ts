import { Test } from '@nestjs/testing';
import { type Job, UnrecoverableError } from 'bullmq';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { ScoringNotConfiguredError } from '../../domain/dtos/errors/scoring-not-configured.error.js';
import {
  RECALCULATE_SCORES_JOB,
  RECALCULATE_STALE_SCORES_JOB,
} from '../../domain/ods-scoring-job.dto.js';
import { CalculateCompanyOdsScoresUseCase } from '../usecases/calculate-company-ods-scores.usecase.js';
import { RecalculateStaleScoresUseCase } from '../usecases/recalculate-stale-scores.usecase.js';
import { OdsScoringProcessor } from './ods-scoring.processor.js';

describe('OdsScoringProcessor', () => {
  const calculate = {
    execute: vi.fn<CalculateCompanyOdsScoresUseCase['execute']>(),
  };
  const stale = { execute: vi.fn<RecalculateStaleScoresUseCase['execute']>() };
  const cache = {
    delete: vi.fn<CacheProvider['delete']>(),
    invalidate: vi.fn<CacheProvider['invalidate']>(),
  };
  const cnpj = buildCnpj();
  let processor: OdsScoringProcessor;

  const job = (name: string, data: unknown) => ({ name, data }) as Job<unknown>;

  beforeEach(async () => {
    calculate.execute.mockResolvedValue([{}, {}] as never);
    stale.execute.mockResolvedValue({ requested: 7 });
    cache.delete.mockResolvedValue(undefined);
    cache.invalidate.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        OdsScoringProcessor,
        { provide: CalculateCompanyOdsScoresUseCase, useValue: calculate },
        { provide: RecalculateStaleScoresUseCase, useValue: stale },
        { provide: CacheProvider, useValue: cache },
      ],
    }).compile();

    processor = moduleRef.get(OdsScoringProcessor);
  });

  describe('recalculate-scores', () => {
    it('recalcula o CNPJ, invalida o cache dele e devolve quantos ODS foram calculados', async () => {
      const result = await processor.process(
        job(RECALCULATE_SCORES_JOB, { cnpj }),
      );

      expect(calculate.execute).toHaveBeenCalledExactlyOnceWith(cnpj);
      expect(cache.delete.mock.calls.map(([key]) => key)).toEqual([
        { namespace: CacheNamespace.COMPANY_PROFILE, identifier: cnpj },
        { namespace: CacheNamespace.COMPANY_EVIDENCES, identifier: cnpj },
        { namespace: CacheNamespace.COMPANY_SCORES, identifier: cnpj },
      ]);
      expect(result).toEqual({ status: 'CALCULATED', odsCount: 2 });
    });

    it('não apaga os retratos das fontes (CGU, GHG): eles não dependem do índice', async () => {
      await processor.process(job(RECALCULATE_SCORES_JOB, { cnpj }));

      const namespaces = cache.delete.mock.calls.map(([key]) => key.namespace);
      expect(namespaces).not.toContain(CacheNamespace.CGU_CEIS);
      expect(namespaces).not.toContain(CacheNamespace.CGU_CNEP);
      expect(namespaces).not.toContain(CacheNamespace.GHG_INVENTORY);
      expect(cache.invalidate).not.toHaveBeenCalled();
    });

    it('só invalida o cache depois de recalcular (nunca serve o índice velho como novo)', async () => {
      const order: string[] = [];
      calculate.execute.mockImplementation(() => {
        order.push('calcula');

        return Promise.resolve([]);
      });
      cache.delete.mockImplementation(() => {
        order.push('invalida');

        return Promise.resolve();
      });

      await processor.process(job(RECALCULATE_SCORES_JOB, { cnpj }));

      expect(order[0]).toBe('calcula');
      expect(order.slice(1).every((step) => step === 'invalida')).toBe(true);
      expect(order).toHaveLength(4);
    });

    it('falha do cálculo propaga (o BullMQ repete) e não invalida o cache', async () => {
      calculate.execute.mockRejectedValue(new Error('banco fora'));

      await expect(
        processor.process(job(RECALCULATE_SCORES_JOB, { cnpj })),
      ).rejects.toThrow('banco fora');

      expect(cache.delete).not.toHaveBeenCalled();
    });

    it('ambiente sem ODS ou sem regras é irrecuperável: sem tentativas de repetição', async () => {
      calculate.execute.mockRejectedValue(
        new ScoringNotConfiguredError(
          'Nenhum ODS ativo para calcular índices.',
        ),
      );

      const failure = processor.process(job(RECALCULATE_SCORES_JOB, { cnpj }));

      await expect(failure).rejects.toBeInstanceOf(UnrecoverableError);
      await expect(failure).rejects.toThrow('Nenhum ODS ativo');
    });

    it.each([
      ['sem CNPJ', {}],
      ['CNPJ não canônico', { cnpj: '11.222.333/0001-81' }],
      ['campo a mais', { cnpj, extra: true }],
      ['sem carga', null],
    ])(
      'job fora do contrato (%s) é irrecuperável e não calcula nada',
      async (_c, data) => {
        await expect(
          processor.process(job(RECALCULATE_SCORES_JOB, data)),
        ).rejects.toBeInstanceOf(UnrecoverableError);

        expect(calculate.execute).not.toHaveBeenCalled();
      },
    );
  });

  describe('recalculate-stale-scores', () => {
    it('sem carga, dispara a varredura por versão de regras', async () => {
      await expect(
        processor.process(job(RECALCULATE_STALE_SCORES_JOB, undefined)),
      ).resolves.toEqual({ requested: 7 });
      await processor.process(job(RECALCULATE_STALE_SCORES_JOB, {}));

      expect(stale.execute).toHaveBeenCalledTimes(2);
      expect(calculate.execute).not.toHaveBeenCalled();
    });

    it('carga qualquer é fora do contrato: irrecuperável', async () => {
      await expect(
        processor.process(job(RECALCULATE_STALE_SCORES_JOB, { cnpj })),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      expect(stale.execute).not.toHaveBeenCalled();
    });

    it('falha da varredura propaga, para o BullMQ repetir', async () => {
      stale.execute.mockRejectedValue(new Error('fila fora'));

      await expect(
        processor.process(job(RECALCULATE_STALE_SCORES_JOB, {})),
      ).rejects.toThrow('fila fora');
    });
  });

  it('job de nome desconhecido é irrecuperável', async () => {
    await expect(
      processor.process(job('outro-job', { cnpj })),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(calculate.execute).not.toHaveBeenCalled();
    expect(stale.execute).not.toHaveBeenCalled();
  });
});
