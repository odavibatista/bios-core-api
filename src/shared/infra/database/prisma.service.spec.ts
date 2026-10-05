import type { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import { faker } from '@test/support/faker.js';
import type { Environment } from '../../config/environment.config.js';
import { UnsafeDatabaseOperationException } from '../../domain/errors/unsafe-database-operation.exception.js';
import { DatabaseSeeder } from './database-seeder.js';
import { DATABASE_HEALTH_TIMEOUT_MS, PrismaService } from './prisma.service.js';

/** Nome aleatório em minúsculas, usado para bancos e coleções. */
function randomName(): string {
  return faker.string.alpha({ length: { min: 3, max: 12 }, casing: 'lower' });
}

function mongoUrl(databaseName: string): string {
  return `mongodb://${faker.internet.domainName()}:${faker.internet.port()}/${databaseName}?directConnection=true`;
}

const TEST_DATABASE_URL = mongoUrl(`${randomName()}_test`);

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
        new Error(faker.lorem.sentence()),
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
      const names = faker.helpers.uniqueArray(
        () => faker.lorem.slug(2),
        faker.number.int({ min: 2, max: 5 }),
      );

      await service.seed(names.map((name) => new RecordingSeeder(name, calls)));

      expect(calls.map(({ name }) => name)).toEqual(names);
      expect(calls.every(({ client }) => client === service)).toBe(true);
    });
  });

  describe('reset', () => {
    it('limpa todas as coleções do banco, ignorando as de sistema', async () => {
      const collections = faker.helpers.uniqueArray(
        randomName,
        faker.number.int({ min: 1, max: 5 }),
      );
      const systemCollection = `system.${randomName()}`;
      const runCommandRaw = vi
        .spyOn(service, '$runCommandRaw')
        .mockImplementation(
          (command) =>
            Promise.resolve(
              'listCollections' in command
                ? {
                    cursor: {
                      firstBatch: [...collections, systemCollection].map(
                        (name) => ({ name }),
                      ),
                    },
                  }
                : { ok: 1 },
            ) as unknown as ReturnType<PrismaService['$runCommandRaw']>,
        );

      await service.reset();

      for (const collection of collections) {
        expect(runCommandRaw).toHaveBeenCalledWith({
          delete: collection,
          deletes: [{ q: {}, limit: 0 }],
        });
      }
      expect(runCommandRaw).not.toHaveBeenCalledWith(
        expect.objectContaining({ delete: systemCollection }),
      );
    });

    it('limpa apenas as coleções informadas', async () => {
      const collection = randomName();
      const runCommandRaw = vi
        .spyOn(service, '$runCommandRaw')
        .mockResolvedValue({ ok: 1 });

      await service.reset([collection]);

      expect(runCommandRaw).toHaveBeenCalledOnce();
      expect(runCommandRaw).toHaveBeenCalledWith({
        delete: collection,
        deletes: [{ q: {}, limit: 0 }],
      });
    });
  });

  describe('proteção contra uso fora de banco descartável', () => {
    it.each([
      [
        'NODE_ENV diferente de test',
        {
          NODE_ENV: faker.helpers.arrayElement([
            'development',
            'production',
          ] as const),
        },
      ],
      ['banco sem o sufixo _test', { DATABASE_URL: mongoUrl(randomName()) }],
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
