import { Test } from '@nestjs/testing';
import { SessionRevocationReason, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { faker } from '@test/support/faker.js';
import { UserSessionRepository } from '../../domain/dtos/repositories/user-session.repository.js';
import { LogoutUseCase } from './logout.usecase.js';

describe('LogoutUseCase', () => {
  const userSessionRepository = {
    revokeFamily: vi.fn<UserSessionRepository['revokeFamily']>(),
    revokeAllActive: vi.fn<UserSessionRepository['revokeAllActive']>(),
  };
  let useCase: LogoutUseCase;

  function buildUser(): AuthenticatedUser {
    return {
      userId: faker.database.mongodbObjectId(),
      sessionId: faker.database.mongodbObjectId(),
      familyId: faker.string.uuid(),
      role: UserRole.USER,
    };
  }

  beforeEach(async () => {
    vi.useFakeTimers({ now: faker.date.recent() });
    userSessionRepository.revokeFamily.mockResolvedValue(1);
    userSessionRepository.revokeAllActive.mockResolvedValue(3);

    const moduleRef = await Test.createTestingModule({
      providers: [
        LogoutUseCase,
        { provide: UserSessionRepository, useValue: userSessionRepository },
      ],
    }).compile();

    useCase = moduleRef.get(LogoutUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('dispositivo atual', () => {
    it('revoga a família de rotação da sessão como LOGOUT', async () => {
      const user = buildUser();

      await useCase.execute({ user, allDevices: false });

      expect(userSessionRepository.revokeFamily).toHaveBeenCalledWith(
        user.familyId,
        SessionRevocationReason.LOGOUT,
        new Date(),
      );
    });

    it('não toca nas sessões dos outros dispositivos', async () => {
      await useCase.execute({ user: buildUser(), allDevices: false });

      expect(userSessionRepository.revokeAllActive).not.toHaveBeenCalled();
    });
  });

  describe('todos os dispositivos', () => {
    it('revoga todas as sessões ativas do usuário como LOGOUT_ALL_DEVICES', async () => {
      const user = buildUser();

      await useCase.execute({ user, allDevices: true });

      expect(userSessionRepository.revokeAllActive).toHaveBeenCalledWith(
        user.userId,
        SessionRevocationReason.LOGOUT_ALL_DEVICES,
        new Date(),
      );
    });

    it('não se limita à família da sessão atual', async () => {
      await useCase.execute({ user: buildUser(), allDevices: true });

      expect(userSessionRepository.revokeFamily).not.toHaveBeenCalled();
    });
  });

  it('propaga a falha do banco, para que o logout não pareça concluído', async () => {
    userSessionRepository.revokeFamily.mockRejectedValue(
      new Error('banco fora'),
    );

    await expect(
      useCase.execute({ user: buildUser(), allDevices: false }),
    ).rejects.toThrow('banco fora');
  });

  it('conclui mesmo quando não havia sessão ativa a revogar', async () => {
    userSessionRepository.revokeFamily.mockResolvedValue(0);

    await expect(
      useCase.execute({ user: buildUser(), allDevices: false }),
    ).resolves.toBeUndefined();
  });
});
