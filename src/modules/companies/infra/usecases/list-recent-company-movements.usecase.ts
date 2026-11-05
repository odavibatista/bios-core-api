import { Injectable } from '@nestjs/common';
import { ListCompanyMovementsUseCase } from '@modules/scoring/infra/usecases/list-company-movements.usecase.js';
import { ListOdsScoreSummariesUseCase } from '@modules/scoring/infra/usecases/list-ods-score-summaries.usecase.js';
import { buildPaginationMeta } from '@shared/domain/dtos/requests/pagination.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import type {
  CompanyMovementItem,
  CompanyMovementsQuery,
  CompanyMovementsResponse,
} from '../../domain/dtos/requests/company-movements.dto.js';

/**
 * A lista da tela principal (UC18, RF34): monta, para a página de movimentações, a identificação
 * da empresa e os índices atuais.
 *
 * Lê só o que já foi gravado, sem fonte externa nem recálculo (NFDE03), e cada leitura é limitada
 * pelo tamanho da página, e não pelo da base. A identificação vem do perfil, e não de uma cópia
 * na movimentação: um cadastro atualizado nunca fica defasado na lista.
 */
@Injectable()
export class ListRecentCompanyMovementsUseCase extends UseCase<
  CompanyMovementsQuery,
  CompanyMovementsResponse
> {
  constructor(
    private readonly movements: ListCompanyMovementsUseCase,
    private readonly profiles: CompanyProfileRepository,
    private readonly scores: ListOdsScoreSummariesUseCase,
  ) {
    super();
  }

  async execute(
    pagination: CompanyMovementsQuery,
  ): Promise<CompanyMovementsResponse> {
    const { page, page_size, category } = pagination;
    const { rows, total } = await this.movements.execute({
      skip: (page - 1) * page_size,
      take: page_size,
      ...(category ? { category } : {}),
    });
    const cnpjs = rows.map(({ cnpj }) => cnpj);
    const [identities, { odsNumbers, summaries }] = await Promise.all([
      this.profiles.findIdentities(cnpjs),
      this.scores.execute(cnpjs),
    ]);
    const data = rows.flatMap((row): CompanyMovementItem[] => {
      const identity = identities.find(({ cnpj }) => cnpj === row.cnpj);

      // A movimentação só nasce com perfil, e perfil não é apagado: sem ele, o item é ignorado
      // em vez de derrubar a tela principal.
      if (!identity) return [];

      return [
        {
          ...identity,
          moved_at: row.movedAt.toISOString(),
          ods: odsNumbers.map((odsNumber) => {
            const summary = summaries.find(
              (item) => item.cnpj === row.cnpj && item.odsNumber === odsNumber,
            );
            const movement = row.movements.find(
              (item) => item.odsNumber === odsNumber,
            );

            return {
              ods_number: odsNumber,
              score_value: summary?.scoreValue ?? null,
              confidence_value: summary?.confidenceValue ?? null,
              movement: movement
                ? {
                    direction: movement.direction,
                    cause: movement.cause,
                    evidence_category: movement.evidenceCategory,
                    moved_at: movement.movedAt.toISOString(),
                  }
                : null,
            };
          }),
        },
      ];
    });

    return {
      data,
      pagination: buildPaginationMeta({ page, page_size }, total),
    };
  }
}
