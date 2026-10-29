import { Test } from '@nestjs/testing';
import { AccessBlockReason, AccessBlockScope } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { faker } from '@test/support/faker.js';
import type { AccessBlockTarget } from '../../../domain/dtos/repositories/access-block.repository.js';
import { PrismaAccessBlockRepository } from './prisma-access-block.repository.js';

describe('PrismaAccessBlockRepository', () => {
  const findMany = vi.fn();
  const findFirst = vi.fn();
  const create = vi.fn();
  let repository: PrismaAccessBlockRepository;

  const ipTarget = (): AccessBlockTarget => ({
    scope: AccessBlockScope.IP,
    ip: faker.internet.ipv4(),
  });
  const userTarget = (): AccessBlockTarget => ({
    scope: AccessBlockScope.USER,
    userId: faker.database.mongodbObjectId(),
  });

  beforeEach(async () => {
    findMany.mockResolvedValue([]);
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaAccessBlockRepository,
        {
          provide: PrismaService,
          useValue: { accessBlock: { findMany, findFirst, create } },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaAccessBlockRepository);
  });

  describe('findPermanentlyBlockedIps (honeypot, #87)', () => {
    it('lê os bloqueios de IP sem prazo (nulo ou ausente), sem repetir IP', async () => {
      findMany.mockResolvedValue([
        { ip: '203.0.113.7' },
        { ip: '203.0.113.7' },
        { ip: '198.51.100.1' },
        { ip: null },
      ]);

      await expect(repository.findPermanentlyBlockedIps()).resolves.toEqual([
        '203.0.113.7',
        '198.51.100.1',
      ]);
      expect(findMany).toHaveBeenCalledWith({
        where: {
          scope: AccessBlockScope.IP,
          OR: [{ blocked_until: null }, { blocked_until: { isSet: false } }],
        },
        select: { ip: true },
      });
    });
  });

  describe('findActive', () => {
    it('não consulta o banco sem alvos', async () => {
      await expect(repository.findActive([], new Date())).resolves.toBeNull();
      expect(findMany).not.toHaveBeenCalled();
    });

    it('procura bloqueios do IP e da conta ainda em vigor ou sem prazo', async () => {
      const ip = ipTarget() as { scope: 'IP'; ip: string };
      const user = userTarget() as { scope: 'USER'; userId: string };
      const now = faker.date.recent();

      await repository.findActive([ip, user], now);

      expect(findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { scope: AccessBlockScope.IP, ip: ip.ip },
            { scope: AccessBlockScope.USER, user_id: user.userId },
          ],
          AND: [
            {
              OR: [
                { blocked_until: { gt: now } },
                { blocked_until: null },
                { blocked_until: { isSet: false } },
              ],
            },
          ],
        },
        select: { blocked_until: true },
      });
    });

    it('devolve null quando nenhum bloqueio está em vigor', async () => {
      findMany.mockResolvedValue([]);

      await expect(
        repository.findActive([ipTarget()], new Date()),
      ).resolves.toBeNull();
    });

    it('devolve o fim do bloqueio', async () => {
      const until = faker.date.soon();
      findMany.mockResolvedValue([{ blocked_until: until }]);

      await expect(
        repository.findActive([ipTarget()], new Date()),
      ).resolves.toEqual({ blockedUntil: until });
    });

    it('devolve o bloqueio que dura mais quando há vários', async () => {
      const sooner = faker.date.soon({ days: 1 });
      const later = new Date(sooner.getTime() + 600_000);
      findMany.mockResolvedValue([
        { blocked_until: sooner },
        { blocked_until: later },
      ]);

      await expect(
        repository.findActive([ipTarget(), userTarget()], new Date()),
      ).resolves.toEqual({ blockedUntil: later });
    });

    it('trata o bloqueio sem prazo como o mais longo de todos', async () => {
      findMany.mockResolvedValue([
        { blocked_until: faker.date.soon() },
        { blocked_until: null },
      ]);

      await expect(
        repository.findActive([ipTarget(), userTarget()], new Date()),
      ).resolves.toEqual({ blockedUntil: null });
    });
  });

  describe('create', () => {
    it('grava o bloqueio de IP sem usuário', async () => {
      const target = ipTarget() as { scope: 'IP'; ip: string };
      const blockedUntil = faker.date.soon();

      await repository.create({
        target,
        reason: AccessBlockReason.LOGIN_ATTEMPTS,
        blockedUntil,
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          scope: AccessBlockScope.IP,
          ip: target.ip,
          user_id: undefined,
          reason: AccessBlockReason.LOGIN_ATTEMPTS,
          blocked_until: blockedUntil,
        },
      });
    });

    it('grava o bloqueio de conta sem IP', async () => {
      const target = userTarget() as { scope: 'USER'; userId: string };

      await repository.create({
        target,
        reason: AccessBlockReason.LOGIN_ATTEMPTS,
        blockedUntil: faker.date.soon(),
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scope: AccessBlockScope.USER,
          ip: undefined,
          user_id: target.userId,
        }),
      });
    });

    it('omite o prazo do bloqueio sem prazo', async () => {
      await repository.create({
        target: ipTarget(),
        reason: AccessBlockReason.HONEYPOT,
        blockedUntil: null,
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ blocked_until: undefined }),
      });
    });
  });

  describe('findLastLoginBlockStart', () => {
    it('devolve a criação do bloqueio por tentativas mais recente do alvo', async () => {
      const target = ipTarget() as { scope: 'IP'; ip: string };
      const createdAt = faker.date.recent();
      findFirst.mockResolvedValue({ created_at: createdAt });

      await expect(repository.findLastLoginBlockStart(target)).resolves.toBe(
        createdAt,
      );

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          scope: AccessBlockScope.IP,
          ip: target.ip,
          reason: AccessBlockReason.LOGIN_ATTEMPTS,
        },
        orderBy: { created_at: 'desc' },
        select: { created_at: true },
      });
    });

    it('devolve null quando o alvo nunca foi bloqueado', async () => {
      findFirst.mockResolvedValue(null);

      await expect(
        repository.findLastLoginBlockStart(userTarget()),
      ).resolves.toBeNull();
    });
  });
});
