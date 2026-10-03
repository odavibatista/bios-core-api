import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

/** Caminho da referência interativa da API (Scalar). */
export const API_REFERENCE_PATH = '/docs';

/** Caminho do documento OpenAPI em JSON (RF17). */
export const OPENAPI_DOCUMENT_PATH = '/docs/openapi.json';

/**
 * Gera o documento OpenAPI a partir dos controllers e schemas Zod e publica:
 *  - o JSON em `OPENAPI_DOCUMENT_PATH`;
 *  - a referência interativa (Scalar) em `API_REFERENCE_PATH`.
 */
export function setupApiDocumentation(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('BIOS API')
    .setDescription(
      'Business Intelligence on Sustainability — consulta de empresas por CNPJ, ' +
        'evidências ambientais públicas e índices de aderência aos ODS 13 e 15.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'jwt',
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const httpAdapter = app.getHttpAdapter();

  httpAdapter.get(
    OPENAPI_DOCUMENT_PATH,
    (_request: unknown, response: unknown): void => {
      httpAdapter.reply(response, document, 200);
    },
  );
  app.use(API_REFERENCE_PATH, apiReference({ content: document }));
}
