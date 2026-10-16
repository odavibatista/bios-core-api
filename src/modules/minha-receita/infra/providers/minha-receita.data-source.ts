import { Injectable } from '@nestjs/common';
import {
  type DataSourceInterface,
  type SourceLookupResult,
  toLookupResult,
} from '@modules/data-sources/domain/data-source.interface.js';
import type { CadastralRecord } from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';
import type { SourceCallContext } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { toCadastralRecord } from '@modules/data-sources/domain/receita-open-data.mapper.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';

/** Identificador do Minha Receita no catálogo de fontes (`data_sources.slug`). */
export const MINHA_RECEITA_SLUG = 'MINHA_RECEITA';

/**
 * Adapter do Minha Receita — fallback final do cadastro (`fallback_priority =
 * 3`), consultado quando a BrasilAPI e o OpenCNPJ não respondem (RF03).
 *
 * Isolado em módulo próprio (NFPD02): conhece o endereço do Minha Receita e
 * entrega um `CadastralRecord`, igual ao dos demais provedores. A resposta
 * dele tem o formato dos dados abertos da Receita, o mesmo da BrasilAPI, e é
 * lida pelo mapper comum (`receita-open-data.mapper.ts`). Limite por minuto,
 * tempo máximo e log de requisições vêm de `RequestDataSourceUseCase`, lidos
 * do catálogo.
 *
 * O CNPJ recebido já deve estar na forma canônica (`parseCnpj`).
 */
@Injectable()
export class MinhaReceitaDataSource implements DataSourceInterface<
  string,
  CadastralRecord
> {
  readonly slug = MINHA_RECEITA_SLUG;

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
