import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { SourceCallContext } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import {
  IBGE_CNAE_SLUG,
  IbgeCnaeDataSource,
} from '@modules/ibge-cnae/infra/providers/ibge-cnae.data-source.js';
import {
  type CacheKey,
  CacheNamespace,
} from '@shared/domain/dtos/providers/cache-key.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';

/** Quais CNAEs descrever e em nome de quê. */
export interface ResolveCnaeDescriptionsCommand {
  /** Códigos CNAE de 7 dígitos; repetidos são consultados uma vez. */
  codes: readonly string[];
  context: SourceCallContext;
}

/** O que o IBGE disse sobre um código. */
type IbgeLookup =
  | { kind: 'FOUND'; description: string }
  /** O código não existe na taxonomia. */
  | { kind: 'ABSENT' }
  /** O IBGE não pôde responder. */
  | { kind: 'DOWN' };

const CachedDescriptionSchema = z.object({ description: z.string().min(1) });

/**
 * Descrição oficial (IBGE) de cada CNAE pedido (RF06).
 *
 * Devolve só as descrições que conseguiu: código sem descrição não entra no
 * resultado, e quem chama mantém a que o provedor cadastral informou. Faltar
 * descrição nunca impede de gravar o cadastro.
 *
 * A descrição de uma subclasse quase não muda, então fica em cache pela janela
 * do catálogo (`IBGE_CNAE`, 30 dias no seed): uma empresa nova com os CNAEs já
 * conhecidos não gera nenhuma chamada ao IBGE.
 *
 * **Se o IBGE falha, a rodada para.** Uma empresa pode ter dezenas de CNAEs, e
 * insistir em cada um com a fonte fora do ar custaria um tempo máximo por
 * código; ao primeiro "indisponível", os demais códigos da rodada só são
 * resolvidos se já estiverem em cache.
 */
@Injectable()
export class ResolveCnaeDescriptionsUseCase extends UseCase<
  ResolveCnaeDescriptionsCommand,
  Map<string, string>
> {
  private readonly logger = new Logger(ResolveCnaeDescriptionsUseCase.name);

  constructor(
    private readonly cacheProvider: CacheProvider,
    private readonly ibgeCnaeDataSource: IbgeCnaeDataSource,
    private readonly resolveSourceCacheTtlUseCase: ResolveSourceCacheTtlUseCase,
  ) {
    super();
  }

  override async execute({
    codes,
    context,
  }: ResolveCnaeDescriptionsCommand): Promise<Map<string, string>> {
    const descriptions = new Map<string, string>();
    let sourceDown = false;

    for (const code of new Set(codes)) {
      const key: CacheKey = {
        namespace: CacheNamespace.CNAE_DESCRIPTION,
        identifier: code,
      };
      const cached = CachedDescriptionSchema.safeParse(
        await this.cacheProvider.get<unknown>(key),
      );

      if (cached.success) {
        descriptions.set(code, cached.data.description);
        continue;
      }

      if (sourceDown) continue;

      const lookup = await this.lookup(code, context);

      if (lookup.kind === 'DOWN') {
        sourceDown = true;
      } else if (lookup.kind === 'FOUND') {
        descriptions.set(code, lookup.description);
        await this.cacheProvider.set(
          key,
          { description: lookup.description },
          await this.resolveSourceCacheTtlUseCase.execute(IBGE_CNAE_SLUG),
        );
      }
    }

    return descriptions;
  }

  private async lookup(
    code: string,
    context: SourceCallContext,
  ): Promise<IbgeLookup> {
    try {
      const result = await this.ibgeCnaeDataSource.fetch(code, context);

      if (result.status === 'FOUND') {
        return { kind: 'FOUND', description: result.data.description };
      }

      if (result.status === 'NOT_FOUND') return { kind: 'ABSENT' };

      this.logger.warn(
        `IBGE indisponível (${result.reason}): CNAEs seguintes ficam com a descrição do provedor.`,
      );

      return { kind: 'DOWN' };
    } catch (error) {
      this.logger.error(
        `Falha inesperada ao consultar o IBGE: ${error instanceof Error ? error.message : String(error)}`,
      );

      return { kind: 'DOWN' };
    }
  }
}
