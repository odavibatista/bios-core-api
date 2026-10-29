import type { ConfigService } from '@nestjs/config';
import type { HttpAdapterHost } from '@nestjs/core';
import type { Environment } from '../../config/environment.config.js';
import { TrustProxySetup } from './trust-proxy.setup.js';

describe('TrustProxySetup (#87)', () => {
  const config = (value: unknown) =>
    ({ get: () => value }) as unknown as ConfigService<Environment, true>;

  it.each([[false], [1], [['loopback', '10.0.0.0/8']]])(
    'aplica TRUST_PROXY=%j ao trust proxy do Express',
    (value) => {
      const set = vi.fn();
      const host = {
        httpAdapter: { getInstance: () => ({ set }) },
      } as unknown as HttpAdapterHost;

      new TrustProxySetup(host, config(value)).onModuleInit();

      expect(set).toHaveBeenCalledWith('trust proxy', value);
    },
  );

  it('sem servidor HTTP, não faz nada', () => {
    const host = { httpAdapter: undefined } as unknown as HttpAdapterHost;

    expect(() =>
      new TrustProxySetup(host, config(1)).onModuleInit(),
    ).not.toThrow();
  });
});
