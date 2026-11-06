import { Injectable } from '@nestjs/common';
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
import type { PostalAddress } from '../../domain/dtos/providers/postal-address.dto.js';
import {
  normalizePostalCode,
  readPostalAddress,
} from '../../domain/viacep.mapper.js';

/** Identificador do ViaCEP no catálogo de fontes (`data_sources.slug`). */
export const VIACEP_SLUG = 'VIACEP';

/**
 * Adapter do ViaCEP — endereço a partir do CEP (RF39).
 *
 * Consulta `GET {base_url}/{cep}/json` e entrega `PostalAddress`. Limite por minuto, tempo máximo
 * e log de requisições vêm de `RequestDataSourceUseCase`, lidos do catálogo, e o log não guarda o
 * CEP. Só o CEP sai do BIOS, sem nenhum dado da conta.
 *
 * Isolado em módulo próprio (NFPD02). Um CEP fora do formato resulta em `NOT_FOUND`, sem chamada.
 */
@Injectable()
export class ViaCepDataSource implements DataSourceInterface<
  string,
  PostalAddress
> {
  readonly slug = VIACEP_SLUG;

  constructor(private readonly requestDataSource: RequestDataSourceUseCase) {}

  async fetch(
    postalCode: string,
    context: SourceCallContext,
  ): Promise<SourceLookupResult<PostalAddress>> {
    const code = normalizePostalCode(postalCode);

    if (code === null) return { status: 'NOT_FOUND' };

    const response = await this.requestDataSource.execute({
      slug: this.slug,
      segments: [code, 'json'],
      context,
    });

    if (
      response.outcome === SourceOutcome.SUCCESS &&
      readPostalAddress(response.body, code).kind === 'ABSENT'
    ) {
      return { status: 'NOT_FOUND' };
    }

    return toLookupResult(response, (body) => {
      const lookup = readPostalAddress(body, code);

      return lookup.kind === 'FOUND' ? lookup.value : null;
    });
  }
}
