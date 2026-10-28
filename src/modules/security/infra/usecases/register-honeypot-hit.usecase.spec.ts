import { AccessBlockReason, AccessBlockScope } from '@prisma/client';
import { faker } from '@test/support/faker.js';
import type { AccessBlockRepository } from '../../domain/dtos/repositories/access-block.repository.js';
import type { HoneypotHitRepository } from '../../domain/dtos/repositories/honeypot-hit.repository.js';
import type { BlockedIpRegistry } from '../../domain/providers/blocked-ip-registry.provider.js';
import type { HoneypotExemptions } from '../providers/honeypot-exemptions.js';
import { RegisterHoneypotHitUseCase } from './register-honeypot-hit.usecase.js';

describe('RegisterHoneypotHitUseCase (RF21)', () => {
  const hits = { record: vi.fn<HoneypotHitRepository['record']>() };
  const blocks = {
    create: vi.fn<AccessBlockRepository['create']>(),
  };
  const registry = {
    isBlocked: vi.fn<BlockedIpRegistry['isBlocked']>(),
    add: vi.fn<BlockedIpRegistry['add']>(),
  };
  const exemptions = { has: vi.fn<HoneypotExemptions['has']>() };
  const useCase = new RegisterHoneypotHitUseCase(
    hits,
    blocks as unknown as AccessBlockRepository,
    registry,
    exemptions as unknown as HoneypotExemptions,
  );
  const hit = () => ({
    ip: faker.internet.ipv4(),
    endpoint: '/v2/companies',
    httpMethod: 'GET',
    userAgent: faker.internet.userAgent(),
  });

  beforeEach(() => {
    exemptions.has.mockReturnValue(false);
    registry.isBlocked.mockResolvedValue(false);
  });

  it('registra a chamada e bloqueia o IP sem prazo, no banco e no registro', async () => {
    const input = hit();

    await expect(useCase.execute(input)).resolves.toBe('BLOCKED');

    expect(hits.record).toHaveBeenCalledWith(input);
    expect(blocks.create).toHaveBeenCalledWith({
      target: { scope: AccessBlockScope.IP, ip: input.ip },
      reason: AccessBlockReason.HONEYPOT,
      blockedUntil: null,
    });
    expect(registry.add).toHaveBeenCalledWith(input.ip);
  });

  it('grava o banco antes do registro rápido: o banco é a fonte de verdade', async () => {
    const order: string[] = [];
    blocks.create.mockImplementation(() => {
      order.push('banco');
      return Promise.resolve();
    });
    registry.add.mockImplementation(() => {
      order.push('registro');
      return Promise.resolve();
    });

    await useCase.execute(hit());

    expect(order).toEqual(['banco', 'registro']);
  });

  it('normaliza o IPv4 escrito como IPv6 antes de gravar e bloquear', async () => {
    await useCase.execute({ ...hit(), ip: '::ffff:203.0.113.9' });

    expect(hits.record).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '203.0.113.9' }),
    );
    expect(registry.add).toHaveBeenCalledWith('203.0.113.9');
  });

  it('IP isento: só registra', async () => {
    exemptions.has.mockReturnValue(true);

    await expect(useCase.execute(hit())).resolves.toBe('EXEMPT');

    expect(hits.record).toHaveBeenCalled();
    expect(blocks.create).not.toHaveBeenCalled();
    expect(registry.add).not.toHaveBeenCalled();
  });

  it('IP já bloqueado: registra, sem bloqueio novo', async () => {
    registry.isBlocked.mockResolvedValue(true);

    await expect(useCase.execute(hit())).resolves.toBe('ALREADY_BLOCKED');

    expect(blocks.create).not.toHaveBeenCalled();
  });

  it('propaga a falha do banco (quem chama decide não derrubar a isca)', async () => {
    hits.record.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute(hit())).rejects.toThrow('banco fora');
  });
});
