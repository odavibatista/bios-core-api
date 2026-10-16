import { Injectable } from '@nestjs/common';
import { normalizeCnaeCode } from '@modules/data-sources/domain/cadastral-normalizers.js';
import {
  type DataSourceInterface,
  type SourceLookupResult,
  toLookupResult,
} from '@modules/data-sources/domain/data-source.interface.js';
import {
  SourceOutcome,
  type SourceCallContext,
} from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import type { CnaeDescription } from '../../domain/dtos/providers/cnae-description.dto.js';
import { readCnaeDescription } from '../../domain/ibge-cnae.mapper.js';

/** Identificador do IBGE (CNAE) no catálogo de fontes (`data_sources.slug`). */
export const IBGE_CNAE_SLUG = 'IBGE_CNAE';

/**
 * Adapter do IBGE — descrição textual da atividade econômica (RF06).
 *
 * Os provedores do cadastro informam o **código** do CNAE e, às vezes, uma
 * descrição própria; o IBGE é a fonte oficial da taxonomia. Este adapter
 * consulta uma subclasse por código (`GET {base_url}/subclasses/{código}`) e
 * entrega `CnaeDescription`.
 *
 * Isolado em módulo próprio (NFPD02). Limite por minuto, tempo máximo e log de
 * requisições vêm de `RequestDataSourceUseCase`, lidos do catálogo. A
 * descrição de uma subclasse quase não muda, então quem consome deve
 * guardá-la pela janela `cache_ttl_seconds` da fonte (30 dias no seed), e não
 * consultar o IBGE a cada empresa.
 *
 * A consulta é pelo código normalizado; um código que não é de 7 dígitos
 * resulta em `NOT_FOUND`, sem chamada.
 */
@Injectable()
export class IbgeCnaeDataSource implements DataSourceInterface<
  string,
  CnaeDescription
> {
  readonly slug = IBGE_CNAE_SLUG;

  constructor(private readonly requestDataSource: RequestDataSourceUseCase) {}

  async fetch(
    cnaeCode: string,
    context: SourceCallContext,
  ): Promise<SourceLookupResult<CnaeDescription>> {
    const code = normalizeCnaeCode(cnaeCode);

    if (code === null) return { status: 'NOT_FOUND' };

    const response = await this.requestDataSource.execute({
      slug: this.slug,
      segments: ['subclasses', code],
      context,
    });

    // Resposta bem formada sem a subclasse: o código não existe na taxonomia.
    if (
      response.outcome === SourceOutcome.SUCCESS &&
      readCnaeDescription(response.body, code).kind === 'ABSENT'
    ) {
      return { status: 'NOT_FOUND' };
    }

    return toLookupResult(response, (body) => {
      const lookup = readCnaeDescription(body, code);

      return lookup.kind === 'FOUND' ? lookup.value : null;
    });
  }
}
