import { Injectable } from '@nestjs/common';
import {
  type DataSourceInterface,
  type SourceLookupResult,
  toLookupResult,
} from '@modules/data-sources/domain/data-source.interface.js';
import type { CadastralRecord } from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';
import type { SourceCallContext } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { toCadastralRecord } from '../../domain/brasil-api-cnpj.mapper.js';

/** Identificador da BrasilAPI no catálogo de fontes (`data_sources.slug`). */
export const BRASIL_API_SLUG = 'BRASIL_API';

/**
 * Adapter da BrasilAPI — consulta cadastral por CNPJ (RF03), provedor
 * principal da cadeia de fallback (`fallback_priority = 1`).
 *
 * Isolado em módulo próprio (NFPD02): conhece o endereço e o formato de
 * resposta da BrasilAPI e entrega um `CadastralRecord`, igual ao dos demais
 * provedores. O que é comum a todas as fontes — limite por minuto, tempo
 * máximo, log de requisições — vem de `RequestDataSourceUseCase`, lido do
 * catálogo; nada disso está repetido aqui.
 *
 * O CNPJ recebido já deve estar na forma canônica (`parseCnpj`).
 */
@Injectable()
export class BrasilApiDataSource implements DataSourceInterface<
  string,
  CadastralRecord
> {
  readonly slug = BRASIL_API_SLUG;

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
