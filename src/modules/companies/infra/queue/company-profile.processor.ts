import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import {
  CompanyProfileJobPayloadSchema,
  type CompanyProfileJobResult,
  FETCH_COMPANY_PROFILE_JOB,
} from '../../domain/dtos/providers/company-profile-job.dto.js';
import { RefreshCompanyProfileUseCase } from '../usecases/refresh-company-profile.usecase.js';

/**
 * Consome a fila `company-profile`: atualiza o cadastro de um CNPJ pedido por
 * `GetCompanyProfileUseCase` (RF03, RF05).
 *
 * O job é entrada externa: nome e payload são conferidos antes de qualquer
 * consulta, e um job malformado falha **sem repetição** (`UnrecoverableError`),
 * pois repeti-lo não o consertaria. Qualquer outro erro — uma falha ao gravar,
 * por exemplo — propaga, e a política da fila (3 tentativas, backoff
 * exponencial) o repete. "Provedores indisponíveis" não é erro: volta como
 * resultado `SOURCES_UNAVAILABLE`, para quem espera não aguardar repetições.
 *
 * Processa até cinco CNPJs ao mesmo tempo; o limite de cada provedor
 * (NFPD01) continua valendo, pois vem do catálogo e é contado em Redis, por
 * todos os consumidores juntos.
 */
@Processor(QueueName.COMPANY_PROFILE, { concurrency: 5 })
export class CompanyProfileProcessor extends WorkerHost {
  private readonly logger = new Logger(CompanyProfileProcessor.name);

  constructor(
    private readonly refreshCompanyProfileUseCase: RefreshCompanyProfileUseCase,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<CompanyProfileJobResult> {
    if (job.name !== FETCH_COMPANY_PROFILE_JOB) {
      throw new UnrecoverableError(`Job desconhecido: "${job.name}".`);
    }

    const payload = CompanyProfileJobPayloadSchema.safeParse(job.data);
    const cnpj = payload.success ? parseCnpj(payload.data.cnpj) : null;

    // O CNPJ tem de chegar já canônico: é a chave do perfil, do cache e do job.
    if (!payload.success || cnpj !== payload.data.cnpj) {
      throw new UnrecoverableError(
        'Payload do job sem um CNPJ canônico válido.',
      );
    }

    try {
      return await this.refreshCompanyProfileUseCase.execute(cnpj);
    } catch (error) {
      this.logger.warn(
        `Atualização cadastral de ${cnpj} falhou (tentativa ${job.attemptsMade + 1}): ${error instanceof Error ? error.message : String(error)}`,
      );

      throw error;
    }
  }
}
