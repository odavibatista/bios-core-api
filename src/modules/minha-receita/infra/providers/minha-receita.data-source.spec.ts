import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import { SourceOutcome } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { receitaOpenDataCnpjFactory } from '@test/factories/data-sources/receita-open-data-cnpj.factory.js';
import {
  MINHA_RECEITA_SLUG,
  MinhaReceitaDataSource,
} from './minha-receita.data-source.js';

const CNPJ = '11222333000181';
const context = { trigger: RequestTrigger.ON_DEMAND_JOB };

describe('MinhaReceitaDataSource', () => {
  const requestDataSource = { execute: vi.fn() };
  let dataSource: MinhaReceitaDataSource;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MinhaReceitaDataSource,
        { provide: RequestDataSourceUseCase, useValue: requestDataSource },
      ],
    }).compile();

    dataSource = moduleRef.get(MinhaReceitaDataSource);
  });

  it('se identifica pelo slug do catálogo', () => {
    expect(dataSource.slug).toBe('MINHA_RECEITA');
    expect(MINHA_RECEITA_SLUG).toBe('MINHA_RECEITA');
  });

  it('consulta o CNPJ como segmento do caminho, registrando-o no log', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.NOT_FOUND,
      status: 404,
    });

    await dataSource.fetch(CNPJ, context);

    expect(requestDataSource.execute).toHaveBeenCalledWith({
      slug: 'MINHA_RECEITA',
      segments: [CNPJ],
      cnpj: CNPJ,
      context,
    });
  });

  it('devolve o cadastro normalizado quando a fonte responde', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.SUCCESS,
      status: 200,
      body: receitaOpenDataCnpjFactory.build({ razao_social: 'ACME LTDA' }),
    });

    await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
      status: 'FOUND',
      data: { cnpj: CNPJ, legalName: 'ACME LTDA', registrationStatus: 'ATIVA' },
    });
  });

  it.each([
    ['de outro CNPJ', { cnpj: '00000000000191' }],
    ['sem razão social', { razao_social: null }],
    ['sem UF', { uf: null }],
  ])(
    'resposta %s é indisponibilidade, não dado',
    async (_case, overrides: Record<string, unknown>) => {
      requestDataSource.execute.mockResolvedValue({
        outcome: SourceOutcome.SUCCESS,
        status: 200,
        body: { ...receitaOpenDataCnpjFactory.build(), ...overrides },
      });

      await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: SourceOutcome.FAILURE,
      });
    },
  );

  it('404 é "não encontrado": a Receita não conhece o CNPJ', async () => {
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
