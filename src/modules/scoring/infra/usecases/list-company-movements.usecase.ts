import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import {
  CompanyMovementRepository,
  type CompanyMovementsPage,
  type CompanyMovementsWindow,
} from '../../domain/dtos/repositories/company-movement.repository.js';

/** Uma janela das movimentações, da mais recente para a mais antiga (UC18, regra 2). */
@Injectable()
export class ListCompanyMovementsUseCase extends UseCase<
  CompanyMovementsWindow,
  CompanyMovementsPage
> {
  constructor(private readonly movements: CompanyMovementRepository) {
    super();
  }

  override execute(
    window: CompanyMovementsWindow,
  ): Promise<CompanyMovementsPage> {
    return this.movements.findPage(window);
  }
}
