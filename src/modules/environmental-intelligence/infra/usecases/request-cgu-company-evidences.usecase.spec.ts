import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EvidenceState } from '@prisma/client';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { QueueTimeoutException } from '@shared/domain/errors/queue-timeout.exception.js';
import { QueueJobFailedException } from '@shared/domain/errors/queue-job-failed.exception.js';
import { DependencyUnavailableException } from '@shared/domain/errors/dependency-unavailable.exception.js';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { FETCH_CGU_EVIDENCES_JOB } from '../../domain/cgu-job.dto.js';
import { RequestCguCompanyEvidencesUseCase } from './request-cgu-company-evidences.usecase.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
describe('produtor CGU', () => {
  const list = { execute: vi.fn() },
    collection = { execute: vi.fn() },
    queue = { enqueueAndWait: vi.fn() };
  const config = { get: vi.fn() };
  const cnpj = buildCnpj();
  let useCase: RequestCguCompanyEvidencesUseCase;
  const row = (
    sourceSlug: string,
    state: EvidenceState = EvidenceState.CONFIRMED,
  ) => storedEvidenceFactory.build({ cnpj, sourceSlug, state });
  beforeEach(async () => {
    vi.resetAllMocks();
    config.get.mockReturnValue('token-de-teste');
    list.execute.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        RequestCguCompanyEvidencesUseCase,
        { provide: ConfigService, useValue: config },
        { provide: ListCompanyEvidencesUseCase, useValue: list },
        { provide: RecordEvidenceCollectionUseCase, useValue: collection },
        { provide: QueueProvider, useValue: queue },
      ],
    }).compile();
    useCase = module.get(RequestCguCompanyEvidencesUseCase);
  });
  it.each([
    EvidenceState.CONFIRMED,
    EvidenceState.NOT_FOUND,
    EvidenceState.UNKNOWN,
  ])('reutiliza %s valido em ambos os cadastros', async (state) => {
    const rows = [row('CGU_CEIS', state), row('CGU_CNEP', state)];
    list.execute.mockResolvedValue([...rows, row('IBAMA')]);
    expect(await useCase.execute(cnpj)).toEqual(rows);
    expect(queue.enqueueAndWait).not.toHaveBeenCalled();
    expect(collection.execute).not.toHaveBeenCalled();
  });
  it('prepara apenas fonte pendente antes da fila e rele resultado do worker', async () => {
    const a = row('CGU_CEIS'),
      b = row('CGU_CNEP');
    list.execute
      .mockResolvedValueOnce([a])
      .mockResolvedValueOnce([a])
      .mockResolvedValue([a, b]);
    queue.enqueueAndWait.mockImplementation(() => {
      expect(collection.execute).toHaveBeenCalledTimes(1);
    });
    expect(await useCase.execute(cnpj)).toEqual([a, b]);
    expect(collection.execute).toHaveBeenCalledWith({
      cnpj,
      sourceSlug: 'CGU_CNEP',
      result: { status: 'UNAVAILABLE' },
    });
    expect(queue.enqueueAndWait).toHaveBeenCalledWith(
      QueueName.ENVIRONMENTAL_EVIDENCES,
      FETCH_CGU_EVIDENCES_JOB,
      { cnpj },
      { jobId: expect.stringMatching(new RegExp(`^cgu-${cnpj}-[0-9]+$`)) },
    );
  });
  it('sem chave marca CEIS/CNEP UNKNOWN e nao publica job', async () => {
    config.get.mockReturnValue(undefined);
    const placeholders = [
      row('CGU_CEIS', EvidenceState.UNKNOWN),
      row('CGU_CNEP', EvidenceState.UNKNOWN),
    ];
    list.execute.mockResolvedValueOnce([]).mockResolvedValue(placeholders);
    expect(await useCase.execute(cnpj)).toEqual(placeholders);
    expect(collection.execute).toHaveBeenCalledTimes(2);
    expect(queue.enqueueAndWait).not.toHaveBeenCalled();
  });
  it('sem chave preserva respostas validas anteriores sem nova escrita', async () => {
    config.get.mockReturnValue(undefined);
    const rows = [row('CGU_CEIS'), row('CGU_CNEP')];
    list.execute.mockResolvedValue(rows);
    expect(await useCase.execute(cnpj)).toEqual(rows);
    expect(collection.execute).not.toHaveBeenCalled();
    expect(queue.enqueueAndWait).not.toHaveBeenCalled();
  });
  it.each([
    new QueueTimeoutException(
      'environmental-evidences',
      FETCH_CGU_EVIDENCES_JOB,
      3000,
    ),
    new QueueJobFailedException(
      'environmental-evidences',
      FETCH_CGU_EVIDENCES_JOB,
      'erro',
    ),
    new DependencyUnavailableException('redis'),
  ])('degrada falha esperada %s sem apagar coleta anterior', async (error) => {
    const a = row('CGU_CEIS', EvidenceState.OUTDATED);
    list.execute.mockResolvedValue([a]);
    queue.enqueueAndWait.mockRejectedValue(error);
    expect(await useCase.execute(cnpj)).toEqual([a]);
    expect(collection.execute).toHaveBeenCalledTimes(2);
  });
  it('validade expirada exige nova coleta mesmo com estado gravado confirmado', async () => {
    list.execute.mockResolvedValue([
      storedEvidenceFactory.build({
        cnpj,
        sourceSlug: 'CGU_CEIS',
        validUntil: new Date(0),
      }),
      row('CGU_CNEP'),
    ]);
    await useCase.execute(cnpj);
    expect(queue.enqueueAndWait).toHaveBeenCalledOnce();
  });
  it('propaga erro inesperado para isolamento da orquestracao', async () => {
    queue.enqueueAndWait.mockRejectedValue(new Error('inesperado'));
    await expect(useCase.execute(cnpj)).rejects.toThrow('inesperado');
  });
  it('valida payload antes de qualquer efeito', async () => {
    await expect(useCase.execute('invalido')).rejects.toThrow();
    expect(list.execute).not.toHaveBeenCalled();
    expect(queue.enqueueAndWait).not.toHaveBeenCalled();
  });
});
