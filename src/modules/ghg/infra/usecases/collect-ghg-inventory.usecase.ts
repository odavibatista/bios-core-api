import { Injectable } from '@nestjs/common';
import { RequestTrigger } from '@prisma/client';
import { CompanyProfileRepository } from '@modules/companies/domain/dtos/repositories/company-profile.repository.js';
import { RecordEvidenceEntriesUseCase } from '@modules/evidences/infra/usecases/record-evidence-entries.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { GHG_SLUG, toGhgEvidence } from '../../domain/ghg-inventory.js';
import type { GhgJobResult } from '../../domain/ghg-job.dto.js';
import { GhgDataSource } from '../providers/ghg.data-source.js';

/** Exclusivo do processor: coleta e grava so a fonte GHG da empresa. */
@Injectable()
export class CollectGhgInventoryUseCase extends UseCase<string, GhgJobResult> {
  constructor(
    private readonly companies: CompanyProfileRepository,
    private readonly adapter: GhgDataSource,
    private readonly entries: RecordEvidenceEntriesUseCase,
    private readonly collection: RecordEvidenceCollectionUseCase,
  ) {
    super();
  }
  override async execute(cnpj: string): Promise<GhgJobResult> {
    const company = await this.companies.findByCnpj(cnpj);
    const result = await this.adapter.fetch(
      {
        cnpj,
        names: [
          company?.profile.legal_name,
          company?.profile.trade_name,
        ].filter((n): n is string => !!n),
      },
      { trigger: RequestTrigger.ON_DEMAND_JOB },
    );
    if (result.status === 'FOUND') {
      await this.entries.execute({
        cnpj,
        sourceSlug: GHG_SLUG,
        collectedAt: result.data.collectedAt,
        entries: result.data.inventories.map(toGhgEvidence),
      });
      return { status: 'FOUND' };
    }
    // Lista vazia e fonte indisponivel nao provam ausencia de pratica.
    await this.collection.execute({
      cnpj,
      sourceSlug: GHG_SLUG,
      result: { status: 'UNAVAILABLE' },
    });
    return { status: 'UNKNOWN' };
  }
}
