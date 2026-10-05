import type { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import type { Environment } from '../../config/environment.config.js';
import { UnsafeDatabaseOperationException } from '../../domain/errors/unsafe-database-operation.exception.js';
import { DatabaseSeeder } from './database-seeder.js';
import { DATABASE_HEALTH_TIMEOUT_MS, PrismaService } from './prisma.service.js';

const TEST_DATABASE_URL =
  'mongodb://localhost:27017/bios_test?directConnection=true';

function createService(
  environment: Partial<Pick<Environment, 'NODE_ENV' | 'DATABASE_URL'>> = {},
): PrismaService {
  const values: Pick<Environment, 'NODE_ENV' | 'DATABASE_URL'> = {
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    ...environment,
  };
  const configService = {
    get: (key: keyof typeof values) => values[key],
  } as unknown as ConfigService<Environment, true>;

  return new PrismaService(configService);
}

interface SeederCall {
  name: string;
  client: PrismaClient;
}

class RecordingSeeder extends DatabaseSeeder {
  constructor(
    override readonly name: string,
    private readonly calls: SeederCall[],
  ) {
    super();
  }

  override run(client: PrismaClient): Promise<void> {
    this.calls.push({ name: this.name, client });
    return Promise.resolve();
  }
}

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = createService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isAvailable', () => {
    it('retorna verdadeiro quando o banco responde ao ping', async () => {
      const ping = vi
        .spyOn(service, '$runCommandRaw')
        .mockResolvedValue({ ok: 1 });

      await expect(service.isAvailable()).resolves.toBe(true);
      expect(ping).toHaveBeenCalledWith({ ping: 1 });
    });

    it('retorna falso quando o ping falha', async () => {
      vi.spyOn(service, '$runCommandRaw').mockRejectedValue(
        new Error('offline'),
      );

      await expect(service.isAvailable()).resolves.toBe(false);
    });

    it('retorna falso quando o banco não responde dentro do tempo limite', async () => {
      vi.useFakeTimers();
      vi.spyOn(service, '$runCommandRaw').mockReturnValue(
        new Promise(() => undefined) as ReturnType<
          PrismaService['$runCommandRaw']
        >,
      );

      const availability = service.isAvailable();
      await vi.advanceTimersByTimeAsync(DATABASE_HEALTH_TIMEOUT_MS);

      await expect(availability).resolves.toBe(false);
    });
  });

  it('encerra a conexão ao destruir o módulo', async () => {
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue();

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledOnce();
  });

  describe('seed', () => {
    it('executa os seeders na ordem informada, com o próprio cliente', async () => {
      const calls: SeederCall[] = [];

      await service.seed([
        new RecordingSeeder('ods', calls),
        new RecordingSeeder('data-sources', calls),
      ]);

      expect(calls.map(({ name }) => name)).toEqual(['ods', 'data-sources']);
      expect(calls.every(({ client }) => client === service)).toBe(true);
    });
  });

  describe('reset', () => {
    it('limpa todas as coleções do banco, ignorando as de sistema', async () => {
      const runCommandRaw = vi
        .spyOn(service, '$runCommandRaw')
        .mockImplementation(
          (command) =>
            Promise.resolve(
              'listCollections' in command
                ? {
                    cursor: {
                      firstBatch: [
                        { name: 'users' },
                        { name: 'ods' },
                        { name: 'system.views' },
                      ],
                    },
                  }
                : { ok: 1 },
            ) as unknown as ReturnType<PrismaService['$runCommandRaw']>,
        );

      await service.reset();

      expect(runCommandRaw).toHaveBeenCalledWith({
        delete: 'users',
        deletes: [{ q: {}, limit: 0 }],
      });
      expect(runCommandRaw).toHaveBeenCalledWith({
        delete: 'ods',
        deletes: [{ q: {}, limit: 0 }],
      });
      expect(runCommandRaw).not.toHaveBeenCalledWith(
        expect.objectContaining({ delete: 'system.views' }),
      );
    });

    it('limpa apenas as coleções informadas', async () => {
      const runCommandRaw = vi
        .spyOn(service, '$runCommandRaw')
        .mockResolvedValue({ ok: 1 });

      await service.reset(['user_tokens']);

      expect(runCommandRaw).toHaveBeenCalledOnce();
      expect(runCommandRaw).toHaveBeenCalledWith({
        delete: 'user_tokens',
        deletes: [{ q: {}, limit: 0 }],
      });
    });
  });

  describe('proteção contra uso fora de banco descartável', () => {
    it.each([
      ['NODE_ENV diferente de test', { NODE_ENV: 'development' as const }],
      [
        'banco sem o sufixo _test',
        {
          DATABASE_URL: 'mongodb://localhost:27017/bios?directConnection=true',
        },
      ],
    ])('recusa seed e reset com %s', async (_case, environment) => {
      const unsafeService = createService(environment);
      const runCommandRaw = vi.spyOn(unsafeService, '$runCommandRaw');

      await expect(unsafeService.seed([])).rejects.toBeInstanceOf(
        UnsafeDatabaseOperationException,
      );
      await expect(unsafeService.reset()).rejects.toThrow(
        /Operação "reset" recusada/,
      );
      expect(runCommandRaw).not.toHaveBeenCalled();
    });
  });
});
