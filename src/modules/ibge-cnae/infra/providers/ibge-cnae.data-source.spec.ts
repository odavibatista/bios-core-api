import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import { SourceOutcome } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { ibgeCnaeSubclassFactory } from '@test/factories/data-sources/ibge-cnae.factory.js';
import { IBGE_CNAE_SLUG, IbgeCnaeDataSource } from './ibge-cnae.data-source.js';

const CODE = '6201501';
const context = { trigger: RequestTrigger.ON_DEMAND_JOB };

describe('IbgeCnaeDataSource', () => {
  const requestDataSource = { execute: vi.fn() };
  let dataSource: IbgeCnaeDataSource;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IbgeCnaeDataSource,
        { provide: RequestDataSourceUseCase, useValue: requestDataSource },
      ],
    }).compile();

    dataSource = moduleRef.get(IbgeCnaeDataSource);
  });

  it('se identifica pelo slug do catálogo', () => {
    expect(dataSource.slug).toBe('IBGE_CNAE');
    expect(IBGE_CNAE_SLUG).toBe('IBGE_CNAE');
  });

  it('consulta a subclasse pelo código, sem CNPJ no log (a consulta é da taxonomia)', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.NOT_FOUND,
      status: 404,
    });

    await dataSource.fetch(CODE, context);

    expect(requestDataSource.execute).toHaveBeenCalledWith({
      slug: 'IBGE_CNAE',
      segments: ['subclasses', CODE],
      context,
    });
  });

  it('normaliza o código antes de consultar', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.NOT_FOUND,
      status: 404,
    });

    await dataSource.fetch('6201-5/01', context);
    await dataSource.fetch('111301', context);

    expect(requestDataSource.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ segments: ['subclasses', '6201501'] }),
    );
    expect(requestDataSource.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ segments: ['subclasses', '0111301'] }),
    );
  });

  it.each([['abc'], [''], ['0'], ['12345678'], ['0000000']])(
    'código %j não é CNAE: não encontrado, sem chamar o IBGE',
    async (code) => {
      await expect(dataSource.fetch(code, context)).resolves.toEqual({
        status: 'NOT_FOUND',
      });

      expect(requestDataSource.execute).not.toHaveBeenCalled();
    },
  );

  it('devolve a descrição da subclasse', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.SUCCESS,
      status: 200,
      body: ibgeCnaeSubclassFactory.build(),
    });

    await expect(dataSource.fetch(CODE, context)).resolves.toEqual({
      status: 'FOUND',
      data: {
        code: CODE,
        description: 'DESENVOLVIMENTO DE PROGRAMAS DE COMPUTADOR SOB ENCOMENDA',
      },
    });
  });

  it.each([
    ['lista vazia', []],
    [
      'subclasse de outro código',
      ibgeCnaeSubclassFactory.build({ id: '6202300' }),
    ],
  ])(
    'resposta com %s: o código não existe na taxonomia',
    async (_case, body) => {
      requestDataSource.execute.mockResolvedValue({
        outcome: SourceOutcome.SUCCESS,
        status: 200,
        body,
      });

      await expect(dataSource.fetch(CODE, context)).resolves.toEqual({
        status: 'NOT_FOUND',
      });
    },
  );

  it.each([
    ['texto', 'manutenção'],
    ['objeto sem id', { descricao: 'X' }],
    ['subclasse sem descrição', { id: CODE, descricao: '' }],
  ])(
    'resposta fora do formato (%s) é indisponibilidade, não ausência',
    async (_case, body) => {
      requestDataSource.execute.mockResolvedValue({
        outcome: SourceOutcome.SUCCESS,
        status: 200,
        body,
      });

      await expect(dataSource.fetch(CODE, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: SourceOutcome.FAILURE,
      });
    },
  );

  it('404 do IBGE é "não encontrado"', async () => {
    requestDataSource.execute.mockResolvedValue({
      outcome: SourceOutcome.NOT_FOUND,
      status: 404,
    });

    await expect(dataSource.fetch(CODE, context)).resolves.toEqual({
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

      await expect(dataSource.fetch(CODE, context)).resolves.toEqual({
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

    await expect(dataSource.fetch(CODE, context)).resolves.toEqual({
      status: 'UNAVAILABLE',
      reason: SourceOutcome.DISABLED,
    });
  });
});
