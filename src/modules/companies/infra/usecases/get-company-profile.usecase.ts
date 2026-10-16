import { Injectable, Logger } from '@nestjs/common';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import {
  type CacheKey,
  CacheNamespace,
} from '@shared/domain/dtos/providers/cache-key.dto.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { DependencyUnavailableException } from '@shared/domain/errors/dependency-unavailable.exception.js';
import { QueueJobFailedException } from '@shared/domain/errors/queue-job-failed.exception.js';
import { QueueTimeoutException } from '@shared/domain/errors/queue-timeout.exception.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import { CompanyDataUnavailableException } from '../../domain/dtos/errors/company-data-unavailable.exception.js';
import { CompanyNotFoundException } from '../../domain/dtos/errors/company-not-found.exception.js';
import { InvalidCnpjException } from '../../domain/dtos/errors/invalid-cnpj.exception.js';
import {
  type CompanyProfileJobPayload,
  CompanyProfileJobResultSchema,
  companyProfileJobId,
  FETCH_COMPANY_PROFILE_JOB,
} from '../../domain/dtos/providers/company-profile-job.dto.js';
import {
  CompanyProfileRepository,
  type StoredCompanyProfile,
} from '../../domain/dtos/repositories/company-profile.repository.js';
import {
  type CompanyProfileResponse,
  CompanyProfileResponseSchema,
} from '../../domain/dtos/requests/company-profile.dto.js';

/** Resultado de tentar atualizar o cadastro pela fila. */
type RefreshOutcome = 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE';

/**
 * Consulta o perfil cadastral de uma empresa pelo CNPJ (UC06, RF03, RF05, RF06).
 *
 * Ordem de resolução, da mais barata para a mais cara:
 *
 *  1. **Cache** (Redis): resposta imediata (NFDE02);
 *  2. **Banco**: se o cadastro guardado ainda está dentro da janela de validade
 *     da fonte, é servido e volta ao cache — sem chamada externa (NFDE01);
 *  3. **Fila**: a consulta não fala com os provedores. Publica o job na fila
 *     `company-profile` e espera, com prazo, o consumidor (`CompanyProfileProcessor`) percorrer a
 *     cadeia BrasilAPI → OpenCNPJ → Minha Receita e gravar `company_profile`.
 *
 * **Degradação graciosa (NFCO01).** Se os provedores estão indisponíveis — job
 * falho, prazo estourado, Redis fora do ar ou resposta fora do contrato — e há
 * um cadastro guardado, mesmo vencido, ele é servido: dado um pouco velho
 * serve melhor que nenhum, e `refreshed_at` mostra a idade. Ele **não** volta ao
 * cache, para que a próxima consulta tente atualizar de novo. Sem cadastro
 * guardado, a resposta é "indisponível" (503), que não se confunde com "não
 * encontrada" (404).
 *
 * @throws {InvalidCnpjException} quando o CNPJ é inválido.
 * @throws {CompanyNotFoundException} quando os provedores confirmam que o CNPJ não existe.
 * @throws {CompanyDataUnavailableException} quando os provedores estão
 * indisponíveis e não há cadastro guardado.
 */
@Injectable()
export class GetCompanyProfileUseCase extends UseCase<
  string,
  CompanyProfileResponse
> {
  private readonly logger = new Logger(GetCompanyProfileUseCase.name);

  constructor(
    private readonly cacheProvider: CacheProvider,
    private readonly queueProvider: QueueProvider,
    private readonly companyProfileRepository: CompanyProfileRepository,
    private readonly resolveSourceCacheTtlUseCase: ResolveSourceCacheTtlUseCase,
  ) {
    super();
  }

  override async execute(input: string): Promise<CompanyProfileResponse> {
    const cnpj = parseCnpj(input);

    if (!cnpj) throw new InvalidCnpjException();

    const key: CacheKey = {
      namespace: CacheNamespace.COMPANY_PROFILE,
      identifier: cnpj,
    };

    const cached = await this.readCache(key);

    if (cached) return cached;

    const stored = await this.companyProfileRepository.findByCnpj(cnpj);

    if (stored && (await this.isFresh(stored))) {
      await this.publish(key, stored);

      return stored.profile;
    }

    const outcome = await this.refresh(cnpj);

    if (outcome === 'NOT_FOUND') throw new CompanyNotFoundException();

    if (outcome === 'FOUND') {
      const refreshed = await this.companyProfileRepository.findByCnpj(cnpj);

      if (refreshed) {
        await this.publish(key, refreshed);

        return refreshed.profile;
      }

      // O serviço disse que gravou e não há registro: contrato violado.
      this.logger.error(
        `O consumidor da fila informou FOUND para ${cnpj}, mas company_profile não tem o registro.`,
      );
    }

    if (stored) {
      this.logger.warn(
        `Cadastro de ${cnpj} servido vencido (atualizado em ${stored.refreshedAt.toISOString()}): provedores indisponíveis.`,
      );

      return stored.profile;
    }

    throw new CompanyDataUnavailableException();
  }

  /** Perfil em cache, descartando o que não tem o formato atual. */
  private async readCache(
    key: CacheKey,
  ): Promise<CompanyProfileResponse | undefined> {
    const cached = await this.cacheProvider.get<unknown>(key);
    const parsed = CompanyProfileResponseSchema.safeParse(cached);

    return parsed.success ? parsed.data : undefined;
  }

  /** O cadastro guardado ainda está dentro da janela de validade da fonte? */
  private async isFresh({
    cadastralSourceSlug,
    refreshedAt,
  }: StoredCompanyProfile): Promise<boolean> {
    const ttlSeconds =
      await this.resolveSourceCacheTtlUseCase.execute(cadastralSourceSlug);

    return Date.now() < refreshedAt.getTime() + ttlSeconds * 1_000;
  }

  /** Guarda o perfil em cache pela janela da fonte que o respondeu. */
  private async publish(
    key: CacheKey,
    { profile, cadastralSourceSlug }: StoredCompanyProfile,
  ): Promise<void> {
    await this.cacheProvider.set(
      key,
      profile,
      await this.resolveSourceCacheTtlUseCase.execute(cadastralSourceSlug),
    );
  }

  /**
   * Pede ao consumidor da fila que atualize o cadastro e espera o resultado.
   *
   * Todo desfecho que não seja resposta clara dos provedores — prazo, falha do
   * job, Redis fora do ar, resultado fora do contrato — vira `UNAVAILABLE`.
   */
  private async refresh(cnpj: string): Promise<RefreshOutcome> {
    try {
      const result = await this.queueProvider.enqueueAndWait<
        CompanyProfileJobPayload,
        unknown
      >(
        QueueName.COMPANY_PROFILE,
        FETCH_COMPANY_PROFILE_JOB,
        { cnpj },
        { jobId: companyProfileJobId(cnpj) },
      );
      const parsed = CompanyProfileJobResultSchema.safeParse(result);

      if (!parsed.success) {
        this.logger.error(
          `Resultado do job de ${cnpj} fora do contrato: ${JSON.stringify(result)}`,
        );

        return 'UNAVAILABLE';
      }

      return parsed.data.outcome === 'SOURCES_UNAVAILABLE'
        ? 'UNAVAILABLE'
        : parsed.data.outcome;
    } catch (error) {
      if (
        error instanceof QueueTimeoutException ||
        error instanceof QueueJobFailedException ||
        error instanceof DependencyUnavailableException
      ) {
        this.logger.warn(
          `Atualização cadastral de ${cnpj} não concluída: ${error.message}`,
        );

        return 'UNAVAILABLE';
      }

      throw error;
    }
  }
}
