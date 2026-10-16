import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import { SourceOutcome } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { openCnpjFactory } from '@test/factories/data-sources/opencnpj-cnpj.factory.js';
import { OPEN_CNPJ_SLUG, OpenCnpjDataSource } from './opencnpj.data-source.js';

const CNPJ = '11222333000181';
const context = { trigger: RequestTrigger.ON_DEMAND_JOB };

describe('OpenCnpjDataSource', () => {
  const requestDataSource = { execute: vi.fn() };
  let dataSource: OpenCnpjDataSource;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OpenCnpjDataSource,
        { provide: RequestDataSourceUseCase, useValue: requestDataSource },
      ],
    }).compile();

    dataSource = moduleRef.get(OpenCnpjDataSource);
  });

  it('se identifica pelo slug do catálogo', () => {
    expect(dataSource.slug).toBe('OPEN_CNPJ');
    expect(OPEN_CNPJ_SLUG).toBe('OPEN_CNPJ');
  });

  it('consulta o CNPJ como segmento do caminho, registrando-o no log', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.NOT_FOUND,
      status: 404,
    });

    await dataSource.fetch(CNPJ, context);

    expect(requestDataSource.execute).toHaveBeenCalledWith({
      slug: 'OPEN_CNPJ',
      segments: [CNPJ],
      cnpj: CNPJ,
      context,
    });
  });

  it('devolve o cadastro normalizado quando a fonte responde', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.SUCCESS,
      status: 200,
      body: openCnpjFactory.build({ razao_social: 'ACME LTDA' }),
    });

    await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
      status: 'FOUND',
      data: { cnpj: CNPJ, legalName: 'ACME LTDA', registrationStatus: 'ATIVA' },
    });
  });

  it.each([
    ['de outro CNPJ', { cnpj: '00000000000191' }],
    ['anonimizada', { lgpd_anonimizado: true }],
    ['sem razão social', { razao_social: null }],
  ])(
    'resposta %s é indisponibilidade, não dado',
    async (_case, overrides: Record<string, unknown>) => {
      requestDataSource.execute.mockResolvedValue({
        outcome: SourceOutcome.SUCCESS,
        status: 200,
        body: { ...openCnpjFactory.build(), ...overrides },
      });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: SourceOutcome.FAILURE,
      });
    },
  );

  it('404 é "não encontrado"', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.NOT_FOUND,
      status: 404,
    });

    await expect(dataSource.fetch(CNPJ, context)).resolves.toEqual({
      status: 'NOT_FOUND',
    });
  });

  it.each([
    SourceOutcome.FAILURE,
    SourceOutcome.TIMEOUT,
    SourceOutcome.RATE_LIMITED,
  ] as const)(
    '%s deixa a fonte indisponível, com o motivo',
    async (outcome) => {
      requestDataSource.execute.mockResolvedValue({
        outcome,
        message: 'detalhe',
      });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toEqual({
        status: 'UNAVAILABLE',
        reason: outcome,
        message: 'detalhe',
      });
    },
  );

  it('fonte desabilitada fica indisponível', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.DISABLED,
    });

    await expect(dataSource.fetch(CNPJ, context)).resolves.toEqual({
      status: 'UNAVAILABLE',
      reason: SourceOutcome.DISABLED,
    });
  });
});
