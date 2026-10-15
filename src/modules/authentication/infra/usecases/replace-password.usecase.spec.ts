import { Test } from '@nestjs/testing';
import { SessionRevocationReason } from '@prisma/client';
import { UpdateAccountUseCase } from '@modules/accounts/infra/usecases/update-account.usecase.js';
import { PasswordProvider } from '@shared/domain/providers/password.provider.js';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { NotAuthenticatedException } from '../../domain/dtos/errors/not-authenticated.exception.js';
import { UserSessionRepository } from '../../domain/dtos/repositories/user-session.repository.js';
import { ReplacePasswordUseCase } from './replace-password.usecase.js';

describe('ReplacePasswordUseCase', () => {
  const updateAccount = {
    execute: vi.fn<UpdateAccountUseCase['execute']>(),
  };
  const userSessionRepository = {
    revokeAllActive: vi.fn<UserSessionRepository['revokeAllActive']>(),
  };
  const passwordProvider = { hash: vi.fn<PasswordProvider['hash']>() };
  const hashed = { ciphertext: faker.string.alphanumeric(60), keyVersion: 1 };
  let useCase: ReplacePasswordUseCase;

  function buildCommand(
    reason: SessionRevocationReason = SessionRevocationReason.PASSWORD_CHANGE,
  ) {
    return {
      userId: faker.database.mongodbObjectId(),
      newPassword: buildPassword(),
      reason,
    };
  }

  beforeEach(async () => {
    vi.useFakeTimers({ now: faker.date.recent() });
    updateAccount.execute.mockResolvedValue('UPDATED');
    userSessionRepository.revokeAllActive.mockResolvedValue(2);
    passwordProvider.hash.mockResolvedValue(hashed);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReplacePasswordUseCase,
        { provide: UpdateAccountUseCase, useValue: updateAccount },
        { provide: UserSessionRepository, useValue: userSessionRepository },
        { provide: PasswordProvider, useValue: passwordProvider },
      ],
    }).compile();

    useCase = moduleRef.get(ReplacePasswordUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('grava o hash da senha nova na conta', async () => {
    const command = buildCommand();

    await useCase.execute(command);

    expect(passwordProvider.hash).toHaveBeenCalledWith(command.newPassword);
    expect(updateAccount.execute).toHaveBeenCalledWith({
      userId: command.userId,
      changes: { password: hashed },
    });
  });

  it('não entrega a senha em claro ao caso de uso de gravação', async () => {
    const command = buildCommand();

    await useCase.execute(command);

    const [call] = updateAccount.execute.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain(command.newPassword);
  });

  describe('sessões', () => {
    it.each([
      SessionRevocationReason.PASSWORD_CHANGE,
      SessionRevocationReason.PASSWORD_RESET,
    ])('revoga todas as sessões ativas do usuário como %s', async (reason) => {
      const command = buildCommand(reason);

      await useCase.execute(command);

      expect(userSessionRepository.revokeAllActive).toHaveBeenCalledWith(
        command.userId,
        reason,
        new Date(),
      );
    });

    it('grava a senha antes de revogar as sessões', async () => {
      await useCase.execute(buildCommand());

      // Na ordem inversa, quem soubesse a senha antiga abriria uma sessão nova
      // entre a revogação e a gravação.
      expect(updateAccount.execute.mock.invocationCallOrder[0]).toBeLessThan(
        userSessionRepository.revokeAllActive.mock.invocationCallOrder[0],
      );
    });

    it('não revoga sessões se a gravação da senha falhar', async () => {
      updateAccount.execute.mockRejectedValue(new Error('banco fora'));

      await expect(useCase.execute(buildCommand())).rejects.toThrow(
        'banco fora',
      );

      expect(userSessionRepository.revokeAllActive).not.toHaveBeenCalled();
    });
  });

  describe('conta inexistente', () => {
    it.each(['NOT_FOUND', 'EMAIL_TAKEN'] as const)(
      'recusa quando a gravação devolve %s, sem revogar sessões',
      async (outcome) => {
        updateAccount.execute.mockResolvedValue(outcome);

        await expect(useCase.execute(buildCommand())).rejects.toBeInstanceOf(
          NotAuthenticatedException,
        );

        expect(userSessionRepository.revokeAllActive).not.toHaveBeenCalled();
      },
    );
  });
});
