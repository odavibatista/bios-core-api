import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { buildDuration } from '@test/factories/shared/duration.factory.js';
import { retentionPolicyFactory } from '@test/factories/shared/retention-policy.factory.js';
import { faker } from '@test/support/faker.js';
import { RETENTION_RULES } from '../../config/data-retention.config.js';
import type { Environment } from '../../config/environment.config.js';
import type { RetentionPolicy } from '../../domain/dtos/providers/retention-policy.dto.js';
import type { SyncRetentionIndexesUseCase } from '../usecases/data-retention/sync-retention-indexes.usecase.js';
import { RetentionIndexesInitializer } from './retention-indexes.initializer.js';

function indexOf({ collection, indexName }: RetentionPolicy): string {
  return `${collection}.${indexName}`;
}

describe('RetentionIndexesInitializer', () => {
  const execute = vi.fn();
  const isAvailable = vi.fn<() => Promise<boolean>>();
  let failedPolicy: RetentionPolicy;
  let failureReason: string;

  function createInitializer(syncOnBoot: boolean) {
    const configService = {
      get: (key: keyof Environment) =>
        key === 'DATA_RETENTION_SYNC_ON_BOOT' ? syncOnBoot : buildDuration(),
    } as unknown as ConfigService<Environment, true>;

    return new RetentionIndexesInitializer(configService, { isAvailable }, {
      execute,
    } as unknown as SyncRetentionIndexesUseCase);
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const createdPolicy = retentionPolicyFactory.build();
    failedPolicy = retentionPolicyFactory.build();
    failureReason = faker.lorem.sentence();

    isAvailable.mockResolvedValue(true);
    execute.mockResolvedValue({
      created: [indexOf(createdPolicy)],
      updated: [],
      unchanged: [],
      failed: [{ index: indexOf(failedPolicy), reason: failureReason }],
    });
  });

  it('sincroniza todas as políticas na inicialização', async () => {
    const { collection } = faker.helpers.arrayElement(RETENTION_RULES);

    createInitializer(true).onApplicationBootstrap();
    await vi.waitFor(() => expect(Logger.prototype.log).toHaveBeenCalled());

    expect(execute).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ collection })]),
    );
    expect(execute.mock.calls[0][0]).toHaveLength(RETENTION_RULES.length);
  });

  it('registra cada falha e o resumo da sincronização', async () => {
    await createInitializer(true).synchronize();

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      `Retenção não aplicada em ${indexOf(failedPolicy)}: ${failureReason}`,
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
