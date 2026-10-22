import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import { EvidenceState } from '@prisma/client';
import { CompanyProfileRepository } from '@modules/companies/domain/dtos/repositories/company-profile.repository.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceEntriesUseCase } from '@modules/evidences/infra/usecases/record-evidence-entries.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { ResolveSourceRequestConfigUseCase } from '@modules/data-sources/infra/usecases/request/resolve-source-request-config.usecase.js';
import { QUEUE_SCHEDULES } from '@shared/config/queue.config.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { QueueTimeoutException } from '@shared/domain/errors/queue-timeout.exception.js';
import { QueueJobFailedException } from '@shared/domain/errors/queue-job-failed.exception.js';
import { DependencyUnavailableException } from '@shared/domain/errors/dependency-unavailable.exception.js';
import { storedCompanyProfileFactory } from '@test/factories/companies/company-profile.factory.js';
import { ghgInventoryFactory } from '@test/factories/ghg/ghg.factory.js';
import { faker } from '@test/support/faker.js';
import { GhgDataSource } from '../providers/ghg.data-source.js';
import { GhgInventoryProcessor } from '../queue/ghg-inventory.processor.js';
import { CollectGhgInventoryUseCase } from './collect-ghg-inventory.usecase.js';
import { GetGhgCompanyEvidencesUseCase } from './get-ghg-company-evidences.usecase.js';
import {
  FETCH_GHG_INVENTORY_JOB,
  SYNC_GHG_ORGANIZATIONS_JOB,
} from '../../domain/ghg-job.dto.js';
import { GhgSourceDisabledError } from '../providers/ghg-organization-directory.provider.js';
import { SyncGhgOrganizationsUseCase } from './sync-ghg-organizations.usecase.js';
describe('fluxo GHG isolado', () => {
  const companies = { findByCnpj: vi.fn() },
    adapter = { fetch: vi.fn() },
    entries = { execute: vi.fn() },
    collection = { execute: vi.fn() },
    list = { execute: vi.fn() },
    config = { execute: vi.fn() },
    queue = { enqueueAndWait: vi.fn() },
    syncOrganizations = { execute: vi.fn() };
  const inventory = ghgInventoryFactory.build();
  let collect: CollectGhgInventoryUseCase,
    get: GetGhgCompanyEvidencesUseCase,
    processor: GhgInventoryProcessor;
  const local = () => ({
    sourceSlug: 'GHG_PROTOCOL',
    state: EvidenceState.CONFIRMED,
    validUntil: new Date(Date.now() + 10000),
  });
  beforeEach(async () => {
    vi.resetAllMocks();
    companies.findByCnpj.mockResolvedValue(storedCompanyProfileFactory.build());
    adapter.fetch.mockResolvedValue({
      status: 'FOUND',
      data: { inventories: [inventory], collectedAt: new Date() },
    });
    list.execute.mockResolvedValue([]);
    config.execute.mockResolvedValue({
      isEnabled: true,
      requestTimeoutMs: 1234,
    });
    const module = await Test.createTestingModule({
      providers: [
        CollectGhgInventoryUseCase,
        GetGhgCompanyEvidencesUseCase,
        GhgInventoryProcessor,
        { provide: CompanyProfileRepository, useValue: companies },
        { provide: GhgDataSource, useValue: adapter },
        { provide: RecordEvidenceEntriesUseCase, useValue: entries },
        { provide: RecordEvidenceCollectionUseCase, useValue: collection },
        { provide: ListCompanyEvidencesUseCase, useValue: list },
        { provide: ResolveSourceRequestConfigUseCase, useValue: config },
        { provide: QueueProvider, useValue: queue },
        { provide: SyncGhgOrganizationsUseCase, useValue: syncOrganizations },
      ],
    }).compile();
    collect = module.get(CollectGhgInventoryUseCase);
    get = module.get(GetGhgCompanyEvidencesUseCase);
    processor = module.get(GhgInventoryProcessor);
  });
  it('processor encaminha somente job canonico e grava campos permitidos', async () => {
    expect(
      await processor.process({
        name: FETCH_GHG_INVENTORY_JOB,
        data: { cnpj: inventory.cnpj },
      } as Job),
    ).toEqual({ status: 'FOUND' });
    expect(entries.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        cnpj: inventory.cnpj,
        sourceSlug: 'GHG_PROTOCOL',
        entries: [expect.objectContaining({ raw: inventory })],
      }),
    );
    expect(collection.execute).not.toHaveBeenCalled();
  });
  it.each([
    { name: 'other', data: { cnpj: inventory.cnpj } },
    { name: FETCH_GHG_INVENTORY_JOB, data: {} },
    { name: FETCH_GHG_INVENTORY_JOB, data: { cnpj: '123' } },
    { name: FETCH_GHG_INVENTORY_JOB, data: { cnpj: '11.222.333/0001-81' } },
    {
      name: FETCH_GHG_INVENTORY_JOB,
      data: { cnpj: inventory.cnpj, extra: true },
    },
  ])('rejeita job sem retry %j', async (job) => {
    await expect(processor.process(job as Job)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(syncOrganizations.execute).not.toHaveBeenCalled();
  });
  describe('sincronizacao diaria do cadastro de organizacoes', () => {
    it('o job do agendador, sem carga ou com carga vazia, sincroniza e devolve o resultado', async () => {
      syncOrganizations.execute.mockResolvedValue({ organizations: 1029 });

      for (const data of [undefined, null, {}]) {
        await expect(
          processor.process({ name: SYNC_GHG_ORGANIZATIONS_JOB, data } as Job),
        ).resolves.toEqual({ organizations: 1029 });
      }

      expect(syncOrganizations.execute).toHaveBeenCalledTimes(3);
      expect(adapter.fetch).not.toHaveBeenCalled();
    });

    it('o agendamento declarado publica exatamente o job que o consumidor atende, na fila do GHG e com retry de minutos', () => {
      const schedule = QUEUE_SCHEDULES.find(
        ({ id }) => id === 'ghg-organizations-sync',
      );

      expect(schedule).toMatchObject({
        queue: QueueName.GHG_INVENTORY,
        jobName: SYNC_GHG_ORGANIZATIONS_JOB,
        cron: expect.stringMatching(/^\d+ \d+ \* \* \*$/),
        retry: { attempts: 5, backoffMs: 60_000 },
      });
    });

    it.each([
      ['texto', 'sync'],
      ['lista', []],
      ['campo desconhecido', { cnpj: inventory.cnpj }],
    ])(
      'carga que nao e vazia (%s) falha sem repeticao',
      async (_case, data) => {
        await expect(
          processor.process({ name: SYNC_GHG_ORGANIZATIONS_JOB, data } as Job),
        ).rejects.toBeInstanceOf(UnrecoverableError);

        expect(syncOrganizations.execute).not.toHaveBeenCalled();
      },
    );

    it('falha do portal propaga o mesmo erro, para a fila repetir', async () => {
      const failure = new Error('portal fora');
      syncOrganizations.execute.mockRejectedValue(failure);

      const thrown = await processor
        .process({ name: SYNC_GHG_ORGANIZATIONS_JOB, data: {} } as Job)
        .catch((error: unknown) => error);

      expect(thrown).toBe(failure);
      expect(thrown).not.toBeInstanceOf(UnrecoverableError);
    });

    it('fonte desabilitada falha sem repeticao', async () => {
      syncOrganizations.execute.mockRejectedValue(new GhgSourceDisabledError());

      const thrown = await processor
        .process({ name: SYNC_GHG_ORGANIZATIONS_JOB, data: {} } as Job)
        .catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(UnrecoverableError);
      expect((thrown as Error).message).toContain('desabilitada');
    });
  });
  it('sem perfil/sem inventario grava UNKNOWN, nunca NOT_FOUND', async () => {
    companies.findByCnpj.mockResolvedValue(null);
    adapter.fetch.mockResolvedValue({ status: 'UNAVAILABLE' });
    expect(await collect.execute(inventory.cnpj)).toEqual({
      status: 'UNKNOWN',
    });
    expect(adapter.fetch).toHaveBeenCalledWith(
      { cnpj: inventory.cnpj, names: [] },
      expect.anything(),
    );
    expect(collection.execute).toHaveBeenCalledWith({
      cnpj: inventory.cnpj,
      sourceSlug: 'GHG_PROTOCOL',
      result: { status: 'UNAVAILABLE' },
    });
    expect(entries.execute).not.toHaveBeenCalled();
  });
  it('erro de persistencia propaga para retry', async () => {
    entries.execute.mockRejectedValue(new Error('storage'));
    await expect(collect.execute(inventory.cnpj)).rejects.toThrow('storage');
  });
  it('entrada invalida nao publica', async () => {
    await expect(get.execute(faker.lorem.word())).rejects.toThrow();
    expect(queue.enqueueAndWait).not.toHaveBeenCalled();
  });
  it.each([EvidenceState.CONFIRMED, EvidenceState.UNKNOWN])(
    'reutiliza %s valido sem fila',
    async (state) => {
      const e = { ...local(), state };
      list.execute.mockResolvedValue([e]);
      expect(await get.execute(inventory.cnpj)).toEqual([e]);
      expect(queue.enqueueAndWait).not.toHaveBeenCalled();
    },
  );
  it('isola a fonte, grava UNKNOWN antes de publicar e usa timeout do catalogo', async () => {
    const e = local();
    list.execute
      .mockResolvedValueOnce([{ ...e, sourceSlug: 'IBAMA' }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([e]);
    queue.enqueueAndWait.mockImplementation(() => {
      expect(collection.execute).toHaveBeenCalled();
      return Promise.resolve();
    });
    expect(await get.execute(inventory.cnpj)).toEqual([e]);
    expect(queue.enqueueAndWait).toHaveBeenCalledWith(
      'ghg-inventory',
      FETCH_GHG_INVENTORY_JOB,
      { cnpj: inventory.cnpj },
      expect.objectContaining({ timeoutMs: 1234 }),
    );
    expect(adapter.fetch).not.toHaveBeenCalled();
  });
  it('OUTDATED exige atualizacao sem apagar resposta anterior', async () => {
    list.execute.mockResolvedValue([
      { ...local(), state: EvidenceState.OUTDATED },
    ]);
    await get.execute(inventory.cnpj);
    expect(queue.enqueueAndWait).toHaveBeenCalled();
  });
  it('data vencida exige atualizacao mesmo antes de derivar estado', async () => {
    list.execute.mockResolvedValue([{ ...local(), validUntil: new Date(0) }]);
    await get.execute(inventory.cnpj);
    expect(queue.enqueueAndWait).toHaveBeenCalled();
  });
  it.each([null, { isEnabled: false }])(
    'nao publica fonte indisponivel %j',
    async (s) => {
      config.execute.mockResolvedValue(s);
      await get.execute(inventory.cnpj);
      expect(queue.enqueueAndWait).not.toHaveBeenCalled();
    },
  );
  it('usa timeout padrao do catalogo', async () => {
    config.execute.mockResolvedValue({
      isEnabled: true,
      requestTimeoutMs: null,
    });
    await get.execute(inventory.cnpj);
    expect(queue.enqueueAndWait).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ timeoutMs: 10000 }),
    );
  });
  it.each([
    new QueueTimeoutException('ghg', 'fetch', 1),
    new QueueJobFailedException('ghg', 'fetch', 'bad'),
    new DependencyUnavailableException('redis'),
  ])('degrada em falha esperada %j', async (error) => {
    queue.enqueueAndWait.mockRejectedValue(error);
    await expect(get.execute(inventory.cnpj)).resolves.toEqual([]);
    expect(collection.execute).toHaveBeenCalledTimes(1);
  });
  it('erros inesperados nao sao mascarados', async () => {
    queue.enqueueAndWait.mockRejectedValue(new Error('bug'));
    await expect(get.execute(inventory.cnpj)).rejects.toThrow('bug');
  });
});
