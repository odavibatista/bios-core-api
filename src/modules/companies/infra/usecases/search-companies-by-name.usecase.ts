import { Injectable } from '@nestjs/common';
import {
  buildPaginationMeta,
  type PaginationQuery,
} from '@shared/domain/dtos/requests/pagination.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { extractNameTerms } from '../../domain/company-name-terms.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import type {
  SearchCompaniesQuery,
  SearchCompaniesResponse,
} from '../../domain/dtos/requests/search-companies.dto.js';

/**
 * Busca empresas por razão social ou nome fantasia (UC06, fluxo 1.1; RF04).
 *
 * Nenhuma das fontes cadastrais (BrasilAPI, OpenCNPJ, Minha Receita) oferece
 * busca por nome, então a busca opera **só sobre os perfis já guardados**: uma
 * empresa que ninguém consultou antes pelo CNPJ não aparece. Isso também
 * significa que a busca nunca chama provedor externo nem publica job. Quem
 * escolhe um resultado abre o perfil pela consulta por CNPJ, que faz a
 * atualização quando o cadastro venceu.
 *
 * A razão social e o nome fantasia guardados já têm o CPF mascarado (INL02);
 * como a busca lê esses campos, digitar um CPF não encontra o titular.
 *
 * Lista vazia não é erro: a busca respondeu, e nada casou.
 */
@Injectable()
export class SearchCompaniesByNameUseCase extends UseCase<
  SearchCompaniesQuery,
  SearchCompaniesResponse
> {
  constructor(
    private readonly companyProfileRepository: CompanyProfileRepository,
  ) {
    super();
  }

  async execute({
    name,
    ...pagination
  }: SearchCompaniesQuery): Promise<SearchCompaniesResponse> {
    const { items, total } = await this.companyProfileRepository.searchByName({
      terms: extractNameTerms(name),
      ...toWindow(pagination),
    });

    return {
      data: items,
      pagination: buildPaginationMeta(pagination, total),
    };
  }
}

function toWindow({ page, page_size }: PaginationQuery) {
  return { skip: (page - 1) * page_size, take: page_size };
}
