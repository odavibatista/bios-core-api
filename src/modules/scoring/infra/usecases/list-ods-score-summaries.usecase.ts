import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import {
  OdsScoreRepository,
  type OdsScoreSummary,
} from '../../domain/dtos/repositories/ods-score.repository.js';

/** Índice e confiança de várias empresas, e os ODS ativos que dão as colunas. */
export interface OdsScoreSummaries {
  /** Números dos ODS ativos, em ordem. */
  odsNumbers: number[];

  /** Um item por empresa e ODS que tem retrato gravado; só os ODS ativos. */
  summaries: OdsScoreSummary[];
}

/**
 * Índice e confiança de cada empresa em cada ODS ativo, sem a explicação (RF15).
 *
 * Lê os retratos já gravados, sem coletar fontes nem recalcular: quem monta uma lista (a
 * exportação em XLSX) usa o resumo, e a explicação fica no perfil. ODS desativado não
 * entra, para a lista e o catálogo concordarem.
 */
@Injectable()
export class ListOdsScoreSummariesUseCase extends UseCase<
  readonly string[],
  OdsScoreSummaries
> {
  constructor(private readonly scores: OdsScoreRepository) {
    super();
  }

  override async execute(cnpjs: readonly string[]): Promise<OdsScoreSummaries> {
    const odsNumbers = (await this.scores.findActiveOds())
      .map(({ number }) => number)
      .sort((a, b) => a - b);
    const active = new Set(odsNumbers);
    const summaries = (await this.scores.findSummariesByCnpjs(cnpjs)).filter(
      ({ odsNumber }) => active.has(odsNumber),
    );

    return { odsNumbers, summaries };
  }
}
