import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import type {
  DataSourceInterface,
  SourceLookupResult,
} from '@modules/data-sources/domain/data-source.interface.js';
import type { CadastralRecord } from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';
import { SourceOutcome } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { ListCadastralChainUseCase } from '@modules/data-sources/infra/usecases/chain/list-cadastral-chain.usecase.js';
import { CADASTRAL_DATA_SOURCES } from '../../domain/cadastral-data-sources.token.js';
import { RECEITA_SLUG, ReceitaDataSource } from './receita.data-source.js';

const CNPJ = '11222333000181';
const context = { trigger: RequestTrigger.ON_DEMAND_JOB };

function buildRecord(legalName: string): CadastralRecord {
  return {
    cnpj: CNPJ,
    legalName,
    tradeName: null,
    registrationStatus: 'ATIVA',
    registrationStatusUnrecognized: null,
    companySize: 'DEMAIS',
    address: {
      street: null,
      number: null,
      complement: null,
      neighborhood: null,
      city: 'SAO PAULO',
      cityIbgeCode: null,
      uf: 'SP',
      zipcode: null,
    },
    mainCnae: { code: '6201501', description: '' },
    secondaryCnaes: [],
  };
}

const found = (name: string): SourceLookupResult<CadastralRecord> => ({
  status: 'FOUND',
  data: buildRecord(name),
});
const notFound: SourceLookupResult<CadastralRecord> = { status: 'NOT_FOUND' };
const unavailable = (
  reason: 'FAILURE' | 'TIMEOUT' | 'RATE_LIMITED' | 'DISABLED',
): SourceLookupResult<CadastralRecord> => ({
  status: 'UNAVAILABLE',
  reason,
});

