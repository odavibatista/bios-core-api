import { Injectable } from '@nestjs/common';
import { buildPaginationMeta } from '@shared/domain/dtos/requests/pagination.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { CompanyRemovalRepository } from '../../domain/dtos/repositories/company-removal.repository.js';
import type {
  CompanyRemovalListResponse,
  ListCompanyRemovalsQuery,
} from '../../domain/dtos/requests/company-removal.dto.js';

/** Lista os cadastros retirados, para o administrador conferir um pedido. */
@Injectable()
export class ListCompanyRemovalsUseCase extends UseCase<
  ListCompanyRemovalsQuery,
  CompanyRemovalListResponse
> {
  constructor(private readonly removals: CompanyRemovalRepository) {
    super();
  }

  override async execute(
    query: ListCompanyRemovalsQuery,
  ): Promise<CompanyRemovalListResponse> {
    const { page, page_size } = query;
    const { rows, total } = await this.removals.list({
      skip: (page - 1) * page_size,
      take: page_size,
    });

    return {
      data: rows.map(({ cnpj, removedAt }) => ({
        cnpj,
        removed_at: removedAt.toISOString(),
      })),
      pagination: buildPaginationMeta(query, total),
    };
  }
}
