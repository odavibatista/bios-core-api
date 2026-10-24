import { Injectable } from '@nestjs/common';
import { ListOdsScoreSummariesUseCase } from '@modules/scoring/infra/usecases/list-ods-score-summaries.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import {
  ExportTooLargeException,
  NoResultsToExportException,
} from '../../domain/dtos/errors/export-companies.errors.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import type { ExportCompaniesQuery } from '../../domain/dtos/requests/search-companies.dto.js';
import { toSearchInput } from '../../domain/search-companies-input.js';
import {
  buildCompaniesWorkbook,
  type WorkbookCompany,
  type WorkbookOdsScore,
} from '../export/companies-workbook.builder.js';

/** Máximo de empresas em uma exportação. */
export const EXPORT_MAX_COMPANIES = 5_000;

/** Tipo de conteúdo de um arquivo XLSX. */
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Arquivo gerado, pronto para ser entregue. */
export interface CompaniesExport {
  /** Conteúdo do XLSX. */
  content: Buffer;

  /** Nome sugerido para o arquivo. */
  fileName: string;

  /** Empresas na planilha. */
  companies: number;
}

/**
 * Exporta em XLSX a lista que a pesquisa devolveria (UC09, RF15).
 *
 * Aplica os mesmos critérios e a mesma ordenação da pesquisa (`toSearchInput`), sem
 * paginação, e junta a cada empresa o índice e a confiança de **todos** os ODS ativos, em
 * colunas separadas: a planilha serve para comparar empresas, e não só no ODS selecionado.
 * Só leva dados de pessoa jurídica (INL02). Lê a base local: não chama fonte nem publica job.
 *
 * @throws {NoResultsToExportException} quando nenhuma empresa atende aos critérios.
 * @throws {ExportTooLargeException} quando passam de `EXPORT_MAX_COMPANIES`.
 */
@Injectable()
export class ExportCompaniesUseCase extends UseCase<
  ExportCompaniesQuery,
  CompaniesExport
> {
  constructor(
    private readonly companyProfileRepository: CompanyProfileRepository,
    private readonly listScores: ListOdsScoreSummariesUseCase,
  ) {
    super();
  }

  override async execute(
    query: ExportCompaniesQuery,
  ): Promise<CompaniesExport> {
    const { items, total } = await this.companyProfileRepository.search(
      toSearchInput(query, { skip: 0, take: EXPORT_MAX_COMPANIES }),
    );

    if (total === 0) throw new NoResultsToExportException();

    if (total > EXPORT_MAX_COMPANIES) {
      throw new ExportTooLargeException(total, EXPORT_MAX_COMPANIES);
    }

    const { odsNumbers, summaries } = await this.listScores.execute(
      items.map(({ cnpj }) => cnpj),
    );
    const scoresByCnpj = new Map<string, Map<number, WorkbookOdsScore>>();

    for (const summary of summaries) {
      const byOds =
        scoresByCnpj.get(summary.cnpj) ?? new Map<number, WorkbookOdsScore>();

      byOds.set(summary.odsNumber, {
        score: summary.scoreValue,
        confidence: summary.confidenceValue,
      });
      scoresByCnpj.set(summary.cnpj, byOds);
    }

    const companies: WorkbookCompany[] = items.map((item) => ({
      cnpj: item.cnpj,
      legalName: item.legal_name,
      tradeName: item.trade_name,
      registrationStatus: item.registration_status,
      uf: item.uf,
      city: item.city,
      mainCnaeCode: item.main_cnae.code,
      mainCnaeDescription: item.main_cnae.description,
      scores: scoresByCnpj.get(item.cnpj) ?? new Map(),
    }));

    return {
      content: await buildCompaniesWorkbook(companies, odsNumbers),
      fileName: `empresas-bios-${new Date().toISOString().slice(0, 10)}.xlsx`,
      companies: companies.length,
    };
  }
}
