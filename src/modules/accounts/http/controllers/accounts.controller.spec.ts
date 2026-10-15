import { Test } from '@nestjs/testing';
import { buildEmailToken } from '@test/factories/mailing/email-template.factory.js';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { ConfirmEmailUseCase } from '../../infra/usecases/confirm-email.usecase.js';
import { RegisterUserUseCase } from '../../infra/usecases/register-user.usecase.js';
import { ResendEmailConfirmationUseCase } from '../../infra/usecases/resend-email-confirmation.usecase.js';
import {
  AccountsController,
  CONFIRMATION_RESENT_MESSAGE,
  EMAIL_CONFIRMED_MESSAGE,
  REGISTRATION_ACCEPTED_MESSAGE,
} from './accounts.controller.js';

describe('AccountsController', () => {
  const registerUser = { execute: vi.fn() };
  const confirmEmail = { execute: vi.fn() };
  const resendEmailConfirmation = { execute: vi.fn() };
  let controller: AccountsController;

  beforeEach(async () => {
    registerUser.execute.mockResolvedValue(undefined);
    confirmEmail.execute.mockResolvedValue(undefined);
    resendEmailConfirmation.execute.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [
        { provide: RegisterUserUseCase, useValue: registerUser },
        { provide: ConfirmEmailUseCase, useValue: confirmEmail },
        {
          provide: ResendEmailConfirmationUseCase,
          useValue: resendEmailConfirmation,
        },
      ],
    }).compile();

    controller = moduleRef.get(AccountsController);
  });

  describe('register', () => {
    const body = () => ({
      name: faker.person.fullName(),
      email: faker.internet.email(),
      password: buildPassword(),
    });

    it('delega o cadastro ao caso de uso', async () => {
      const request = body();

      await controller.register(request);

      expect(registerUser.execute).toHaveBeenCalledWith(request);
    });

    it('responde a mesma mensagem, sem dado da conta', async () => {
      await expect(controller.register(body())).resolves.toEqual({
        message: REGISTRATION_ACCEPTED_MESSAGE,
      });
    });

    it('não responde antes de o caso de uso terminar', async () => {
      registerUser.execute.mockRejectedValue(new Error('recusado'));

      await expect(controller.register(body())).rejects.toThrow('recusado');
    });
  });

  describe('confirmEmail', () => {
    it('delega a confirmação ao caso de uso e informa a ativação', async () => {
      const request = { token: buildEmailToken() };

      await expect(controller.confirmEmail(request)).resolves.toEqual({
        message: EMAIL_CONFIRMED_MESSAGE,
      });
      expect(confirmEmail.execute).toHaveBeenCalledWith(request);
    });

    it('propaga a recusa do token', async () => {
      confirmEmail.execute.mockRejectedValue(new Error('token inválido'));

      await expect(
        controller.confirmEmail({ token: buildEmailToken() }),
      ).rejects.toThrow('token inválido');
    });
  });

  describe('resendEmailConfirmation', () => {
    it('delega o reenvio e responde a mesma mensagem para qualquer e-mail', async () => {
      const request = { email: faker.internet.email() };

      await expect(
        controller.resendEmailConfirmation(request),
      ).resolves.toEqual({ message: CONFIRMATION_RESENT_MESSAGE });
      expect(resendEmailConfirmation.execute).toHaveBeenCalledWith(request);
    });
  });
});