describe('ReceitaDataSource (cadeia de fallback cadastral)', () => {
  const fetchOf = {
    BRASIL_API: vi.fn<DataSourceInterface<string, CadastralRecord>['fetch']>(),
    OPEN_CNPJ: vi.fn<DataSourceInterface<string, CadastralRecord>['fetch']>(),
    MINHA_RECEITA:
      vi.fn<DataSourceInterface<string, CadastralRecord>['fetch']>(),
  };
  const providers = (['BRASIL_API', 'OPEN_CNPJ', 'MINHA_RECEITA'] as const).map(
    (slug) => ({ slug, fetch: fetchOf[slug] }),
  );
  const listChain = { execute: vi.fn<() => Promise<string[]>>() };
  let chain: ReceitaDataSource;

  /** Define o que cada provedor responde, na ordem BrasilAPI, OpenCNPJ, Minha Receita. */
  function respond(
    first: SourceLookupResult<CadastralRecord>,
    second: SourceLookupResult<CadastralRecord> = found('nunca consultado'),
    third: SourceLookupResult<CadastralRecord> = found('nunca consultado'),
  ): void {
    fetchOf.BRASIL_API.mockResolvedValue(first);
    fetchOf.OPEN_CNPJ.mockResolvedValue(second);
    fetchOf.MINHA_RECEITA.mockResolvedValue(third);
  }

  const calls = () =>
    (['BRASIL_API', 'OPEN_CNPJ', 'MINHA_RECEITA'] as const).filter(
      (slug) => fetchOf[slug].mock.calls.length > 0,
    );

  beforeEach(async () => {
    for (const fn of Object.values(fetchOf)) fn.mockReset();
    listChain.execute.mockResolvedValue([
      'BRASIL_API',
      'OPEN_CNPJ',
      'MINHA_RECEITA',
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReceitaDataSource,
        { provide: CADASTRAL_DATA_SOURCES, useValue: providers },
        { provide: ListCadastralChainUseCase, useValue: listChain },
      ],
    }).compile();

    chain = moduleRef.get(ReceitaDataSource);
  });

  it('tem um identificador lógico próprio', () => {
    expect(chain.slug).toBe('RECEITA');
    expect(RECEITA_SLUG).toBe('RECEITA');
  });

  describe('o primeiro provedor responde', () => {
    it('devolve o cadastro e o provedor, sem consultar os demais', async () => {
      respond(found('ACME'));

      await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
        status: 'FOUND',
        data: { record: buildRecord('ACME'), sourceSlug: 'BRASIL_API' },
      });
      expect(calls()).toEqual(['BRASIL_API']);
    });

    it('repassa o CNPJ e o contexto ao provedor', async () => {
      respond(found('ACME'));

      await chain.fetch(CNPJ, context);

      expect(fetchOf.BRASIL_API).toHaveBeenCalledWith(CNPJ, context);
    });
  });

  describe('fallback por indisponibilidade', () => {
    it.each(['FAILURE', 'TIMEOUT', 'RATE_LIMITED', 'DISABLED'] as const)(
      'vai ao segundo quando o primeiro fica indisponível por %s',
      async (reason) => {
        respond(unavailable(reason), found('do segundo'));

        await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
          status: 'FOUND',
          data: { record: buildRecord('do segundo'), sourceSlug: 'OPEN_CNPJ' },
        });
        expect(calls()).toEqual(['BRASIL_API', 'OPEN_CNPJ']);
      },
    );

    it('vai ao terceiro quando os dois primeiros falham', async () => {
      respond(
        unavailable('TIMEOUT'),
        unavailable('FAILURE'),
        found('do terceiro'),
      );

      await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
        status: 'FOUND',
        data: {
          record: buildRecord('do terceiro'),
          sourceSlug: 'MINHA_RECEITA',
        },
      });
      expect(calls()).toEqual(['BRASIL_API', 'OPEN_CNPJ', 'MINHA_RECEITA']);
    });

    it('com todos indisponíveis, a cadeia fica indisponível, com o motivo do último e o histórico', async () => {
      respond(
        unavailable('TIMEOUT'),
        unavailable('RATE_LIMITED'),
        unavailable('FAILURE'),
      );

      await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
        status: 'UNAVAILABLE',
        reason: 'FAILURE',
        message:
          'BRASIL_API: TIMEOUT; OPEN_CNPJ: RATE_LIMITED; MINHA_RECEITA: FAILURE',
      });
    });
  });

  describe('"não encontrado"', () => {
    it('um provedor sem o CNPJ não encerra a cadeia: espelhos se atualizam em ritmos diferentes', async () => {
      respond(notFound, found('do segundo'));

      await expect(chain.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'FOUND',
        data: { sourceSlug: 'OPEN_CNPJ' },
      });
    });

    it('todos os provedores sem o CNPJ: a empresa não foi encontrada', async () => {
      respond(notFound, notFound, notFound);

      await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
        status: 'NOT_FOUND',
      });
      expect(calls()).toEqual(['BRASIL_API', 'OPEN_CNPJ', 'MINHA_RECEITA']);
    });

    it('se algum provedor não pôde responder, não se afirma que a empresa não existe', async () => {
      respond(notFound, unavailable('TIMEOUT'), notFound);

      await expect(chain.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        reason: 'TIMEOUT',
      });
    });

    it('o provedor desabilitado não impede concluir "não encontrado"', async () => {
      respond(notFound, unavailable('DISABLED'), notFound);

      await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
        status: 'NOT_FOUND',
      });
    });
  });

  describe('ordem e composição vindas do catálogo', () => {
    it('segue a ordem do catálogo, não a do registro', async () => {
      listChain.execute.mockResolvedValue([
        'MINHA_RECEITA',
        'BRASIL_API',
        'OPEN_CNPJ',
      ]);
      respond(
        found('da BrasilAPI'),
        found('do OpenCNPJ'),
        found('do Minha Receita'),
      );

      await expect(chain.fetch(CNPJ, context)).resolves.toMatchObject({
        data: { sourceSlug: 'MINHA_RECEITA' },
      });
      expect(calls()).toEqual(['MINHA_RECEITA']);
    });

    it('só consulta os provedores que o catálogo lista', async () => {
      listChain.execute.mockResolvedValue(['OPEN_CNPJ']);
      respond(found('a'), unavailable('FAILURE'), found('c'));

      await expect(chain.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
      });
      expect(calls()).toEqual(['OPEN_CNPJ']);
    });

    it('sem nenhum provedor habilitado, fica indisponível por DISABLED, sem consultar ninguém', async () => {
      listChain.execute.mockResolvedValue([]);

      await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
        status: 'UNAVAILABLE',
        reason: 'DISABLED',
        message: 'nenhum provedor cadastral habilitado',
      });
      expect(calls()).toEqual([]);
    });

    it('slug do catálogo sem adapter registrado é ignorado, e a cadeia segue', async () => {
      listChain.execute.mockResolvedValue(['PROVEDOR_NOVO', 'OPEN_CNPJ']);
      respond(found('a'), found('do segundo'));

      await expect(chain.fetch(CNPJ, context)).resolves.toMatchObject({
        data: { sourceSlug: 'OPEN_CNPJ' },
      });
    });

    it('sem conseguir ler o catálogo, usa a ordem de registro dos provedores', async () => {
      listChain.execute.mockRejectedValue(new Error('banco fora'));
      respond(unavailable('FAILURE'), found('do segundo'));

      await expect(chain.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'FOUND',
        data: { sourceSlug: 'OPEN_CNPJ' },
      });
      expect(calls()).toEqual(['BRASIL_API', 'OPEN_CNPJ']);
    });

    it('trata falha do catálogo que não é Error', async () => {
      listChain.execute.mockRejectedValue('texto solto');
      respond(found('ACME'));

      await expect(chain.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'FOUND',
      });
    });
  });

  describe('erro inesperado em um provedor', () => {
    it('é tratado como indisponibilidade dele, e a cadeia segue', async () => {
      fetchOf.BRASIL_API.mockRejectedValue(new Error('defeito no adapter'));
      fetchOf.OPEN_CNPJ.mockResolvedValue(found('do segundo'));

      await expect(chain.fetch(CNPJ, context)).resolves.toMatchObject({
        status: 'FOUND',
        data: { sourceSlug: 'OPEN_CNPJ' },
      });
    });

    it('se todos falham assim, a cadeia fica indisponível, com a mensagem do erro no histórico', async () => {
      fetchOf.BRASIL_API.mockRejectedValue(new Error('um'));
      fetchOf.OPEN_CNPJ.mockRejectedValue('dois');
      fetchOf.MINHA_RECEITA.mockRejectedValue(new Error('três'));

      await expect(chain.fetch(CNPJ, context)).resolves.toEqual({
        status: 'UNAVAILABLE',
        reason: 'FAILURE',
        message:
          'BRASIL_API: FAILURE; OPEN_CNPJ: FAILURE; MINHA_RECEITA: FAILURE',
      });
    });
  });

  it('o motivo de uma cadeia toda desabilitada nunca é confundido com falha', async () => {
    respond(
      unavailable('DISABLED'),
      unavailable('DISABLED'),
      unavailable('DISABLED'),
    );

    await expect(chain.fetch(CNPJ, context)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      reason: SourceOutcome.DISABLED,
    });
  });
});
