import { Injectable } from '@nestjs/common';
import { GetIbamaCompanyEvidencesUseCase } from '@modules/ibama/infra/usecases/get-ibama-company-evidences.usecase.js';
import { GetGhgCompanyEvidencesUseCase } from '@modules/ghg/infra/usecases/get-ghg-company-evidences.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { InvalidEvidenceError } from '../../domain/dtos/errors/evidence.errors.js';
import {
  CompanyEnvironmentalEvidencesRequestSchema,
  groupCompanyEvidences,
  type CompanyEnvironmentalEvidencesResponse,
} from '../../domain/company-environmental-evidences.dto.js';
import { ListCompanyEvidencesUseCase } from './list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from './record-evidence-collection.usecase.js';
import { RequestCguCompanyEvidencesUseCase } from './request-cgu-company-evidences.usecase.js';
/** UC07: fontes independentes; releitura local inclui jobs que terminaram durante a espera. */
@Injectable()
export class GetCompanyEnvironmentalEvidencesUseCase extends UseCase<
  string,
  CompanyEnvironmentalEvidencesResponse
> {
  constructor(
    private readonly ibama: GetIbamaCompanyEvidencesUseCase,
    private readonly cgu: RequestCguCompanyEvidencesUseCase,
    private readonly ghg: GetGhgCompanyEvidencesUseCase,
    private readonly list: ListCompanyEvidencesUseCase,
    private readonly collection: RecordEvidenceCollectionUseCase,
  ) {
    super();
  }
  override async execute(
    input: string,
  ): Promise<CompanyEnvironmentalEvidencesResponse> {
    const parsed = CompanyEnvironmentalEvidencesRequestSchema.safeParse({
      cnpj: input,
    });
    if (!parsed.success)
      throw new InvalidEvidenceError(
        'CNPJ invalido para consultar evidencias.',
      );
    const { cnpj } = parsed.data;
    const requests = [
      { slugs: ['IBAMA'], run: () => this.ibama.execute(cnpj) },
      { slugs: ['CGU_CEIS', 'CGU_CNEP'], run: () => this.cgu.execute(cnpj) },
      { slugs: ['GHG_PROTOCOL'], run: () => this.ghg.execute(cnpj) },
    ];
    const results = await Promise.allSettled(
      requests.map((request) => request.run()),
    );
    for (const [i, result] of results.entries()) {
      if (result.status === 'rejected') {
        for (const sourceSlug of requests[i].slugs)
          await this.collection.execute({
            cnpj,
            sourceSlug,
            result: { status: 'UNAVAILABLE' },
          });
      }
    }
    return groupCompanyEvidences(cnpj, await this.list.execute(cnpj));
  }
}
