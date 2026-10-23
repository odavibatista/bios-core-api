import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.config.js';
import {
  QUEUE_RETIRED_SCHEDULES,
  QUEUE_SCHEDULES,
} from '../../config/queue.config.js';
import { QueueProvider } from '../../domain/providers/queue.provider.js';
import { RedisHealthProvider } from '../../domain/providers/redis-health.provider.js';

/**
 * Registra os jobs repetíveis declarados, a cada inicialização da aplicação.
 *
 * O registro é idempotente pelo `id` do agendamento: reiniciar a API, ou subir
 * várias instâncias, não duplica o disparo. Roda em segundo plano, de modo que
 * a API passa a aceitar requisições sem esperar o Redis; com o Redis
 * indisponível, o registro é adiado para a próxima inicialização, e os
 * agendamentos já gravados continuam valendo, porque vivem no próprio Redis.
 *
 * Desativável por `QUEUE_SCHEDULES_SYNC_ON_BOOT=false` (ex.: testes, ou uma
 * instância que não deva disparar jobs agendados).
 */
@Injectable()
export class QueueSchedulesInitializer implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueSchedulesInitializer.name);

  constructor(
    private readonly configService: ConfigService<Environment, true>,
    private readonly redisHealthProvider: RedisHealthProvider,
    private readonly queueProvider: QueueProvider,
  ) {}

  onApplicationBootstrap(): void {
    if (
      !this.configService.get('QUEUE_SCHEDULES_SYNC_ON_BOOT', { infer: true })
    ) {
      return;
    }

    void this.synchronize();
  }

  async synchronize(): Promise<void> {
    if (!(await this.redisHealthProvider.isAvailable())) {
      this.logger.warn(
        'Redis indisponível: registro dos jobs agendados adiado para a ' +
          'próxima inicialização.',
      );
      return;
    }

    const retired = await Promise.allSettled(
      QUEUE_RETIRED_SCHEDULES.map(({ queue, id }) =>
        this.queueProvider.unschedule(queue, id),
      ),
    );
    retired.forEach((result, position) => {
      if (result.status === 'rejected')
        this.logger.error(
          `Agendamento antigo "${QUEUE_RETIRED_SCHEDULES[position].id}" não removido.`,
        );
    });

    const results = await Promise.allSettled(
      QUEUE_SCHEDULES.map((schedule) => this.queueProvider.schedule(schedule)),
    );

    results.forEach((result, position) => {
      if (result.status === 'rejected') {
        const reason: unknown = result.reason;
        const message =
          reason instanceof Error ? reason.message : String(reason);

        this.logger.error(
          `Agendamento "${QUEUE_SCHEDULES[position].id}" não registrado: ${message}`,
        );
      }
    });

    const registered = results.filter(
      ({ status }) => status === 'fulfilled',
    ).length;

    this.logger.log(
      `Jobs agendados: ${registered} de ${QUEUE_SCHEDULES.length} registrado(s).`,
    );
  }
}
