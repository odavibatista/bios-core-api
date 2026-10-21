import { Test } from '@nestjs/testing';
import { EvidenceState } from '@prisma/client';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { faker } from '@test/support/faker.js';
import { EvidenceRepository } from '../../domain/dtos/repositories/evidence.repository.js';
import { ListCompanyEvidencesUseCase } from './list-company-evidences.usecase.js';

describe('ListCompanyEvidencesUseCase', () => {
  const evidenceRepository = {
    findByCnpj: vi.fn<EvidenceRepository['findByCnpj']>(),
  };
  let useCase: ListCompanyEvidencesUseCase;
  const now = faker.date.recent();

  beforeEach(async () => {
    vi.useFakeTimers({ now });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ListCompanyEvidencesUseCase,
        { provide: EvidenceRepository, useValue: evidenceRepository },
      ],
    }).compile();

    useCase = moduleRef.get(ListCompanyEvidencesUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('procura as evidências pelo CNPJ', async () => {
    evidenceRepository.findByCnpj.mockResolvedValue([]);
    const cnpj = buildCnpj();

    await useCase.execute(cnpj);

    expect(evidenceRepository.findByCnpj).toHaveBeenCalledWith(cnpj);
  });

  it('sem evidências, devolve a lista vazia', async () => {
    evidenceRepository.findByCnpj.mockResolvedValue([]);

    await expect(useCase.execute(buildCnpj())).resolves.toEqual([]);
  });

  it('a evidência vencida volta como OUTDATED; a vigente mantém o estado', async () => {
    const vigente = storedEvidenceFactory.build({
      state: EvidenceState.CONFIRMED,
      validUntil: new Date(now.getTime() + 60_000),
    });
    const vencida = storedEvidenceFactory.build({
      state: EvidenceState.CONFIRMED,
      validUntil: new Date(now.getTime() - 60_000),
    });
    evidenceRepository.findByCnpj.mockResolvedValue([vigente, vencida]);

    const evidences = await useCase.execute(buildCnpj());

    expect(evidences.map(({ state }) => state)).toEqual([
      EvidenceState.CONFIRMED,
      EvidenceState.OUTDATED,
    ]);
  });

  it('UNKNOWN vencida continua UNKNOWN', async () => {
    evidenceRepository.findByCnpj.mockResolvedValue([
      storedEvidenceFactory.build({
        state: EvidenceState.UNKNOWN,
        validUntil: new Date(now.getTime() - 60_000),
      }),
    ]);

    const [evidence] = await useCase.execute(buildCnpj());

    expect(evidence.state).toBe(EvidenceState.UNKNOWN);
  });

  it('não altera os demais campos', async () => {
    const stored = storedEvidenceFactory.build({
      state: EvidenceState.CONFIRMED,
      validUntil: new Date(now.getTime() + 60_000),
    });
    evidenceRepository.findByCnpj.mockResolvedValue([stored]);

    await expect(useCase.execute(buildCnpj())).resolves.toEqual([stored]);
  });

  it('propaga a falha do banco', async () => {
    evidenceRepository.findByCnpj.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute(buildCnpj())).rejects.toThrow('banco fora');
  });
});
