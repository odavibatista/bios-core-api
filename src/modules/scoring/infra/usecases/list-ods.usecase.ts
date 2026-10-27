import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';
import type { OdsListResponse } from '../../domain/dtos/requests/ods-catalog.dto.js';

/**
 * Lista os ODS que o BIOS calcula (RF10), para o seletor da pesquisa e da exportação.
 *
 * Lê só o catálogo `ods`, sem coletar nem recalcular. ODS desativado não aparece: é o mesmo
 * conjunto que a pesquisa aceita (`EnsureActiveOdsUseCase`).
 */
@Injectable()
export class ListOdsUseCase extends UseCase<void, OdsListResponse> {
  constructor(private readonly scores: OdsScoreRepository) {
    super();
  }

  override async execute(): Promise<OdsListResponse> {
    const catalog = await this.scores.findOdsCatalog();

    return {
      data: catalog.map(({ number, title, description }) => ({
        ods_number: number,
        title,
        description,
      })),
    };
  }
}
