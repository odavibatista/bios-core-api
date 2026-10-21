import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import type { EvidenceSourceConfig } from '../../../domain/dtos/providers/evidence-source.dto.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';

/**
 * Categoria e ODS das evidências de uma fonte, lidos do catálogo (RF08).
 *
 * Quem grava evidências (a normalização de cada fonte) pergunta aqui a qual
 * categoria e a qual ODS elas pertencem, em vez de repetir a tabela no código:
 * trocar o ODS de uma fonte é uma alteração em `data_sources`.
 *
 * Devolve `null` quando a fonte não existe ou não é de evidências; quem chama
 * decide o que isso significa (para um adapter, é erro de configuração).
 */
@Injectable()
export class ResolveEvidenceSourceUseCase extends UseCase<
  string,
  EvidenceSourceConfig | null
> {
  constructor(private readonly dataSourceRepository: DataSourceRepository) {
    super();
  }

  override execute(slug: string): Promise<EvidenceSourceConfig | null> {
    return this.dataSourceRepository.findEvidenceSource(slug);
  }
}
