import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { setupApiDocumentation } from '@shared/config/api-documentation.config.js';
import { buildCorsOptions } from '@shared/config/cors.config.js';
import type { Environment } from '@shared/config/environment.config.js';
import { AppModule } from './app.module.js';

/**
 * Bootstrap da aplicação: cria o AppModule, aplica CORS, publica a
 * documentação da API e inicia o servidor HTTP.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService =
    app.get<ConfigService<Environment, true>>(ConfigService);

  app.enableCors(
    buildCorsOptions(configService.get('CORS_ORIGINS', { infer: true })),
  );
  app.enableShutdownHooks();
  setupApiDocumentation(app, {
    serverUrl: configService.get('API_BASE_URL', { infer: true }),
  });

  await app.listen(configService.get('PORT', { infer: true }));
}

void bootstrap();
