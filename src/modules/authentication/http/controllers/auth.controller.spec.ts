import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { faker } from '@test/support/faker.js';
import { SessionResponseSchema } from '../../domain/dtos/requests/session.dto.js';
import { ChangePasswordUseCase } from '../../infra/usecases/change-password.usecase.js';
import { LoginUseCase } from '../../infra/usecases/login.usecase.js';
import { LogoutUseCase } from '../../infra/usecases/logout.usecase.js';
import { RefreshSessionUseCase } from '../../infra/usecases/refresh-session.usecase.js';
import { RequestPasswordResetUseCase } from '../../infra/usecases/request-password-reset.usecase.js';
import { ResetPasswordUseCase } from '../../infra/usecases/reset-password.usecase.js';
import {
  AuthController,
  PASSWORD_RESET_REQUESTED_MESSAGE,
} from './auth.controller.js';

describe('AuthController', () => {
  const login = { execute: vi.fn() };
  const refresh = { execute: vi.fn() };
  const logout = { execute: vi.fn() };
  const changePassword = { execute: vi.fn() };
  const requestPasswordReset = { execute: vi.fn() };
  const resetPassword = { execute: vi.fn() };
  let controller: AuthController;

  const session = () => ({
    accessToken: faker.string.alphanumeric(120),
    refreshToken: faker.string.alphanumeric(43),
    expiresIn: 900,
    user: {
      id: faker.database.mongodbObjectId(),
      name: faker.person.fullName(),
      role: UserRole.USER,
    },
  });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: LoginUseCase, useValue: login },
        { provide: RefreshSessionUseCase, useValue: refresh },
        { provide: LogoutUseCase, useValue: logout },
        { provide: ChangePasswordUseCase, useValue: changePassword },
        {
          provide: RequestPasswordResetUseCase,
          useValue: requestPasswordReset,
        },
        { provide: ResetPasswordUseCase, useValue: resetPassword },
      ],
    }).compile();

    controller = moduleRef.get(AuthController);
  });

  describe('login', () => {
    it('entrega ao caso de uso as credenciais, o IP e o user-agent', async () => {
      login.execute.mockResolvedValue(session());
      const body = { email: faker.internet.email(), password: buildPassword() };
      const ip = faker.internet.ipv4();
      const userAgent = faker.internet.userAgent();

      await controller.login(body, ip, userAgent);

      expect(login.execute).toHaveBeenCalledWith({ ...body, ip, userAgent });
    });

    it('responde o par de tokens em snake_case, conforme o schema', async () => {
      const opened = session();
      login.execute.mockResolvedValue(opened);

      const response = await controller.login(
        { email: faker.internet.email(), password: buildPassword() },
        faker.internet.ipv4(),
        undefined,
      );

      expect(response).toEqual({
        access_token: opened.accessToken,
        refresh_token: opened.refreshToken,
        token_type: 'Bearer',
        expires_in: 900,
        user: opened.user,
      });
      expect(SessionResponseSchema.safeParse(response).success).toBe(true);
    });

    it('propaga a recusa do caso de uso', async () => {
      login.execute.mockRejectedValue(new Error('recusado'));

      await expect(
        controller.login(
          { email: faker.internet.email(), password: buildPassword() },
          faker.internet.ipv4(),
          undefined,
        ),
      ).rejects.toThrow('recusado');
    });
  });

  describe('refresh', () => {
    it('entrega ao caso de uso o refresh token, o IP e o user-agent', async () => {
      refresh.execute.mockResolvedValue(session());
      const refreshToken = faker.string.alphanumeric(43);
      const ip = faker.internet.ipv4();
      const userAgent = faker.internet.userAgent();

      await controller.refresh({ refresh_token: refreshToken }, ip, userAgent);

      expect(refresh.execute).toHaveBeenCalledWith({
        refreshToken,
        ip,
        userAgent,
      });
    });

    it('responde o novo par de tokens no mesmo formato do login', async () => {
      const renewed = session();
      refresh.execute.mockResolvedValue(renewed);

      const response = await controller.refresh(
        { refresh_token: faker.string.alphanumeric(43) },
        faker.internet.ipv4(),
        undefined,
      );

      expect(response).toEqual({
        access_token: renewed.accessToken,
        refresh_token: renewed.refreshToken,
        token_type: 'Bearer',
        expires_in: 900,
        user: renewed.user,
      });
      expect(SessionResponseSchema.safeParse(response).success).toBe(true);
    });

    it('propaga a recusa do caso de uso', async () => {
      refresh.execute.mockRejectedValue(new Error('sessão inválida'));

      await expect(
        controller.refresh(
          { refresh_token: faker.string.alphanumeric(43) },
          faker.internet.ipv4(),
          undefined,
        ),
      ).rejects.toThrow('sessão inválida');
    });
  });

  describe('logout', () => {
    const user: AuthenticatedUser = {
      userId: faker.database.mongodbObjectId(),
      sessionId: faker.database.mongodbObjectId(),
      familyId: faker.string.uuid(),
      role: UserRole.USER,
    };

    beforeEach(() => {
      logout.execute.mockResolvedValue(undefined);
    });

    it('encerra só o dispositivo atual', async () => {
      await expect(controller.logout(user)).resolves.toBeUndefined();

      expect(logout.execute).toHaveBeenCalledWith({ user, allDevices: false });
    });

    it('encerra todos os dispositivos no logout-all', async () => {
      await expect(controller.logoutAllDevices(user)).resolves.toBeUndefined();

      expect(logout.execute).toHaveBeenCalledWith({ user, allDevices: true });
    });

    it('propaga a falha do caso de uso', async () => {
      logout.execute.mockRejectedValue(new Error('banco fora'));

      await expect(controller.logout(user)).rejects.toThrow('banco fora');
    });
  });

  describe('changePassword', () => {
    const user: AuthenticatedUser = {
      userId: faker.database.mongodbObjectId(),
      sessionId: faker.database.mongodbObjectId(),
      familyId: faker.string.uuid(),
      role: UserRole.USER,
    };

    it('entrega ao caso de uso o usuário e as duas senhas', async () => {
      changePassword.execute.mockResolvedValue(undefined);
      const body = {
        current_password: buildPassword(),
        new_password: buildPassword(),
      };

      await expect(
        controller.changePassword(body, user),
      ).resolves.toBeUndefined();

      expect(changePassword.execute).toHaveBeenCalledWith({
        user,
        currentPassword: body.current_password,
        newPassword: body.new_password,
      });
    });

    it('propaga a recusa do caso de uso', async () => {
      changePassword.execute.mockRejectedValue(new Error('senha incorreta'));

      await expect(
        controller.changePassword(
          { current_password: buildPassword(), new_password: buildPassword() },
          user,
        ),
      ).rejects.toThrow('senha incorreta');
    });
  });

  describe('forgotPassword', () => {
    it('delega o pedido e responde a mesma mensagem para qualquer e-mail', async () => {
      requestPasswordReset.execute.mockResolvedValue(undefined);
      const body = { email: faker.internet.email() };

      await expect(controller.forgotPassword(body)).resolves.toEqual({
        message: PASSWORD_RESET_REQUESTED_MESSAGE,
      });

      expect(requestPasswordReset.execute).toHaveBeenCalledWith(body);
    });

    it('não revela na mensagem se a conta existe', () => {
      expect(PASSWORD_RESET_REQUESTED_MESSAGE).toMatch(/^Se houver/);
    });
  });

  describe('resetPassword', () => {
    it('entrega ao caso de uso o token e a nova senha', async () => {
      resetPassword.execute.mockResolvedValue(undefined);
      const body = {
        token: faker.string.alphanumeric(43),
        new_password: buildPassword(),
      };

      await expect(controller.resetPassword(body)).resolves.toBeUndefined();

      expect(resetPassword.execute).toHaveBeenCalledWith(body);
    });

    it('propaga a recusa do token', async () => {
      resetPassword.execute.mockRejectedValue(new Error('token inválido'));

      await expect(
        controller.resetPassword({
          token: faker.string.alphanumeric(43),
          new_password: buildPassword(),
        }),
      ).rejects.toThrow('token inválido');
    });
  });

  describe('exigência de autenticação', () => {
    const reflector = new Reflector();
    const isPublic = (handler: object) =>
      reflector.get<boolean | undefined>(IS_PUBLIC_ROUTE, handler as never);

    it.each(['login', 'refresh', 'forgotPassword', 'resetPassword'] as const)(
      '%s é público: não há sessão antes dele',
      (method) => {
        expect(isPublic(AuthController.prototype[method])).toBe(true);
      },
    );

    it.each(['logout', 'logoutAllDevices', 'changePassword'] as const)(
      '%s exige sessão',
      (method) => {
        expect(isPublic(AuthController.prototype[method])).toBeUndefined();
      },
    );
  });
});
