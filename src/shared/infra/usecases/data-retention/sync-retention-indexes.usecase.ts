import { Injectable } from '@nestjs/common';
import type { RetentionPolicy } from '../../../domain/dtos/providers/retention-policy.dto.js';
import type { RetentionSyncReport } from '../../../domain/dtos/requests/retention-sync-report.dto.js';
import { UseCase } from '../../../domain/protocols/use-case.protocol.js';
import { RetentionIndexProvider } from '../../../domain/providers/retention-index.provider.js';

/**
 * Aplica as políticas de retenção aos índices do banco e relata o resultado.
 *
 * As políticas são aplicadas de forma independente: a falha em uma coleção não
 * impede as demais e é registrada no relatório, nunca propagada.
 */
@Injectable()
export class SyncRetentionIndexesUseCase extends UseCase<
  RetentionPolicy[],
  RetentionSyncReport
> {
  constructor(private readonly retentionIndexProvider: RetentionIndexProvider) {
    super();
  }

  override async execute(
    policies: RetentionPolicy[],
  ): Promise<RetentionSyncReport> {
    const results = await Promise.allSettled(
      policies.map((policy) => this.retentionIndexProvider.apply(policy)),
    );

    const report: RetentionSyncReport = {
      created: [],
      updated: [],
      unchanged: [],
      failed: [],
    };

    results.forEach((result, position) => {
      const { collection, indexName } = policies[position];
      const index = `${collection}.${indexName}`;

      if (result.status === 'fulfilled') {
        report[result.value].push(index);
      } else {
        report.failed.push({ index, reason: describeFailure(result.reason) });
      }
    });

    return report;
  }
}

/**
 * Resume o motivo de uma falha à última linha não vazia da mensagem: erros do
 * Prisma trazem um cabeçalho genérico de várias linhas antes da causa real.
 */
function describeFailure(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.at(-1) ?? message;
}
