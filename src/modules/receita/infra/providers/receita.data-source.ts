import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type DataSourceInterface,
  type SourceLookupResult,
  type SourceUnavailableReason,
} from '@modules/data-sources/domain/data-source.interface.js';
import type { CadastralRecord } from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';
import {
  SourceOutcome,
  type SourceCallContext,
} from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { ListCadastralChainUseCase } from '@modules/data-sources/infra/usecases/chain/list-cadastral-chain.usecase.js';
import { CADASTRAL_DATA_SOURCES } from '../../domain/cadastral-data-sources.token.js';
import type { CadastralLookup } from '../../domain/dtos/providers/cadastral-lookup.dto.js';

/** Identificador lógico da cadeia. Não é uma linha do catálogo: as chamadas são registradas por provedor. */
export const RECEITA_SLUG = 'RECEITA';

type CadastralProvider = DataSourceInterface<string, CadastralRecord>;

/**
 * Cadeia de fallback do cadastro por CNPJ — BrasilAPI → OpenCNPJ → Minha
 * Receita (RF03).
 *
 * Consulta um provedor por vez, na ordem do catálogo (`fallback_priority`,
 * só os habilitados), e para no primeiro que entrega o cadastro. O provedor
 * seguinte só é chamado quando o anterior não serve, o que poupa o limite de
 * requisições de cada fonte (NFPD01).
 *
 * Como cada desfecho é tratado:
 *  - **`FOUND`**: encerra, devolvendo o cadastro e o provedor que o respondeu.
 *  - **`UNAVAILABLE`** (erro, tempo esgotado, limite atingido, resposta fora do
 *    formato): vai ao próximo.
 *  - **`NOT_FOUND`**: também vai ao próximo. Os espelhos da Receita se
 *    atualizam em ritmos diferentes, e uma empresa aberta há pouco pode
 *    constar em um e ainda não em outro.
 *
 * A cadeia só conclui **`NOT_FOUND`** quando todos os provedores consultados
 * responderam "não encontrado". Se algum não pôde responder, a resposta é
 * `UNAVAILABLE`: dizer que a empresa não existe porque o único provedor que
 * a conheceria estava fora do ar seria uma informação falsa. Provedores
 * desabilitados não contam.
 *
 * Um erro inesperado em um provedor (um defeito, não uma falha da fonte) é
 * registrado e tratado como indisponibilidade dele: a cadeia segue.
 */
@Injectable()
export class ReceitaDataSource implements DataSourceInterface<
  string,
  CadastralLookup
> {
  readonly slug = RECEITA_SLUG;
  private readonly logger = new Logger(ReceitaDataSource.name);
  private readonly providersBySlug: ReadonlyMap<string, CadastralProvider>;

  constructor(
    @Inject(CADASTRAL_DATA_SOURCES)
    private readonly providers: readonly CadastralProvider[],
    private readonly listCadastralChain: ListCadastralChainUseCase,
  ) {
    this.providersBySlug = new Map(
      providers.map((provider) => [provider.slug, provider]),
    );
  }

  async fetch(
    cnpj: string,
    context: SourceCallContext,
  ): Promise<SourceLookupResult<CadastralLookup>> {
    const attempts: string[] = [];
    let notFound = 0;
    let unavailable = 0;
    let lastReason: SourceUnavailableReason = SourceOutcome.DISABLED;

    for (const provider of await this.chain()) {
      const result = await this.consult(provider, cnpj, context);

      if (result.status === 'FOUND') {
        return {
          status: 'FOUND',
          data: { record: result.data, sourceSlug: provider.slug },
        };
      }

      if (result.status === 'NOT_FOUND') {
        notFound += 1;
        attempts.push(`${provider.slug}: NOT_FOUND`);
        continue;
      }

      attempts.push(`${provider.slug}: ${result.reason}`);

      if (result.reason !== SourceOutcome.DISABLED) {
        unavailable += 1;
        lastReason = result.reason;
      }
    }

    if (unavailable === 0 && notFound > 0) return { status: 'NOT_FOUND' };

    return {
      status: 'UNAVAILABLE',
      reason: lastReason,
      message:
        attempts.length > 0
          ? attempts.join('; ')
          : 'nenhum provedor cadastral habilitado',
    };
  }

  /**
   * Provedores a consultar, na ordem do catálogo. Slug do catálogo sem adapter
   * registrado é erro de configuração: registrado e ignorado. Se o catálogo não
   * puder ser lido, vale a ordem de registro, para a consulta não parar por
   * isso.
   */
  private async chain(): Promise<CadastralProvider[]> {
    let slugs: string[];

    try {
      slugs = await this.listCadastralChain.execute();
    } catch (error) {
      this.logger.error(
        `Ordem da cadeia cadastral indisponível (${messageOf(error)}): usando a ordem de registro dos provedores.`,
      );

      return [...this.providers];
    }

    const chain: CadastralProvider[] = [];

    for (const slug of slugs) {
      const provider = this.providersBySlug.get(slug);

      if (provider) {
        chain.push(provider);
      } else {
        this.logger.error(
          `Fonte cadastral "${slug}" está no catálogo, mas não há adapter registrado para ela: ignorada.`,
        );
      }
    }

    return chain;
  }

  private async consult(
    provider: CadastralProvider,
    cnpj: string,
    context: SourceCallContext,
  ): Promise<SourceLookupResult<CadastralRecord>> {
    try {
      return await provider.fetch(cnpj, context);
    } catch (error) {
      this.logger.error(
        `Provedor "${provider.slug}" falhou de forma inesperada: ${messageOf(error)}`,
      );

      return {
        status: 'UNAVAILABLE',
        reason: SourceOutcome.FAILURE,
        message: messageOf(error),
      };
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
