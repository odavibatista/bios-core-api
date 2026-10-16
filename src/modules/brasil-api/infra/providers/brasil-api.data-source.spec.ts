import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import { SourceOutcome } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { brasilApiCnpjFactory } from '@test/factories/data-sources/brasil-api-cnpj.factory.js';
import {
  BRASIL_API_SLUG,
  BrasilApiDataSource,
} from './brasil-api.data-source.js';

const CNPJ = '11222333000181';
const context = { trigger: RequestTrigger.ON_DEMAND_JOB };

describe('BrasilApiDataSource', () => {
  const requestDataSource = { execute: vi.fn() };
  let dataSource: BrasilApiDataSource;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BrasilApiDataSource,
        { provide: RequestDataSourceUseCase, useValue: requestDataSource },
      ],
    }).compile();

    dataSource = moduleRef.get(BrasilApiDataSource);
  });

  it('se identifica pelo slug do catálogo', () => {
    expect(dataSource.slug).toBe('BRASIL_API');
    expect(BRASIL_API_SLUG).toBe('BRASIL_API');
  });

  it('consulta o CNPJ como segmento do caminho, registrando-o no log', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.NOT_FOUND,
      status: 404,
    });

    await dataSource.fetch(CNPJ, context);

    expect(requestDataSource.execute).toHaveBeenCalledWith({
      slug: 'BRASIL_API',
      segments: [CNPJ],
      cnpj: CNPJ,
      context,
    });
  });

  it('devolve o cadastro normalizado quando a fonte responde', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.SUCCESS,
      status: 200,
      body: brasilApiCnpjFactory.build({ razao_social: 'ACME LTDA' }),
    });

    const result = await dataSource.fetch(CNPJ, context);

    expect(result).toMatchObject({
      status: 'FOUND',
      data: { cnpj: CNPJ, legalName: 'ACME LTDA', registrationStatus: 'ATIVA' },
    });
  });

  it('a resposta de outro CNPJ é indisponibilidade, não dado', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.SUCCESS,
      status: 200,
      body: brasilApiCnpjFactory.build({ cnpj: '00000000000191' }),
    });

    await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      reason: SourceOutcome.FAILURE,
    });
  });

  it('corpo fora do formato é indisponibilidade', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.SUCCESS,
      status: 200,
      body: { message: 'manutenção' },
    });

    await expect(dataSource.fetch(CNPJ, context)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
    });
  });

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

  it('propaga o erro de programação (fonte fora do catálogo)', async () => {
    requestDataSource.execute.mockRejectedValue(new Error('fonte inexistente'));

    await expect(dataSource.fetch(CNPJ, context)).rejects.toThrow(
      'fonte inexistente',
    );
  });
});
