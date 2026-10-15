import { Test } from '@nestjs/testing';
import { AccessBlockScope, LoginFailureReason } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { faker } from '@test/support/faker.js';
import { PrismaLoginAttemptRepository } from './prisma-login-attempt.repository.js';

describe('PrismaLoginAttemptRepository', () => {
  const create = vi.fn();
  const findFirst = vi.fn();
  const count = vi.fn();
  let repository: PrismaLoginAttemptRepository;

  const ipTarget = () => ({
    scope: AccessBlockScope.IP,
    ip: faker.internet.ipv4(),
  });
  const userTarget = () => ({
    scope: AccessBlockScope.USER,
    userId: faker.database.mongodbObjectId(),
  });

  beforeEach(async () => {
    create.mockResolvedValue(undefined);
    findFirst.mockResolvedValue(null);
    count.mockResolvedValue(0);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaLoginAttemptRepository,
        {
          provide: PrismaService,
          useValue: { loginAttempt: { create, findFirst, count } },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaLoginAttemptRepository);
  });

  describe('recordFailure', () => {
    it('grava a falha com IP, motivo e conta visada', async () => {
      const attempt = {
        userId: faker.database.mongodbObjectId(),
        ip: faker.internet.ipv4(),
        reason: LoginFailureReason.INVALID_CREDENTIALS,
      };

      await repository.recordFailure(attempt);

      expect(create).toHaveBeenCalledWith({
        data: {
          user_id: attempt.userId,
          ip: attempt.ip,
          was_successful: false,
          failure_reason: attempt.reason,
        },
      });
    });

    it('grava a falha sem conta quando o e-mail não existe', async () => {
      await repository.recordFailure({
        ip: faker.internet.ipv4(),
        reason: LoginFailureReason.INVALID_CREDENTIALS,
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ user_id: undefined }),
      });
    });
  });

  describe('recordSuccess', () => {
    it('grava o sucesso, sem motivo de falha', async () => {
      const attempt = {
        userId: faker.database.mongodbObjectId(),
        ip: faker.internet.ipv4(),
      };

      await repository.recordSuccess(attempt);

      expect(create).toHaveBeenCalledWith({
        data: { user_id: attempt.userId, ip: attempt.ip, was_successful: true },
      });
    });
  });

  describe('countFailuresSinceLastSuccess', () => {
    it('conta só as falhas de senha do IP', async () => {
      const target = ipTarget();
      count.mockResolvedValue(3);

      await expect(
        repository.countFailuresSinceLastSuccess(target, null),
      ).resolves.toBe(3);

      expect(count).toHaveBeenCalledWith({
        where: {
          ip: target.ip,
          was_successful: false,
          failure_reason: LoginFailureReason.INVALID_CREDENTIALS,
        },
      });
    });

    it('conta as falhas dirigidas à conta', async () => {
      const target = userTarget();

      await repository.countFailuresSinceLastSuccess(target, null);

      expect(count).toHaveBeenCalledWith({
        where: expect.objectContaining({ user_id: target.userId }),
      });
      expect(findFirst).toHaveBeenCalledWith({
        where: { user_id: target.userId, was_successful: true },
        orderBy: { attempted_at: 'desc' },
        select: { attempted_at: true },
      });
    });

    it('recomeça a contagem depois do último login bem-sucedido', async () => {
      const lastSuccess = faker.date.recent();
      findFirst.mockResolvedValue({ attempted_at: lastSuccess });

      await repository.countFailuresSinceLastSuccess(ipTarget(), null);

      expect(count).toHaveBeenCalledWith({
        where: expect.objectContaining({ attempted_at: { gt: lastSuccess } }),
      });
    });

    it('recomeça a contagem depois do bloqueio quando ele é mais recente', async () => {
      const lastSuccess = faker.date.past();
      const blockStart = new Date(lastSuccess.getTime() + 60_000);
      findFirst.mockResolvedValue({ attempted_at: lastSuccess });

      await repository.countFailuresSinceLastSuccess(ipTarget(), blockStart);

      expect(count).toHaveBeenCalledWith({
        where: expect.objectContaining({ attempted_at: { gt: blockStart } }),
      });
    });

    it('prefere o login bem-sucedido quando ele é mais recente que o bloqueio', async () => {
      const blockStart = faker.date.past();
      const lastSuccess = new Date(blockStart.getTime() + 60_000);
      findFirst.mockResolvedValue({ attempted_at: lastSuccess });

      await repository.countFailuresSinceLastSuccess(ipTarget(), blockStart);

      expect(count).toHaveBeenCalledWith({
        where: expect.objectContaining({ attempted_at: { gt: lastSuccess } }),
      });
    });

    it('usa só o bloqueio quando nunca houve login bem-sucedido', async () => {
      const blockStart = faker.date.recent();

      await repository.countFailuresSinceLastSuccess(ipTarget(), blockStart);

      expect(count).toHaveBeenCalledWith({
        where: expect.objectContaining({ attempted_at: { gt: blockStart } }),
      });
    });

    it('não limita no tempo quando não há sucesso nem bloqueio anteriores', async () => {
      await repository.countFailuresSinceLastSuccess(ipTarget(), null);

      const [{ where }] = count.mock.calls[0] as [{ where: object }];
      expect(where).not.toHaveProperty('attempted_at');
    });
  });
});
