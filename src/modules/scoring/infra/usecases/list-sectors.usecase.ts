import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { cnaeDivisionDescription } from '../../domain/cnae-divisions.js';
import { SectorScoreSnapshotRepository } from '../../domain/dtos/repositories/sector-score-snapshot.repository.js';
import type { SectorListResponse } from '../../domain/dtos/requests/sector-evolution.dto.js';

/**
 * Lista os setores que a evolução setorial pode mostrar (UC10, fluxo normal 1: o usuário
 * seleciona um CNAE): as divisões CNAE com ao menos um agregado, com a descrição oficial.
 *
 * Só setor, nunca empresa (IA05). Uma divisão gravada que não existe na CNAE 2.3 (CNAE
 * principal malformado na fonte) fica de fora: a rota da evolução também a recusaria.
 */
@Injectable()
export class ListSectorsUseCase extends UseCase<void, SectorListResponse> {
  constructor(private readonly snapshots: SectorScoreSnapshotRepository) {
    super();
  }

  override async execute(): Promise<SectorListResponse> {
    const divisions = await this.snapshots.listDivisions();

    return {
      data: divisions.flatMap((division) => {
        const description = cnaeDivisionDescription(division);

        return description === undefined
          ? []
          : [{ cnae_division: division, description }];
      }),
    };
  }
}
