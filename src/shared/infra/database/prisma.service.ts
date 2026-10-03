import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { Environment } from '../../config/environment.config.js';
import type { DatabaseHealthProvider } from '../../domain/providers/database-health.provider.js';

/** Tempo máximo de espera pela resposta do banco no health check. */
export const DATABASE_HEALTH_TIMEOUT_MS = 3_000;

/**
 * Cliente Prisma gerenciado pelo container de injeção do Nest.
 *
 * Única forma de acesso ao banco: repositórios recebem esta classe por injeção,
 * nunca uma instância global de `PrismaClient`, o que mantém o acesso a dados
 * substituível em teste via `overrideProvider`.
 *
 * A conexão com o MongoDB é estabelecida sob demanda na primeira consulta; assim
 * a aplicação sobe mesmo com o banco fora do ar e o health check reporta a falha.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleDestroy, DatabaseHealthProvider
{
  constructor(configService: ConfigService<Environment, true>) {
    super({
      datasourceUrl: configService.get('DATABASE_URL', { infer: true }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Verifica se o banco responde a um `ping` dentro do tempo limite.
   */
  async isAvailable(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), DATABASE_HEALTH_TIMEOUT_MS);
    });

    const ping = this.$runCommandRaw({ ping: 1 }).then(
      () => true,
      () => false,
    );

    try {
      return await Promise.race([ping, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
