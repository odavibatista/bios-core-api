import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import { SessionResponseSchema } from '../../domain/dtos/requests/session.dto.js';
import { LoginUseCase } from '../../infra/usecases/login.usecase.js';
import { RefreshSessionUseCase } from '../../infra/usecases/refresh-session.usecase.js';
import { AuthController } from './auth.controller.js';

describe('AuthController', () => {
  const login = { execute: vi.fn() };
  const refresh = { execute: vi.fn() };
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
});
