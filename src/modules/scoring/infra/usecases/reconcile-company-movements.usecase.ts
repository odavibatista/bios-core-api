import { Injectable, Logger } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { CompanyMovementRepository } from '../../domain/dtos/repositories/company-movement.repository.js';
import { reconstructOdsMovement } from '../../domain/ods-movement-rules.js';
import {
  MOVEMENT_RECONCILE_PAGE_SIZE,
  type ReconcileCompanyMovementsJobResult,
} from '../../domain/ods-scoring-job.dto.js';

/**
 * Cria a movimentação das empresas com perfil e índice que ainda não a têm (RF33 c; UC15,
 * regra 8). Sem esta varredura, a tela principal nasceria vazia em bases já calculadas e não
 * veria empresas que ganharam perfil depois do cálculo: o recálculo só registra mudança.
 *
 * Idempotente e retomável: lê por cursor de CNPJ, só escreve onde falta e nunca altera
 * movimentação já registrada, então repetir depois de uma falha não refaz nada.
 */
@Injectable()
export class ReconcileCompanyMovementsUseCase extends UseCase<
  Date,
  ReconcileCompanyMovementsJobResult
> {
  private readonly logger = new Logger(ReconcileCompanyMovementsUseCase.name);

  constructor(private readonly movements: CompanyMovementRepository) {
    super();
  }

  override async execute(
    now: Date,
  ): Promise<ReconcileCompanyMovementsJobResult> {
    let cursor: string | null = null;
    let created = 0;

    do {
      const page = await this.movements.findCandidates(
        cursor,
        MOVEMENT_RECONCILE_PAGE_SIZE,
      );

      for (const { cnpj, scores } of page.candidates) {
        const movements = scores.flatMap(
          ({ odsId, odsNumber, contributions }) => {
            const movement = reconstructOdsMovement(contributions, now);

            return movement ? [{ ...movement, odsId, odsNumber }] : [];
          },
        );

        if (
          movements.length &&
          (await this.movements.createIfMissing(cnpj, movements))
        ) {
          created += 1;
        }
      }

      cursor = page.nextCursor;
    } while (cursor);

    if (created > 0) {
      this.logger.log(`Movimentação reconstruída para ${created} empresa(s).`);
    }

    return { created };
  }
}
