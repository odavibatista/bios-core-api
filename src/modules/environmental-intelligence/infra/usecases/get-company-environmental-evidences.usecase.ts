import { Injectable } from '@nestjs/common';
import { CompanyProfileRepository } from '@modules/companies/domain/dtos/repositories/company-profile.repository.js';
import { CompanyNotFoundException } from '@modules/companies/domain/dtos/errors/company-not-found.exception.js';
import { GetIbamaCompanyEvidencesUseCase } from '@modules/ibama/infra/usecases/get-ibama-company-evidences.usecase.js';
import { GetGhgCompanyEvidencesUseCase } from '@modules/ghg/infra/usecases/get-ghg-company-evidences.usecase.js';
import { RequestScoreRecalculationUseCase } from '@modules/scoring/infra/usecases/request-score-recalculation.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { InvalidEvidenceError } from '@modules/evidences/domain/dtos/errors/evidence.errors.js';
import {
  CompanyEnvironmentalEvidencesRequestSchema,
  groupCompanyEvidences,
  type CompanyEnvironmentalEvidencesResponse,
} from '@modules/evidences/domain/company-environmental-evidences.dto.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import {
  RequestCguCompanyEvidencesUseCase,
  type EvidenceCollectionOptions,
} from './request-cgu-company-evidences.usecase.js';
/**
 * UC07: fontes independentes; releitura local inclui jobs que terminaram durante a espera.
 *
 * Por padrão (painel e rota de evidências) espera as coletas e o recálculo, no prazo da fila.
 * Com `wait: false` (API pública, #333) não espera nada: devolve o que está guardado, publica
 * as atualizações que faltam e deixa o recálculo para o consumidor da fila.
 */
@Injectable()
export class GetCompanyEnvironmentalEvidencesUseCase extends UseCase<
  string,
  CompanyEnvironmentalEvidencesResponse
> {
  constructor(
    private readonly profiles: CompanyProfileRepository,
    private readonly ibama: GetIbamaCompanyEvidencesUseCase,
    private readonly cgu: RequestCguCompanyEvidencesUseCase,
    private readonly ghg: GetGhgCompanyEvidencesUseCase,
    private readonly list: ListCompanyEvidencesUseCase,
    private readonly collection: RecordEvidenceCollectionUseCase,
    private readonly scores: RequestScoreRecalculationUseCase,
  ) {
    super();
  }
  override async execute(
    input: string,
    { wait = true }: EvidenceCollectionOptions = {},
  ): Promise<CompanyEnvironmentalEvidencesResponse> {
    const parsed = CompanyEnvironmentalEvidencesRequestSchema.safeParse({
      cnpj: input,
    });
    if (!parsed.success)
      throw new InvalidEvidenceError(
        'CNPJ inválido para consultar evidências.',
      );
    const { cnpj } = parsed.data;
    if (!(await this.profiles.findByCnpj(cnpj)))
      throw new CompanyNotFoundException();
    const requests = [
      { slugs: ['IBAMA'], run: () => this.ibama.execute(cnpj) },
      {
        slugs: ['CGU_CEIS', 'CGU_CNEP'],
        run: () => this.cgu.execute(cnpj, { wait }),
      },
      { slugs: ['GHG_PROTOCOL'], run: () => this.ghg.execute(cnpj, { wait }) },
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
    // UC15 (diagrama 3): com as evidências consolidadas, recalcula índice e confiança e
    // espera no prazo da fila. Fila lenta ou recálculo que falha degradam (o índice fica
    // como estava até o próximo recálculo) em vez de derrubar a consulta.
    await this.scores.execute({ cnpj, wait });
    return groupCompanyEvidences(cnpj, await this.list.execute(cnpj));
  }
}
