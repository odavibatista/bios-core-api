import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '@shared/config/environment.config.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';

/**
 * Resolve a janela de validade do cache das consultas a uma fonte (NFDE01).
 *
 * A janela vem de `data_sources.cache_ttl_seconds`, o que permite esticá-la ou
 * encurtá-la direto no banco, sem novo deploy. Cada chamada consulta o
 * catálogo: é uma leitura em coleção pequena, irrelevante diante da chamada à
 * fonte externa que ela evita, e é o que faz um ajuste valer de imediato.
 *
 * Sem janela configurada — ou com o banco fora do ar — vale `CACHE_DEFAULT_TTL`.
 * Ficar sem cache por causa disso seria pior do que usar a reserva: toda
 * consulta voltaria à fonte externa.
 */
@Injectable()
export class ResolveSourceCacheTtlUseCase extends UseCase<string, number> {
  private readonly logger = new Logger(ResolveSourceCacheTtlUseCase.name);
  private readonly fallbackSeconds: number;

  constructor(
    configService: ConfigService<Environment, true>,
    private readonly dataSourceRepository: DataSourceRepository,
  ) {
    super();
    this.fallbackSeconds = configService
      .get('CACHE_DEFAULT_TTL', { infer: true })
      .toSeconds();
  }

  override async execute(slug: string): Promise<number> {
    try {
      const configured =
        await this.dataSourceRepository.findCacheTtlSeconds(slug);

      return configured ?? this.fallbackSeconds;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Janela de cache de "${slug}" não consultada (${reason}): ` +
          'usando a reserva de CACHE_DEFAULT_TTL.',
      );

      return this.fallbackSeconds;
    }
  }
}
