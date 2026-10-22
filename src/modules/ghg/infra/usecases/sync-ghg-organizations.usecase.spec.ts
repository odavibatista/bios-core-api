import { Test } from '@nestjs/testing';
import { RequestTrigger } from '@prisma/client';
import { ghgOrganizationFactory } from '@test/factories/ghg/ghg.factory.js';
import { GhgOrganizationDirectory } from '../providers/ghg-organization-directory.provider.js';
import { SyncGhgOrganizationsUseCase } from './sync-ghg-organizations.usecase.js';

describe('SyncGhgOrganizationsUseCase', () => {
  const directory = { sync: vi.fn() };
  let useCase: SyncGhgOrganizationsUseCase;

  beforeEach(async () => {
    vi.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        SyncGhgOrganizationsUseCase,
        { provide: GhgOrganizationDirectory, useValue: directory },
      ],
    }).compile();

    useCase = moduleRef.get(SyncGhgOrganizationsUseCase);
  });

  it('sincroniza como job agendado e devolve quantas organizações o cadastro tem', async () => {
    const organizations = ghgOrganizationFactory.buildMany(7);
    directory.sync.mockResolvedValue({
      syncedAt: new Date().toISOString(),
      organizations,
    });

    await expect(useCase.execute()).resolves.toEqual({ organizations: 7 });

    expect(directory.sync).toHaveBeenCalledWith({
      trigger: RequestTrigger.SCHEDULED_JOB,
    });
  });

  it('propaga a falha, para a fila repetir', async () => {
    directory.sync.mockRejectedValue(new Error('portal fora'));

    await expect(useCase.execute()).rejects.toThrow('portal fora');
  });
});
