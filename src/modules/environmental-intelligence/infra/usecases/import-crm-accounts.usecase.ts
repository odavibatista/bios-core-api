import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { EvidenceState } from '@prisma/client';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import type { CompanyFullProfileResponse } from '../../domain/dtos/requests/company-full-profile.dto.js';
import {
  type CrmAccount,
  type CrmImportRequest,
  type CrmImportResponse,
  CrmImportStatus,
} from '../../domain/dtos/requests/crm-import.dto.js';
import { GetCompanyFullProfileUseCase } from './get-company-full-profile.usecase.js';

/** Quantos perfis do lote são compostos ao mesmo tempo. */
const CONCURRENCY = 5;

type CrmImportResult = CrmImportResponse['data'][number];

function toAccount(profile: CompanyFullProfileResponse): CrmAccount {
  return {
    external_id: profile.cnpj,
    legal_name: profile.legal_name,
    trade_name: profile.trade_name,
    registration_status: profile.registration_status,
    company_size: profile.company_size,
    city: profile.address.city,
    uf: profile.address.uf,
    main_cnae_code: profile.main_cnae.code,
    main_cnae_description: profile.main_cnae.description,
    ods: profile.ods_scores.map((score) => ({
      ods_number: score.ods_number,
      calculation_status: score.calculation_status,
      score_value: score.score_value,
      confidence_value: score.confidence_value,
    })),
    evidences: profile.evidences.map(({ category, evidences }) => ({
      category,
      confirmed_count: evidences.filter(
        ({ state }) => state === EvidenceState.CONFIRMED,
      ).length,
    })),
    refreshed_at: profile.refreshed_at,
    scores_pending: profile.provenance.scores_pending,
    retry_after_seconds: profile.provenance.retry_after_seconds,
  };
}

/** Recusa do UC12 que vira estado da conta; as demais são indisponibilidade. */
const STATUS_BY_REFUSAL = new Map<number, CrmImportResult['status']>([
  [HttpStatus.NOT_FOUND, CrmImportStatus.NOT_FOUND],
  [HttpStatus.UNPROCESSABLE_ENTITY, CrmImportStatus.INVALID],
]);

/**
 * Importação de contas por um CRM (UC16, RF31).
 *
 * Executa o UC12 para cada CNPJ, sem esperar as fontes externas, e devolve o resultado de cada um:
 * os fluxos alternativos do UC12 viram o estado da conta, e não a falha do lote. Erro que não veio
 * do domínio é defeito, e continua subindo.
 */
@Injectable()
export class ImportCrmAccountsUseCase extends UseCase<
  CrmImportRequest,
  CrmImportResponse
> {
  constructor(private readonly getFullProfile: GetCompanyFullProfileUseCase) {
    super();
  }

  async execute({ cnpjs }: CrmImportRequest): Promise<CrmImportResponse> {
    const unique = [...new Set(cnpjs)];
    const data: CrmImportResult[] = [];

    for (let start = 0; start < unique.length; start += CONCURRENCY) {
      const results = await Promise.all(
        unique
          .slice(start, start + CONCURRENCY)
          .map((cnpj) => this.importOne(cnpj)),
      );
      data.push(...results);
    }

    return { data };
  }

  private async importOne(cnpj: string): Promise<CrmImportResult> {
    try {
      const profile = await this.getFullProfile.execute(cnpj, {
        waitForCollection: false,
      });

      return {
        cnpj,
        status: CrmImportStatus.IMPORTED,
        account: toAccount(profile),
      };
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;

      return {
        cnpj,
        status:
          STATUS_BY_REFUSAL.get(error.getStatus()) ??
          CrmImportStatus.UNAVAILABLE,
        account: null,
      };
    }
  }
}
