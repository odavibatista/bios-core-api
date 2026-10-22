import { Injectable } from '@nestjs/common';
import {
  SourceOutcome,
  type SourceCallContext,
} from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { ResolveSourceRequestConfigUseCase } from '@modules/data-sources/infra/usecases/request/resolve-source-request-config.usecase.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import {
  GHG_ORGANIZATIONS_CACHE_ID,
  GHG_ORGANIZATIONS_PAGE_SIZE,
  GHG_ORGANIZATIONS_TTL_SECONDS,
  GHG_ORGANIZATION_SEARCH,
  GHG_SLUG,
  GHG_SYNC_BUDGET_MS,
  GhgOrganizationsSnapshotSchema,
  ghgBaseUrl,
  readOrganizationsPage,
  type GhgOrganization,
  type GhgOrganizationsSnapshot,
} from '../../domain/ghg-inventory.js';

/**
 * A fonte do GHG está desabilitada no catálogo: a sincronização não roda, e
 * repeti-la não a reabilita (decisão operacional, como a do IBAMA).
 */
export class GhgSourceDisabledError extends Error {
  constructor() {
    super(
      'Fonte GHG_PROTOCOL desabilitada no catálogo (data_sources.is_enabled): ' +
        'o cadastro de organizações não foi sincronizado.',
    );
    this.name = 'GhgSourceDisabledError';
  }
}

/**
 * O portal não entregou o cadastro completo e dentro do contrato. O cadastro
 * anterior, se houver, segue valendo: nada foi gravado.
 */
export class GhgOrganizationsUnavailableError extends Error {
  constructor(reason: string) {
    super(`Cadastro de organizações do GHG indisponível: ${reason}.`);
    this.name = 'GhgOrganizationsUnavailableError';
  }
}

/**
 * Cadastro de organizações do Registro Público de Emissões, sincronizado em
 * segundo plano (UC07, UC14).
 *
 * Localizar a organização de uma empresa exige o cadastro inteiro (o portal não
 * filtra pelo sentido que importa: o nome cadastral *contém* o da organização).
 * Baixá-lo a cada consulta custava mais que o prazo do catálogo (~11 s medidos
 * para duas páginas de 1000), então ele é sincronizado uma vez por dia e a
 * coleta de cada CNPJ o lê daqui, sem chamada externa.
 *
 *  - **Só grava completo.** O cadastro novo substitui o anterior apenas depois
 *    de todas as páginas lidas e válidas; falha no meio não apaga nada.
 *  - **Vale por sete dias** (`GHG_ORGANIZATIONS_TTL_SECONDS`): falhas seguidas
 *    da sincronização diária não cegam a coleta de imediato.
 *  - **É cache, não fonte de verdade.** Vive no Redis e é reconstruível pela
 *    fonte; se faltar (primeira execução, Redis limpo), quem precisa dele o
 *    sincroniza na hora.
 */
@Injectable()
export class GhgOrganizationDirectory {
  private readonly key = {
    namespace: CacheNamespace.GHG_ORGANIZATIONS,
    identifier: GHG_ORGANIZATIONS_CACHE_ID,
  };

  constructor(
    private readonly request: RequestDataSourceUseCase,
    private readonly config: ResolveSourceRequestConfigUseCase,
    private readonly cache: CacheProvider,
  ) {}

  /** O cadastro sincronizado, ou `null` quando não há um válido (ausente, vencido ou fora do formato). */
  async read(): Promise<GhgOrganizationsSnapshot | null> {
    const stored = GhgOrganizationsSnapshotSchema.safeParse(
      await this.cache.get(this.key),
    );

    return stored.success ? stored.data : null;
  }

  /**
   * Lê o cadastro inteiro do portal, página a página, e o grava.
   *
   * @throws {GhgSourceDisabledError} quando a fonte está desabilitada.
   * @throws {GhgOrganizationsUnavailableError} quando o portal não entregou o
   * cadastro completo (falha, prazo, página vazia antes do total ou fora do
   * contrato); nada é gravado.
   */
  async sync(context: SourceCallContext): Promise<GhgOrganizationsSnapshot> {
    const source = await this.config.execute(GHG_SLUG);

    if (!source) {
      throw new GhgOrganizationsUnavailableError('fonte ausente do catálogo');
    }

    if (!source.isEnabled) throw new GhgSourceDisabledError();

    const deadline = Date.now() + GHG_SYNC_BUDGET_MS;
    const organizations = new Map<number, GhgOrganization>();
    let received = 0;
    let total: number;

    do {
      const remaining = deadline - Date.now();

      if (remaining <= 0) {
        throw new GhgOrganizationsUnavailableError(
          'prazo da sincronização esgotado',
        );
      }

      const response = await this.request.execute({
        slug: GHG_SLUG,
        segments: [...GHG_ORGANIZATION_SEARCH],
        body: {
          maxResultCount: GHG_ORGANIZATIONS_PAGE_SIZE,
          skipCount: received,
        },
        context,
        budgetMs: remaining,
        resolveBaseUrl: (base) => ghgBaseUrl(base),
      });

      if (
        response.outcome !== SourceOutcome.SUCCESS ||
        response.status !== 200
      ) {
        throw new GhgOrganizationsUnavailableError(
          `o portal respondeu ${response.outcome}`,
        );
      }

      let page;

      try {
        page = readOrganizationsPage(response.body);
      } catch {
        throw new GhgOrganizationsUnavailableError(
          'resposta fora do contrato esperado',
        );
      }

      // Página vazia antes do total: o cadastro mudou no meio da leitura.
      if (page.organizations.length === 0) {
        throw new GhgOrganizationsUnavailableError(
          'página vazia antes do total',
        );
      }

      total = page.total;
      received += page.organizations.length;
      for (const organization of page.organizations) {
        organizations.set(organization.id, organization);
      }
    } while (received < total);

    const snapshot = GhgOrganizationsSnapshotSchema.parse({
      syncedAt: new Date().toISOString(),
      organizations: [...organizations.values()],
    });
    await this.cache.set(this.key, snapshot, GHG_ORGANIZATIONS_TTL_SECONDS);

    return snapshot;
  }
}
