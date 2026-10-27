import { Injectable } from '@nestjs/common';
import { EnsureActiveOdsUseCase } from '@modules/scoring/infra/usecases/ensure-active-ods.usecase.js';
import {
  buildPaginationMeta,
  type PaginationQuery,
} from '@shared/domain/dtos/requests/pagination.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { toSearchInput } from '../../domain/search-companies-input.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import type {
  SearchCompaniesQuery,
  SearchCompaniesResponse,
} from '../../domain/dtos/requests/search-companies.dto.js';

/**
 * Pesquisa empresas por nome, UF, município, CNAE e, para um ODS selecionado, índice e
 * confiança mínimos (UC06, fluxo 1.1; UC08; RF04, RF13).
 *
 * Nenhuma das fontes cadastrais (BrasilAPI, OpenCNPJ, Minha Receita) oferece
 * busca, então a pesquisa opera **só sobre os perfis já guardados**: uma
 * empresa que ninguém consultou antes pelo CNPJ não aparece (UC08, regra 1). Isso também
 * significa que ela nunca chama provedor externo nem publica job. Quem
 * escolhe um resultado abre o perfil pela consulta por CNPJ, que faz a
 * atualização quando o cadastro venceu.
 *
 * A razão social e o nome fantasia guardados já têm o CPF mascarado (INL02);
 * como a busca lê esses campos, digitar um CPF não encontra o titular.
 *
 * Lista vazia não é erro: a pesquisa respondeu, e nada casou. Já um `ods` que o BIOS não
 * calcula (inexistente ou desativado) é recusado com 422 e a lista dos válidos (#332).
 */
@Injectable()
export class SearchCompaniesUseCase extends UseCase<
  SearchCompaniesQuery,
  SearchCompaniesResponse
> {
  constructor(
    private readonly companyProfileRepository: CompanyProfileRepository,
    private readonly ensureActiveOds: EnsureActiveOdsUseCase,
  ) {
    super();
  }

  async execute({
    page,
    page_size,
    ...criteria
  }: SearchCompaniesQuery): Promise<SearchCompaniesResponse> {
    if (criteria.ods !== undefined) {
      await this.ensureActiveOds.execute(criteria.ods);
    }

    const pagination = { page, page_size };
    const { items, total } = await this.companyProfileRepository.search(
      toSearchInput(criteria, toWindow(pagination)),
    );

    return {
      data: items,
      pagination: buildPaginationMeta(pagination, total),
    };
  }
}

function toWindow({ page, page_size }: PaginationQuery) {
  return { skip: (page - 1) * page_size, take: page_size };
}
