import { Injectable } from '@nestjs/common';
import { buildPaginationMeta } from '@shared/domain/dtos/requests/pagination.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { DecoyCompanyGenerator } from '../../domain/decoy-company.generator.js';
import type {
  DecoyCompany,
  DecoyCompanyListQuery,
  DecoyCompanyListResponse,
} from '../../domain/dtos/requests/decoy-company.dto.js';
import { DecoyAvailability } from '../providers/decoy-availability.js';

/** Listagem isca (#88): até 10 empresas sintéticas por página, com falhas e atrasos. */
@Injectable()
export class ListDecoyCompaniesUseCase extends UseCase<
  DecoyCompanyListQuery,
  DecoyCompanyListResponse
> {
  constructor(
    private readonly generator: DecoyCompanyGenerator,
    private readonly availability: DecoyAvailability,
  ) {
    super();
  }

  override async execute(
    query: DecoyCompanyListQuery,
  ): Promise<DecoyCompanyListResponse> {
    await this.availability.simulate();

    const { items, total } = this.generator.page(query.page, query.page_size);

    return { data: items, pagination: buildPaginationMeta(query, total) };
  }
}

/** Detalhe isca (#88): a empresa sintética do CNPJ pedido, sempre a mesma. */
@Injectable()
export class GetDecoyCompanyUseCase extends UseCase<string, DecoyCompany> {
  constructor(
    private readonly generator: DecoyCompanyGenerator,
    private readonly availability: DecoyAvailability,
  ) {
    super();
  }

  override async execute(cnpj: string): Promise<DecoyCompany> {
    await this.availability.simulate();

    return this.generator.company(cnpj);
  }
}
