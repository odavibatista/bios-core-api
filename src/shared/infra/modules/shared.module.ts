import {
  Global,
  Module,
  StandardSchemaSerializerInterceptor,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { validateEnvironment } from '../../config/environment.config.js';
import { HealthController } from '../../http/controllers/health.controller.js';
import { DatabaseModule } from '../database/database.module.js';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter.js';
import { SchemaValidationPipe } from '../pipes/schema-validation.pipe.js';
import { CheckHealthUseCase } from '../usecases/health/check-health.usecase.js';
import { DataRetentionModule } from './data-retention.module.js';

/**
 * Módulo global de infraestrutura compartilhada.
 *
 * Responsável por:
 *  - carregar e validar as variáveis de ambiente (falha no bootstrap se inválidas);
 *  - disponibilizar o acesso ao banco (`DatabaseModule`) e manter os índices de
 *    retenção alinhados à configuração (`DataRetentionModule`);
 *  - registrar o pipeline HTTP global: validação de entrada por schema, serialização
 *    de saída por schema e corpo de erro padronizado;
 *  - expor o health check.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    DataRetentionModule,
  ],
  controllers: [HealthController],
  providers: [
    /* Casos de uso */
    CheckHealthUseCase,

    /* Pipeline HTTP global */
    { provide: APP_PIPE, useClass: SchemaValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class SharedModule {}
