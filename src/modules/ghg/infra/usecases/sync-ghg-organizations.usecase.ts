import { Injectable, Logger } from '@nestjs/common';
import { RequestTrigger } from '@prisma/client';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import type { GhgSyncJobResult } from '../../domain/ghg-job.dto.js';
import { GhgOrganizationDirectory } from '../providers/ghg-organization-directory.provider.js';

/**
 * Sincroniza o cadastro de organizações do GHG (job diário, fila `ghg-inventory`).
 *
 * Falhas são lançadas, para a fila repetir pela política do agendamento; o
 * cadastro anterior continua valendo (ver `GhgOrganizationDirectory`).
 *
 * @throws {GhgSourceDisabledError} quando a fonte está desabilitada (sem repetição útil).
 * @throws {GhgOrganizationsUnavailableError} quando o portal não entregou o cadastro completo.
 */
@Injectable()
export class SyncGhgOrganizationsUseCase extends UseCase<
  void,
  GhgSyncJobResult
> {
  private readonly logger = new Logger(SyncGhgOrganizationsUseCase.name);

  constructor(private readonly directory: GhgOrganizationDirectory) {
    super();
  }

  override async execute(): Promise<GhgSyncJobResult> {
    const startedAt = Date.now();
    const { organizations } = await this.directory.sync({
      trigger: RequestTrigger.SCHEDULED_JOB,
    });

    this.logger.log(
      `GHG: cadastro sincronizado, ${organizations.length} organizações em ` +
        `${Math.round((Date.now() - startedAt) / 1_000)} s.`,
    );

    return { organizations: organizations.length };
  }
}
