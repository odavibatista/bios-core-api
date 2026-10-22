import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import type { DataSourceRequestConfig } from '../../../domain/dtos/providers/data-source-request.dto.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';

/** Permite aos adapters respeitar a habilitação antes mesmo de ler o cache. */
@Injectable()
export class ResolveSourceRequestConfigUseCase extends UseCase<
  string,
  DataSourceRequestConfig | null
> {
  constructor(private readonly sources: DataSourceRepository) {
    super();
  }
  override execute(slug: string): Promise<DataSourceRequestConfig | null> {
    return this.sources.findRequestConfig(slug);
  }
}
