import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { buildEmailToken } from '@test/factories/mailing/email-template.factory.js';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { ConfirmEmailChangeUseCase } from '../../infra/usecases/confirm-email-change.usecase.js';
import { ConfirmEmailUseCase } from '../../infra/usecases/confirm-email.usecase.js';
import { DeleteOwnAccountUseCase } from '../../infra/usecases/delete-own-account.usecase.js';
import { GetOwnAccountUseCase } from '../../infra/usecases/get-own-account.usecase.js';
import { RegisterUserUseCase } from '../../infra/usecases/register-user.usecase.js';
import { RequestEmailChangeUseCase } from '../../infra/usecases/request-email-change.usecase.js';
import { UpdateOwnAccountUseCase } from '../../infra/usecases/update-own-account.usecase.js';
import { ResendEmailConfirmationUseCase } from '../../infra/usecases/resend-email-confirmation.usecase.js';
import {
  AccountsController,
  CONFIRMATION_RESENT_MESSAGE,
  EMAIL_CHANGE_REQUESTED_MESSAGE,
  EMAIL_CHANGED_MESSAGE,
  EMAIL_CONFIRMED_MESSAGE,
  REGISTRATION_ACCEPTED_MESSAGE,
} from './accounts.controller.js';

describe('AccountsController', () => {
  const registerUser = { execute: vi.fn() };
  const confirmEmail = { execute: vi.fn() };
  const resendEmailConfirmation = { execute: vi.fn() };
  const getOwnAccount = { execute: vi.fn() };
  const updateOwnAccount = { execute: vi.fn() };
  const requestEmailChange = { execute: vi.fn() };
  const confirmEmailChange = { execute: vi.fn() };
  const deleteOwnAccount = { execute: vi.fn() };
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
        { provide: GetOwnAccountUseCase, useValue: getOwnAccount },
        { provide: UpdateOwnAccountUseCase, useValue: updateOwnAccount },
        { provide: RequestEmailChangeUseCase, useValue: requestEmailChange },
        { provide: ConfirmEmailChangeUseCase, useValue: confirmEmailChange },
        { provide: DeleteOwnAccountUseCase, useValue: deleteOwnAccount },
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

  describe('conta autenticada', () => {
    const user: AuthenticatedUser = {
      userId: faker.database.mongodbObjectId(),
      sessionId: faker.database.mongodbObjectId(),
      familyId: faker.string.uuid(),
      role: UserRole.USER,
    };
    const account = {
      id: user.userId,
      name: faker.person.fullName(),
      email: faker.internet.email(),
      address: null,
      role: UserRole.USER,
    };

    it('getOwnAccount: lê a conta do usuário autenticado', async () => {
      getOwnAccount.execute.mockResolvedValue(account);

      await expect(controller.getOwnAccount(user)).resolves.toBe(account);

      expect(getOwnAccount.execute).toHaveBeenCalledWith(user.userId);
    });

    it('updateOwnAccount: edita a conta do usuário autenticado, nunca a de outro', async () => {
      updateOwnAccount.execute.mockResolvedValue(account);

      await expect(
        controller.updateOwnAccount({ name: 'Maria Souza' }, user),
      ).resolves.toBe(account);

      expect(updateOwnAccount.execute).toHaveBeenCalledWith({
        name: 'Maria Souza',
        userId: user.userId,
      });
    });

    it('requestEmailChange: delega o pedido e responde a mesma mensagem', async () => {
      requestEmailChange.execute.mockResolvedValue(undefined);
      const body = {
        new_email: faker.internet.email(),
        current_password: buildPassword(),
      };

      await expect(controller.requestEmailChange(body, user)).resolves.toEqual({
        message: EMAIL_CHANGE_REQUESTED_MESSAGE,
      });

      expect(requestEmailChange.execute).toHaveBeenCalledWith({
        user,
        request: body,
      });
    });

    it('confirmEmailChange: delega a confirmação e informa a troca', async () => {
      confirmEmailChange.execute.mockResolvedValue(undefined);
      const body = { token: buildEmailToken() };

      await expect(controller.confirmEmailChange(body)).resolves.toEqual({
        message: EMAIL_CHANGED_MESSAGE,
      });

      expect(confirmEmailChange.execute).toHaveBeenCalledWith(body);
    });

    it('deleteOwnAccount: exclui a conta do usuário autenticado', async () => {
      deleteOwnAccount.execute.mockResolvedValue(undefined);
      const body = { password: buildPassword() };

      await expect(
        controller.deleteOwnAccount(body, user),
      ).resolves.toBeUndefined();

      expect(deleteOwnAccount.execute).toHaveBeenCalledWith({
        user,
        request: body,
      });
    });

    it.each([
      ['getOwnAccount', () => getOwnAccount],
      ['requestEmailChange', () => requestEmailChange],
      ['deleteOwnAccount', () => deleteOwnAccount],
    ])('%s: propaga a recusa do caso de uso', async (method, useCase) => {
      useCase().execute.mockRejectedValue(new Error('recusado'));
      const call = (
        controller as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      )[method];

      await expect(
        call.call(
          controller,
          { password: 'x', new_email: 'a@b.com', current_password: 'x' },
          user,
        ),
      ).rejects.toThrow('recusado');
    });
  });

  describe('exigência de autenticação', () => {
    const reflector = new Reflector();
    const isPublic = (handler: object) =>
      reflector.get<boolean | undefined>(IS_PUBLIC_ROUTE, handler as never);

    it.each([
      'register',
      'confirmEmail',
      'resendEmailConfirmation',
      'confirmEmailChange',
    ] as const)('%s é público: não há sessão nesse ponto', (method) => {
      expect(isPublic(AccountsController.prototype[method])).toBe(true);
    });

    it.each([
      'getOwnAccount',
      'updateOwnAccount',
      'requestEmailChange',
      'deleteOwnAccount',
    ] as const)('%s exige sessão', (method) => {
      expect(isPublic(AccountsController.prototype[method])).toBeUndefined();
    });

    it('o controller como um todo não é público: o padrão é exigir sessão', () => {
      expect(isPublic(AccountsController)).toBeUndefined();
    });
  });
});
