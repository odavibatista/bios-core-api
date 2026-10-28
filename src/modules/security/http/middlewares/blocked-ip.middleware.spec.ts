import { IpBlockedException } from '../../domain/dtos/errors/ip-blocked.exception.js';
import type { BlockedIpRegistry } from '../../domain/providers/blocked-ip-registry.provider.js';
import type { HoneypotExemptions } from '../../infra/providers/honeypot-exemptions.js';
import { BlockedIpMiddleware } from './blocked-ip.middleware.js';

describe('BlockedIpMiddleware (#87)', () => {
  const registry = { isBlocked: vi.fn<BlockedIpRegistry['isBlocked']>() };
  const exemptions = { has: vi.fn<HoneypotExemptions['has']>() };
  const middleware = new BlockedIpMiddleware(
    registry as unknown as BlockedIpRegistry,
    exemptions as unknown as HoneypotExemptions,
  );
  const next = vi.fn();

  beforeEach(() => {
    exemptions.has.mockReturnValue(false);
    registry.isBlocked.mockResolvedValue(false);
  });

  it('IP bloqueado: 403 ACCESS_BLOCKED, sem seguir', async () => {
    registry.isBlocked.mockResolvedValue(true);

    await expect(
      middleware.use({ ip: '::ffff:203.0.113.7' }, {}, next),
    ).rejects.toBeInstanceOf(IpBlockedException);
    expect(registry.isBlocked).toHaveBeenCalledWith('203.0.113.7');
    expect(next).not.toHaveBeenCalled();
  });

  it('IP livre: segue', async () => {
    await middleware.use({ ip: '203.0.113.7' }, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('IP isento: segue sem consultar', async () => {
    exemptions.has.mockReturnValue(true);

    await middleware.use({ ip: '127.0.0.1' }, {}, next);

    expect(registry.isBlocked).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('sem IP conhecido: segue', async () => {
    await middleware.use({}, {}, next);

    expect(registry.isBlocked).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('nem Redis nem banco respondem: segue (o honeypot não derruba as rotas reais, NFSE07)', async () => {
    registry.isBlocked.mockRejectedValue(new Error('tudo fora'));

    await middleware.use({ ip: '203.0.113.7' }, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('a recusa é 403 com código próprio, sem dizer o motivo', () => {
    const error = new IpBlockedException();

    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe('ACCESS_BLOCKED');
    expect(error.message).not.toMatch(/honeypot|isca/i);
  });
});
