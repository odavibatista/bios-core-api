import { AccessBlockScope } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { AccessBlockRepository } from '../../domain/dtos/repositories/access-block.repository.js';
import {
  BLOCKED_IPS_KEY,
  RedisBlockedIpRegistry,
} from './redis-blocked-ip-registry.provider.js';

describe('RedisBlockedIpRegistry (#87)', () => {
  const client = {
    sismember: vi.fn<(key: string, member: string) => Promise<number>>(),
    sadd: vi.fn<(key: string, ...members: string[]) => Promise<number>>(),
  };
  const blocks = {
    findActive: vi.fn<AccessBlockRepository['findActive']>(),
    findPermanentlyBlockedIps:
      vi.fn<AccessBlockRepository['findPermanentlyBlockedIps']>(),
  };
  const registry = new RedisBlockedIpRegistry(
    client as unknown as Redis,
    blocks as unknown as AccessBlockRepository,
  );
  const ip = '203.0.113.7';

  it('consulta o conjunto do Redis', async () => {
    client.sismember.mockResolvedValue(1);

    await expect(registry.isBlocked(ip)).resolves.toBe(true);
    expect(client.sismember).toHaveBeenCalledWith(BLOCKED_IPS_KEY, ip);

    client.sismember.mockResolvedValue(0);
    await expect(registry.isBlocked(ip)).resolves.toBe(false);
    expect(blocks.findActive).not.toHaveBeenCalled();
  });

  describe('Redis fora do ar: o banco responde', () => {
    beforeEach(() => {
      client.sismember.mockRejectedValue(new Error('redis fora'));
    });

    it('bloqueio sem prazo do IP: bloqueado', async () => {
      blocks.findActive.mockResolvedValue({ blockedUntil: null });

      await expect(registry.isBlocked(ip)).resolves.toBe(true);
      expect(blocks.findActive).toHaveBeenCalledWith(
        [{ scope: AccessBlockScope.IP, ip }],
        expect.any(Date),
      );
    });

    it('só bloqueio temporário (login): não é o honeypot, não bloqueia toda rota', async () => {
      blocks.findActive.mockResolvedValue({
        blockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(registry.isBlocked(ip)).resolves.toBe(false);
    });

    it('sem bloqueio: liberado', async () => {
      blocks.findActive.mockResolvedValue(null);

      await expect(registry.isBlocked(ip)).resolves.toBe(false);
    });

    it('banco também fora: a falha chega a quem chamou', async () => {
      blocks.findActive.mockRejectedValue(new Error('banco fora'));

      await expect(registry.isBlocked(ip)).rejects.toThrow('banco fora');
    });
  });

  it('add espelha o IP no conjunto; falha do Redis não é propagada', async () => {
    client.sadd.mockResolvedValue(1);
    await registry.add(ip);
    expect(client.sadd).toHaveBeenCalledWith(BLOCKED_IPS_KEY, ip);

    client.sadd.mockRejectedValue(new Error('redis fora'));
    await expect(registry.add(ip)).resolves.toBeUndefined();
  });

  describe('subida da API', () => {
    it('recarrega no Redis os IPs bloqueados sem prazo do banco', async () => {
      client.sadd.mockResolvedValue(2);
      blocks.findPermanentlyBlockedIps.mockResolvedValue([ip, '198.51.100.1']);

      await registry.onApplicationBootstrap();

      expect(client.sadd).toHaveBeenCalledWith(
        BLOCKED_IPS_KEY,
        ip,
        '198.51.100.1',
      );
    });

    it('sem bloqueios, não escreve nada', async () => {
      blocks.findPermanentlyBlockedIps.mockResolvedValue([]);

      await registry.onApplicationBootstrap();

      expect(client.sadd).not.toHaveBeenCalled();
    });

    it('falha ao recarregar não impede a API de subir', async () => {
      blocks.findPermanentlyBlockedIps.mockRejectedValue(
        new Error('banco fora'),
      );

      await expect(registry.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });
});
