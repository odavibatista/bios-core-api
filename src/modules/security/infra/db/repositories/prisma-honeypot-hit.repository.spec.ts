import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { faker } from '@test/support/faker.js';
import { PrismaHoneypotHitRepository } from './prisma-honeypot-hit.repository.js';

describe('PrismaHoneypotHitRepository (RF21)', () => {
  it('grava a chamada à isca com IP, caminho, método e user-agent', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const repository = new PrismaHoneypotHitRepository({
      honeypotHit: { create },
    } as unknown as PrismaService);
    const userAgent = faker.internet.userAgent();

    await repository.record({
      ip: '203.0.113.7',
      endpoint: '/v2/companies',
      httpMethod: 'GET',
      userAgent,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        ip: '203.0.113.7',
        endpoint: '/v2/companies',
        http_method: 'GET',
        user_agent: userAgent,
      },
    });
  });
});
