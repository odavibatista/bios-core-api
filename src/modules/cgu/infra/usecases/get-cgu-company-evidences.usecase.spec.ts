import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import { RecordEvidenceEntriesUseCase } from '@modules/evidences/infra/usecases/record-evidence-entries.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { cguRowFactory } from '@test/factories/cgu/cgu-sanction.factory.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { faker } from '@test/support/faker.js';
import { readCguPage } from '../../domain/cgu-sanction.js';
import { CeisDataSource } from '../providers/ceis.data-source.js';
import { CnepDataSource } from '../providers/cnep.data-source.js';
import { GetCguCompanyEvidencesUseCase } from './get-cgu-company-evidences.usecase.js';

describe('coleta CGU por empresa', () => {
  const ceis = { slug: 'CGU_CEIS', fetch: vi.fn<CeisDataSource['fetch']>() };
  const cnep = { slug: 'CGU_CNEP', fetch: vi.fn<CnepDataSource['fetch']>() };
  const entries = { execute: vi.fn() };
  const collection = { execute: vi.fn() };
  const list = { execute: vi.fn() };
  const cnpj = buildCnpj();
  const context = {
    trigger: RequestTrigger.USER_QUERY,
    ingestionRunId: faker.database.mongodbObjectId(),
  };
  const collectedAt = faker.date.recent();
  let useCase: GetCguCompanyEvidencesUseCase;
  beforeEach(async () => {
    vi.resetAllMocks();
    ceis.fetch.mockResolvedValue({ status: 'NOT_FOUND', collectedAt });
    cnep.fetch.mockResolvedValue({ status: 'NOT_FOUND', collectedAt });
    list.execute.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        GetCguCompanyEvidencesUseCase,
        { provide: CeisDataSource, useValue: ceis },
        { provide: CnepDataSource, useValue: cnep },
        { provide: RecordEvidenceEntriesUseCase, useValue: entries },
        { provide: RecordEvidenceCollectionUseCase, useValue: collection },
        { provide: ListCompanyEvidencesUseCase, useValue: list },
      ],
    }).compile();
    useCase = module.get(GetCguCompanyEvidencesUseCase);
  });

  it('grava uma evidência por sanção e devolve somente os dois cadastros CGU', async () => {
    const row = cguRowFactory.build({
      sancionado: { codigoFormatado: cnpj, nome: faker.person.fullName() },
    });
    const sanctions = readCguPage([row], cnpj).sanctions;
    ceis.fetch.mockResolvedValue({
      status: 'FOUND',
      data: sanctions,
      collectedAt,
    });
    const stored = storedEvidenceFactory.build({
      sourceSlug: 'CGU_CEIS',
      cnpj,
    });
    list.execute
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        stored,
        storedEvidenceFactory.build({ sourceSlug: 'IBAMA' }),
      ]);
    expect(await useCase.execute({ cnpj, context })).toEqual([stored]);
    expect(entries.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        cnpj,
        sourceSlug: 'CGU_CEIS',
        collectedAt,
        ingestionRunId: context.ingestionRunId,
        entries: [
          expect.objectContaining({
            cnpj,
            finding: expect.objectContaining({ reference: String(row.id) }),
          }),
        ],
      }),
    );
    expect(entries.execute).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSlug: 'CGU_CNEP', entries: [] }),
    );
  });

  it('falha CEIS não bloqueia ausência CNEP e solicita preservação da coleta anterior', async () => {
    ceis.fetch.mockResolvedValue({
      status: 'UNAVAILABLE',
      reason: 'TIMEOUT',
      message: 'indisponível',
    });
    await useCase.execute({ cnpj, context });
    expect(collection.execute).toHaveBeenCalledWith({
      cnpj,
      sourceSlug: 'CGU_CEIS',
      result: { status: 'UNAVAILABLE' },
    });
    expect(entries.execute).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSlug: 'CGU_CNEP', entries: [] }),
    );
  });

  it('recusa CNPJ inválido antes de consultar fontes', async () => {
    await expect(
      useCase.execute({ cnpj: 'inválido', context }),
    ).rejects.toThrow(/CNPJ/);
    expect(ceis.fetch).not.toHaveBeenCalled();
    expect(cnep.fetch).not.toHaveBeenCalled();
  });

  it('reutiliza CEIS fresco e consulta apenas CNEP pendente', async () => {
    list.execute.mockResolvedValue([
      storedEvidenceFactory.build({ cnpj, sourceSlug: 'CGU_CEIS' }),
    ]);
    await useCase.execute({ cnpj, context });
    expect(ceis.fetch).not.toHaveBeenCalled();
    expect(cnep.fetch).toHaveBeenCalledOnce();
  });
  it('placeholder UNKNOWN do produtor nao impede coleta do worker', async () => {
    list.execute.mockResolvedValue([
      storedEvidenceFactory.build({
        cnpj,
        sourceSlug: 'CGU_CEIS',
        state: 'UNKNOWN',
      }),
    ]);
    await useCase.execute({ cnpj, context });
    expect(ceis.fetch).toHaveBeenCalledOnce();
  });
  it('excecao CEIS inesperada nao perde resposta CNEP e fica visivel no log', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    ceis.fetch.mockRejectedValue(new Error('rede fora'));
    await useCase.execute({ cnpj, context });
    expect(error).toHaveBeenCalledWith(
      {
        event: 'source_unknown',
        source: 'CGU_CEIS',
        reason: 'UNEXPECTED_ERROR',
        error: 'Error',
      },
      expect.any(String),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('rede fora');
    expect(collection.execute).toHaveBeenCalledWith({
      cnpj,
      sourceSlug: 'CGU_CEIS',
      result: { status: 'UNAVAILABLE' },
    });
    expect(entries.execute).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSlug: 'CGU_CNEP', entries: [] }),
    );
  });
  it('espera ambas as gravacoes antes de propagar erro de persistencia', async () => {
    let resolve!: () => void;
    entries.execute.mockImplementation(({ sourceSlug }) =>
      sourceSlug === 'CGU_CEIS'
        ? Promise.reject(new Error('banco'))
        : new Promise<void>((r) => {
            resolve = r;
          }),
    );
    const pending = useCase.execute({ cnpj, context });
    await vi.waitFor(() => expect(resolve).toBeDefined());
    resolve();
    await expect(pending).rejects.toThrow('banco');
  });

  it('validade vencida e OUTDATED exigem coleta mesmo havendo resposta anterior', async () => {
    list.execute.mockResolvedValue([
      storedEvidenceFactory.build({
        cnpj,
        sourceSlug: 'CGU_CEIS',
        validUntil: new Date(0),
      }),
      storedEvidenceFactory.build({
        cnpj,
        sourceSlug: 'CGU_CNEP',
        state: 'OUTDATED',
      }),
    ]);
    await useCase.execute({ cnpj, context });
    expect(ceis.fetch).toHaveBeenCalledOnce();
    expect(cnep.fetch).toHaveBeenCalledOnce();
  });
});
