import { Injectable } from '@nestjs/common';
import type { DataSourceInterface } from '@modules/data-sources/domain/data-source.interface.js';
import type { SourceCallContext } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import type { CguSanction } from '../../domain/cgu-sanction.js';
import { CguSanctionsProvider } from './cgu-sanctions.provider.js';

/** Adapter do Cadastro Nacional de Empresas Inidôneas e Suspensas. */
@Injectable()
export class CeisDataSource implements DataSourceInterface<
  string,
  CguSanction[]
> {
  readonly slug = 'CGU_CEIS';
  constructor(private readonly provider: CguSanctionsProvider) {}
  fetch(cnpj: string, context: SourceCallContext) {
    return this.provider.fetch(this.slug, cnpj, context);
  }
}
