import { RequestTrigger } from '@prisma/client';
import { SourceOutcome } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import type { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { ViaCepDataSource } from './viacep.data-source.js';

const context = { trigger: RequestTrigger.USER_QUERY };
const BODY = {
  cep: '01310-200',
  logradouro: 'Avenida Paulista',
  bairro: 'Bela Vista',
  localidade: 'São Paulo',
  uf: 'SP',
  ibge: '3550308',
};

describe('ViaCepDataSource', () => {
  const requestDataSource = { execute: vi.fn() };
  const dataSource = new ViaCepDataSource(
    requestDataSource as unknown as RequestDataSourceUseCase,
  );

  beforeEach(() => {
    requestDataSource.execute.mockReset();
  });

  it('consulta só o CEP, sem nenhum dado da conta', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.SUCCESS,
      status: 200,
      body: BODY,
    });

    const result = await dataSource.fetch('01310-200', context);

    expect(requestDataSource.execute).toHaveBeenCalledWith({
      slug: 'VIACEP',
      segments: ['01310200', 'json'],
      context,
    });
    expect(result).toMatchObject({
      status: 'FOUND',
      data: { street: 'Avenida Paulista', cityIbgeCode: '3550308' },
    });
  });

  it('CEP fora do formato não chama a fonte', async () => {
    await expect(dataSource.fetch('123', context)).resolves.toEqual({
      status: 'NOT_FOUND',
    });
    expect(requestDataSource.execute).not.toHaveBeenCalled();
  });

  it('entende a resposta de CEP inexistente', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.SUCCESS,
      status: 200,
      body: { erro: 'true' },
    });

    await expect(dataSource.fetch('99999999', context)).resolves.toEqual({
      status: 'NOT_FOUND',
    });
  });

  it('resposta fora do formato vale como fonte indisponível', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.SUCCESS,
      status: 200,
      body: { cep: 'outro' },
    });

    await expect(dataSource.fetch('01310200', context)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
    });
  });

  it.each([SourceOutcome.TIMEOUT, SourceOutcome.FAILURE])(
    'fonte com %s fica indisponível, sem exceção',
    async (outcome) => {
      requestDataSource.execute.mockResolvedValue({
        outcome,
        message: 'falhou',
      });

      await expect(
        dataSource.fetch('01310200', context),
      ).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: outcome });
    },
  );
});
