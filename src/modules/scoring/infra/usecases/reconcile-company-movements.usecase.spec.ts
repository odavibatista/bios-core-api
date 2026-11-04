import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CompanyMovementRepository,
  type MovementCandidate,
} from '../../domain/dtos/repositories/company-movement.repository.js';
import { MOVEMENT_RECONCILE_PAGE_SIZE } from '../../domain/ods-scoring-job.dto.js';
import { ReconcileCompanyMovementsUseCase } from './reconcile-company-movements.usecase.js';

describe('ReconcileCompanyMovementsUseCase', () => {
  const now = new Date('2026-11-04T12:00:00.000Z');
  const published = new Date('2026-10-01T00:00:00.000Z');
  const movements = {
    findCandidates: vi.fn<CompanyMovementRepository['findCandidates']>(),
    createIfMissing: vi.fn<CompanyMovementRepository['createIfMissing']>(),
  };
  const candidate = (
    cnpj: string,
    date: Date | null = published,
  ): MovementCandidate => ({
    cnpj,
    scores: [
      {
        odsId: 'ods-15',
        odsNumber: 15,
        contributions: [
          {
            evidenceId: 'a',
            category: 'INFRACAO_AMBIENTAL',
            points: -40,
            evidenceDate: date,
          },
        ],
      },
    ],
  });
  let useCase: ReconcileCompanyMovementsUseCase;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    movements.createIfMissing.mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReconcileCompanyMovementsUseCase,
        { provide: CompanyMovementRepository, useValue: movements },
      ],
    }).compile();

    useCase = moduleRef.get(ReconcileCompanyMovementsUseCase);
  });

  it('percorre as páginas pelo cursor e cria o que falta', async () => {
    movements.findCandidates
      .mockResolvedValueOnce({ candidates: [candidate('1')], nextCursor: '1' })
      .mockResolvedValueOnce({ candidates: [], nextCursor: '2' })
      .mockResolvedValueOnce({ candidates: [candidate('3')], nextCursor: '3' })
      .mockResolvedValueOnce({ candidates: [], nextCursor: null });

    await expect(useCase.execute(now)).resolves.toEqual({ created: 2 });

    expect(movements.findCandidates.mock.calls).toEqual([
      [null, MOVEMENT_RECONCILE_PAGE_SIZE],
      ['1', MOVEMENT_RECONCILE_PAGE_SIZE],
      ['2', MOVEMENT_RECONCILE_PAGE_SIZE],
      ['3', MOVEMENT_RECONCILE_PAGE_SIZE],
    ]);
    expect(movements.createIfMissing).toHaveBeenCalledWith('1', [
      {
        odsId: 'ods-15',
        odsNumber: 15,
        direction: 'AVAILABLE',
        cause: 'EVIDENCE_ADDED',
        evidenceCategory: 'INFRACAO_AMBIENTAL',
        movedAt: published,
      },
    ]);
  });

  it('base vazia termina sem escrever', async () => {
    movements.findCandidates.mockResolvedValue({
      candidates: [],
      nextCursor: null,
    });

    await expect(useCase.execute(now)).resolves.toEqual({ created: 0 });

    expect(movements.createIfMissing).not.toHaveBeenCalled();
  });

  it('empresa sem nada a reconstruir não vira documento vazio', async () => {
    movements.findCandidates.mockResolvedValue({
      candidates: [candidate('1', null)],
      nextCursor: null,
    });

    await expect(useCase.execute(now)).resolves.toEqual({ created: 0 });

    expect(movements.createIfMissing).not.toHaveBeenCalled();
  });

  it('não conta a empresa que um recálculo gravou durante a varredura', async () => {
    movements.findCandidates.mockResolvedValue({
      candidates: [candidate('1')],
      nextCursor: null,
    });
    movements.createIfMissing.mockResolvedValue(false);

    await expect(useCase.execute(now)).resolves.toEqual({ created: 0 });
  });
});
