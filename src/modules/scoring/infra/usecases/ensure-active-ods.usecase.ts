import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { OdsNotAvailableException } from '../../domain/dtos/errors/ods-not-available.errors.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';

/**
 * Confere que o ODS escolhido numa pesquisa ou exportação é calculado pelo BIOS (RF13, RF14).
 *
 * A faixa 1 a 17 do contrato só diz que o número é um ODS da Agenda 2030; quem decide quais
 * o BIOS calcula é a coleção `ods` (ativos). Sem esta conferência, um ODS que o BIOS não
 * calcula respondia 200 com índice nulo, e com mínimo informado, 200 e lista vazia.
 *
 * @throws {OdsNotAvailableException} (422) com os ODS válidos em `details.valid_ods`.
 */
@Injectable()
export class EnsureActiveOdsUseCase extends UseCase<number, void> {
  constructor(private readonly scores: OdsScoreRepository) {
    super();
  }

  override async execute(odsNumber: number): Promise<void> {
    const active = (await this.scores.findActiveOds())
      .map(({ number }) => number)
      .sort((a, b) => a - b);

    if (!active.includes(odsNumber)) {
      throw new OdsNotAvailableException(odsNumber, active);
    }
  }
}
