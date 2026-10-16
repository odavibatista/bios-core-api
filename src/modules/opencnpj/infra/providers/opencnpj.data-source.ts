import { Injectable } from '@nestjs/common';
import {
  type DataSourceInterface,
  type SourceLookupResult,
  toLookupResult,
} from '@modules/data-sources/domain/data-source.interface.js';
import type { CadastralRecord } from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';
import type { SourceCallContext } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { toCadastralRecord } from '../../domain/opencnpj-cnpj.mapper.js';

/** Identificador do OpenCNPJ no catálogo de fontes (`data_sources.slug`). */
export const OPEN_CNPJ_SLUG = 'OPEN_CNPJ';

/**
 * Adapter do OpenCNPJ — primeiro fallback cadastral (`fallback_priority = 2`),
 * consultado quando a BrasilAPI não responde (RF03).
 *
 * Isolado em módulo próprio (NFPD02): conhece o endereço e o formato de
 * resposta do OpenCNPJ e entrega um `CadastralRecord`, igual ao dos demais
 * provedores. Limite por minuto, tempo máximo e log de requisições vêm de
 * `RequestDataSourceUseCase`, lidos do catálogo.
 *
 * O CNPJ recebido já deve estar na forma canônica (`parseCnpj`).
 */
@Injectable()
export class OpenCnpjDataSource implements DataSourceInterface<
  string,
  CadastralRecord
> {
  readonly slug = OPEN_CNPJ_SLUG;

  constructor(private readonly requestDataSource: RequestDataSourceUseCase) {}

  async fetch(
    cnpj: string,
    context: SourceCallContext,
  ): Promise<SourceLookupResult<CadastralRecord>> {
    const response = await this.requestDataSource.execute({
      slug: this.slug,
      segments: [cnpj],
      cnpj,
      context,
    });

    return toLookupResult(response, (body) => toCadastralRecord(body, cnpj));
  }
}
