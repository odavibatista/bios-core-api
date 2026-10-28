import { Injectable } from '@nestjs/common';
import { buildPaginationMeta } from '@shared/domain/dtos/requests/pagination.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import type {
  BlockedEmailDomainListResponse,
  ListBlockedEmailDomainsQuery,
} from '../../domain/dtos/requests/blocked-email-domain.dto.js';
import { BlockedEmailDomainRepository } from '../../domain/dtos/repositories/blocked-email-domain.repository.js';
import { toBlockedEmailDomainResponse } from './blocked-email-domain.response.js';

/**
 * Lista os domínios bloqueados agora (UC13, fluxo 2), em ordem alfabética e paginados.
 * Os removidos logicamente não aparecem.
 */
@Injectable()
export class ListBlockedEmailDomainsUseCase extends UseCase<
  ListBlockedEmailDomainsQuery,
  BlockedEmailDomainListResponse
> {
  constructor(private readonly repository: BlockedEmailDomainRepository) {
    super();
  }

  override async execute(
    query: ListBlockedEmailDomainsQuery,
  ): Promise<BlockedEmailDomainListResponse> {
    const { items, total } = await this.repository.listActive({
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
    });

    return {
      data: items.map(toBlockedEmailDomainResponse),
      pagination: buildPaginationMeta(query, total),
    };
  }
}
