import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { RETENTION_RULES } from '../../config/data-retention.config.js';
import type { Environment } from '../../config/environment.config.js';
import { Duration } from '../../domain/value-objects/duration.js';
import type { SyncRetentionIndexesUseCase } from '../usecases/data-retention/sync-retention-indexes.usecase.js';
import { RetentionIndexesInitializer } from './retention-indexes.initializer.js';

describe('RetentionIndexesInitializer', () => {
  const execute = vi.fn();
  const isAvailable = vi.fn<() => Promise<boolean>>();

  function createInitializer(syncOnBoot: boolean) {
    const configService = {
      get: (key: keyof Environment) =>
        key === 'DATA_RETENTION_SYNC_ON_BOOT'
          ? syncOnBoot
          : Duration.parse('7d'),
    } as unknown as ConfigService<Environment, true>;

    return new RetentionIndexesInitializer(configService, { isAvailable }, {
      execute,
    } as unknown as SyncRetentionIndexesUseCase);
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    isAvailable.mockResolvedValue(true);
    execute.mockResolvedValue({
      created: ['user_tokens.idx_user_tokens_expires_at'],
      updated: [],
      unchanged: [],
      failed: [
        { index: 'honeypot_hits.idx_honeypot_hits_hit_at', reason: 'timeout' },
      ],
    });
  });

  it('sincroniza todas as políticas na inicialização', async () => {
    createInitializer(true).onApplicationBootstrap();
    await vi.waitFor(() => expect(Logger.prototype.log).toHaveBeenCalled());

    expect(execute).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ collection: 'user_tokens' }),
      ]),
    );
    expect(execute.mock.calls[0][0]).toHaveLength(RETENTION_RULES.length);
  });

  it('registra cada falha e o resumo da sincronização', async () => {
    await createInitializer(true).synchronize();

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'Retenção não aplicada em honeypot_hits.idx_honeypot_hits_hit_at: timeout',
    );
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.stringContaining('1 criado(s)'),
    );
  });

  it('adia a sincronização com um único aviso quando o banco está indisponível', async () => {
    isAvailable.mockResolvedValue(false);

    await createInitializer(true).synchronize();

    expect(execute).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledOnce();
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('não sincroniza quando desativado por configuração', () => {
    createInitializer(false).onApplicationBootstrap();

    expect(isAvailable).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
