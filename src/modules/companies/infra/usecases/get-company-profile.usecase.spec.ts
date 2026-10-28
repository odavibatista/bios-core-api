import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { DependencyUnavailableException } from '@shared/domain/errors/dependency-unavailable.exception.js';
import { QueueJobFailedException } from '@shared/domain/errors/queue-job-failed.exception.js';
import { QueueTimeoutException } from '@shared/domain/errors/queue-timeout.exception.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import {
  buildCnpj,
  storedCompanyProfileFactory,
} from '@test/factories/companies/company-profile.factory.js';
import { faker } from '@test/support/faker.js';
import { CompanyDataUnavailableException } from '../../domain/dtos/errors/company-data-unavailable.exception.js';
import { CompanyNotFoundException } from '../../domain/dtos/errors/company-not-found.exception.js';
import { InvalidCnpjException } from '../../domain/dtos/errors/invalid-cnpj.exception.js';
import { FETCH_COMPANY_PROFILE_JOB } from '../../domain/dtos/providers/company-profile-job.dto.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import { GetCompanyProfileUseCase } from './get-company-profile.usecase.js';

const SEVEN_DAYS = 7 * 86_400;

describe('GetCompanyProfileUseCase', () => {
  const cacheProvider = {
    get: vi.fn<CacheProvider['get']>(),
    set: vi.fn<CacheProvider['set']>(),
  };
  const queueProvider = {
    enqueueAndWait: vi.fn<QueueProvider['enqueueAndWait']>(),
  };
  const companyProfileRepository = {
    findByCnpj: vi.fn<CompanyProfileRepository['findByCnpj']>(),
  };
  const resolveSourceCacheTtl = {
    execute: vi.fn<ResolveSourceCacheTtlUseCase['execute']>(),
  };
  let useCase: GetCompanyProfileUseCase;

  const cnpj = buildCnpj();

  beforeEach(async () => {
    vi.useFakeTimers({ now: faker.date.recent() });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    cacheProvider.get.mockResolvedValue(undefined);
    cacheProvider.set.mockResolvedValue(undefined);
    companyProfileRepository.findByCnpj.mockResolvedValue(null);
    resolveSourceCacheTtl.execute.mockResolvedValue(SEVEN_DAYS);
    queueProvider.enqueueAndWait.mockResolvedValue({ outcome: 'FOUND' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        GetCompanyProfileUseCase,
        { provide: CacheProvider, useValue: cacheProvider },
        { provide: QueueProvider, useValue: queueProvider },
        {
          provide: CompanyProfileRepository,
          useValue: companyProfileRepository,
        },
        {
          provide: ResolveSourceCacheTtlUseCase,
          useValue: resolveSourceCacheTtl,
        },
      ],
    }).compile();

    useCase = moduleRef.get(GetCompanyProfileUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Perfil guardado, atualizado há `ageSeconds` segundos. */
  function storedProfile(ageSeconds: number) {
    const refreshedAt = new Date(Date.now() - ageSeconds * 1_000);

    return storedCompanyProfileFactory.build({
      refreshedAt,
      profile: {
        ...storedCompanyProfileFactory.build().profile,
        cnpj,
        refreshed_at: refreshedAt.toISOString(),
      },
    });
  }

  describe('CNPJ', () => {
    it.each(['', '123', '00000000000000', '11222333000182', 'abc'])(
      'recusa o CNPJ inválido "%s" sem consultar nada',
      async (input) => {
        await expect(useCase.execute(input)).rejects.toBeInstanceOf(
          InvalidCnpjException,
        );

        expect(cacheProvider.get).not.toHaveBeenCalled();
        expect(queueProvider.enqueueAndWait).not.toHaveBeenCalled();
      },
    );

    it('normaliza o CNPJ com máscara antes de usá-lo como chave', async () => {
      cacheProvider.get.mockResolvedValue(undefined);
      companyProfileRepository.findByCnpj.mockResolvedValue(storedProfile(10));

      await useCase.execute('11.222.333/0001-81');

      expect(cacheProvider.get).toHaveBeenCalledWith({
        namespace: CacheNamespace.COMPANY_PROFILE,
        identifier: '11222333000181',
      });
    });
  });

  describe('cache', () => {
    it('serve do cache sem consultar o banco nem a fila', async () => {
      const cached = storedProfile(10).profile;
      cacheProvider.get.mockResolvedValue(cached);

      await expect(useCase.execute(cnpj)).resolves.toEqual(cached);

      expect(companyProfileRepository.findByCnpj).not.toHaveBeenCalled();
      expect(queueProvider.enqueueAndWait).not.toHaveBeenCalled();
    });

    it('descarta a entrada de cache que não tem o formato atual e segue adiante', async () => {
      cacheProvider.get.mockResolvedValue({ legal_name: 'formato antigo' });
      companyProfileRepository.findByCnpj.mockResolvedValue(storedProfile(10));

      const profile = await useCase.execute(cnpj);

      expect(profile.legal_name).not.toBe('formato antigo');
      expect(companyProfileRepository.findByCnpj).toHaveBeenCalled();
    });
  });

  describe('cadastro guardado dentro da validade', () => {
    it('serve do banco, sem chamar a fila', async () => {
      const stored = storedProfile(60);
      companyProfileRepository.findByCnpj.mockResolvedValue(stored);

      await expect(useCase.execute(cnpj)).resolves.toEqual(stored.profile);

      expect(queueProvider.enqueueAndWait).not.toHaveBeenCalled();
    });

    it('guarda o perfil no cache pela janela da fonte que o respondeu', async () => {
      const stored = storedCompanyProfileFactory.build({
        ...storedProfile(60),
        cadastralSourceSlug: 'OPEN_CNPJ',
      });
      companyProfileRepository.findByCnpj.mockResolvedValue(stored);
      resolveSourceCacheTtl.execute.mockResolvedValue(1234);

      await useCase.execute(cnpj);

      expect(resolveSourceCacheTtl.execute).toHaveBeenCalledWith('OPEN_CNPJ');
      expect(cacheProvider.set).toHaveBeenCalledWith(
        { namespace: CacheNamespace.COMPANY_PROFILE, identifier: cnpj },
        stored.profile,
        1234,
      );
    });

    it('considera vencido o cadastro atualizado exatamente na borda da janela', async () => {
      companyProfileRepository.findByCnpj.mockResolvedValue(
        storedProfile(SEVEN_DAYS),
      );

      await useCase.execute(cnpj);

      expect(queueProvider.enqueueAndWait).toHaveBeenCalled();
    });
  });

  describe('cadastro ausente ou vencido: atualização pela fila', () => {
    it('publica o job de consulta cadastral e espera o resultado', async () => {
      companyProfileRepository.findByCnpj
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(storedProfile(1));

      await useCase.execute(cnpj);

      expect(queueProvider.enqueueAndWait).toHaveBeenCalledWith(
        QueueName.COMPANY_PROFILE,
        FETCH_COMPANY_PROFILE_JOB,
        { cnpj },
        { jobId: expect.stringMatching(/^company-profile-[0-9A-Z]{14}-\d+$/) },
      );
    });

    it('envia à fila só o CNPJ', async () => {
      companyProfileRepository.findByCnpj
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(storedProfile(1));

      await useCase.execute(cnpj);

      const [, , payload] = queueProvider.enqueueAndWait.mock.calls[0];
      expect(payload).toEqual({ cnpj });
    });

    it('lê o cadastro gravado pelo serviço, o serve e o guarda no cache', async () => {
      const refreshed = storedProfile(1);
      companyProfileRepository.findByCnpj
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(refreshed);

      await expect(useCase.execute(cnpj)).resolves.toEqual(refreshed.profile);

      expect(cacheProvider.set).toHaveBeenCalledWith(
        { namespace: CacheNamespace.COMPANY_PROFILE, identifier: cnpj },
        refreshed.profile,
        SEVEN_DAYS,
      );
    });

    it('serve o cadastro atualizado, e não o vencido que havia antes', async () => {
      const stale = storedProfile(SEVEN_DAYS + 3_600);
      const refreshed = storedProfile(1);
      companyProfileRepository.findByCnpj
        .mockResolvedValueOnce(stale)
        .mockResolvedValueOnce(refreshed);

      await expect(useCase.execute(cnpj)).resolves.toEqual(refreshed.profile);
    });
  });

  describe('CNPJ inexistente', () => {
    it('responde "não encontrada" quando os provedores confirmam que não existe', async () => {
      queueProvider.enqueueAndWait.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(useCase.execute(cnpj)).rejects.toBeInstanceOf(
        CompanyNotFoundException,
      );
    });

    it('não guarda nada no cache', async () => {
      queueProvider.enqueueAndWait.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await useCase.execute(cnpj).catch(() => undefined);

      expect(cacheProvider.set).not.toHaveBeenCalled();
    });

    it('confia na confirmação dos provedores mesmo havendo cadastro antigo guardado', async () => {
      companyProfileRepository.findByCnpj.mockResolvedValue(
        storedProfile(SEVEN_DAYS + 1),
      );
      queueProvider.enqueueAndWait.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(useCase.execute(cnpj)).rejects.toBeInstanceOf(
        CompanyNotFoundException,
      );
    });
  });

  describe('provedores indisponíveis', () => {
    const failures: [string, () => void][] = [
      [
        'o serviço informa SOURCES_UNAVAILABLE',
        () =>
          queueProvider.enqueueAndWait.mockResolvedValue({
            outcome: 'SOURCES_UNAVAILABLE',
          }),
      ],
      [
        'o prazo da espera termina',
        () =>
          queueProvider.enqueueAndWait.mockRejectedValue(
            new QueueTimeoutException('company-profile', 'job', 10_000),
          ),
      ],
      [
        'o job esgota as tentativas e falha',
        () =>
          queueProvider.enqueueAndWait.mockRejectedValue(
            new QueueJobFailedException('company-profile', 'job', 'erro'),
          ),
      ],
      [
        'o Redis está fora do ar',
        () =>
          queueProvider.enqueueAndWait.mockRejectedValue(
            new DependencyUnavailableException('redis'),
          ),
      ],
      [
        'o resultado do job está fora do contrato',
        () => queueProvider.enqueueAndWait.mockResolvedValue({ foo: 'bar' }),
      ],
      [
        'o job não devolve resultado',
        () => queueProvider.enqueueAndWait.mockResolvedValue(undefined),
      ],
    ];

    describe.each(failures)('quando %s', (_case, makeFail) => {
      beforeEach(() => {
        makeFail();
      });

      it('sem cadastro guardado: responde "indisponível", e não "não encontrada"', async () => {
        await expect(useCase.execute(cnpj)).rejects.toBeInstanceOf(
          CompanyDataUnavailableException,
        );
      });

      it('com cadastro vencido guardado: serve o cadastro vencido', async () => {
        const stale = storedProfile(SEVEN_DAYS * 2);
        companyProfileRepository.findByCnpj.mockResolvedValue(stale);

        await expect(useCase.execute(cnpj)).resolves.toEqual(stale.profile);
      });

      it('não guarda o cadastro vencido no cache, para a próxima consulta tentar de novo', async () => {
        companyProfileRepository.findByCnpj.mockResolvedValue(
          storedProfile(SEVEN_DAYS * 2),
        );

        await useCase.execute(cnpj);

        expect(cacheProvider.set).not.toHaveBeenCalled();
      });
    });

    describe('o serviço diz FOUND mas o cadastro não foi gravado', () => {
      beforeEach(() => {
        queueProvider.enqueueAndWait.mockResolvedValue({ outcome: 'FOUND' });
      });

      it('sem cadastro guardado: responde "indisponível" e registra o erro de contrato', async () => {
        companyProfileRepository.findByCnpj.mockResolvedValue(null);

        await expect(useCase.execute(cnpj)).rejects.toBeInstanceOf(
          CompanyDataUnavailableException,
        );
        expect(Logger.prototype.error).toHaveBeenCalledWith(
          expect.stringContaining('company_profile não tem o registro'),
        );
      });

      it('com cadastro vencido guardado: serve o vencido, sem guardá-lo no cache', async () => {
        const stale = storedProfile(SEVEN_DAYS * 2);
        companyProfileRepository.findByCnpj
          .mockResolvedValueOnce(stale)
          .mockResolvedValueOnce(null);

        await expect(useCase.execute(cnpj)).resolves.toEqual(stale.profile);

        expect(cacheProvider.set).not.toHaveBeenCalled();
      });
    });

    it('registra o aviso quando serve um cadastro vencido', async () => {
      companyProfileRepository.findByCnpj.mockResolvedValue(
        storedProfile(SEVEN_DAYS * 2),
      );
      queueProvider.enqueueAndWait.mockRejectedValue(
        new QueueTimeoutException('company-profile', 'job', 10_000),
      );

      await useCase.execute(cnpj);

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('servido vencido'),
      );
    });

    it('propaga um erro inesperado da fila, em vez de escondê-lo como indisponibilidade', async () => {
      queueProvider.enqueueAndWait.mockRejectedValue(new Error('bug'));

      await expect(useCase.execute(cnpj)).rejects.toThrow('bug');
    });
  });

  it('não expõe dados de sócios: o perfil devolvido só tem os campos do schema', async () => {
    const stored = storedProfile(10);
    companyProfileRepository.findByCnpj.mockResolvedValue(stored);

    const profile = await useCase.execute(cnpj);

    expect(Object.keys(profile).sort()).toEqual([
      'address',
      'cnpj',
      'company_size',
      'legal_name',
      'main_cnae',
      'refreshed_at',
      'registration_status',
      'registration_status_unrecognized',
      'secondary_cnaes',
      'trade_name',
    ]);
  });
});
