import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

/** Caminho da referência interativa da API (Scalar). */
export const API_REFERENCE_PATH = '/docs';

/** Caminho do documento OpenAPI em JSON (RF17). */
export const OPENAPI_DOCUMENT_PATH = '/docs/openapi.json';

/** Versão usada se o `package.json` não puder ser lido (ex.: empacotamento sem ele). */
const FALLBACK_VERSION = '0.0.0';

/** URL base usada quando nenhuma é configurada: relativa à origem que serve o documento. */
export const DEFAULT_SERVER_URL = '/';

/** Opções do documento OpenAPI. */
export interface ApiDocumentationOptions {
  /** URL base da API, que um cliente gerado usa para montar as chamadas. */
  serverUrl?: string;

  /** Versão do contrato; sem ela, vale a do `package.json`. */
  version?: string;
}

/**
 * Versão da API, a do `package.json`: o documento e o pacote não divergem, e quem gera um
 * cliente sabe de que versão do contrato ele saiu. O arquivo fica três níveis acima deste
 * tanto em `src/shared/config` quanto em `dist/shared/config`.
 */
export function readApiVersion(
  packageJsonUrl: URL = new URL('../../../package.json', import.meta.url),
): string {
  try {
    const { version } = JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as {
      version?: unknown;
    };

    return typeof version === 'string' && version !== ''
      ? version
      : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

/**
 * Inclui `null` na lista de valores de todo enum anulável do documento, em qualquer
 * profundidade (propriedades, itens, `allOf`/`anyOf`, componentes).
 *
 * Um `z.enum([...]).nullable()` sai do Zod como `nullable: true` com o `enum` sem `null`. No
 * OpenAPI 3.0.3, o `enum` restringe o valor mesmo com `nullable`: sem `null` na lista, o campo
 * nunca é nulo, e o gerador de tipos do front tipa assim, embora a API devolva `null`
 * (`signal` de evidência não confirmada, `weight_reason` sem redução de peso, `coverage_status`
 * de índice pendente). Altera o próprio documento e o devolve.
 */
export function includeNullInNullableEnums<T>(node: T): T {
  if (Array.isArray(node)) {
    for (const child of node as unknown[]) includeNullInNullableEnums(child);
  } else if (node && typeof node === 'object') {
    const schema = node as Record<string, unknown>;

    if (
      schema.nullable === true &&
      Array.isArray(schema.enum) &&
      !schema.enum.includes(null)
    ) {
      schema.enum.push(null);
    }
    for (const child of Object.values(schema)) {
      includeNullInNullableEnums(child);
    }
  }

  return node;
}

/**
 * Gera o documento OpenAPI a partir dos controllers e schemas Zod.
 *
 * Os schemas Zod com `id` viram componentes nomeados (`components.schemas`), referenciados
 * por `$ref`, e cada operação declara o seu `operationId` no próprio `@ApiOperation`: o
 * nome do método gerado num cliente não depende do nome da classe do controller.
 */
export function buildApiDocument(
  app: INestApplication,
  { serverUrl = DEFAULT_SERVER_URL, version }: ApiDocumentationOptions = {},
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('BIOS API')
    .setDescription(
      'Business Intelligence on Sustainability — consulta de empresas por CNPJ, ' +
        'evidências ambientais públicas e índices de aderência aos ODS 13 e 15.',
    )
    .setVersion(version ?? readApiVersion())
    .addServer(serverUrl)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'jwt',
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'api-key')
    .build();

  return includeNullInNullableEnums(SwaggerModule.createDocument(app, config));
}

/**
 * Publica o documento OpenAPI e a referência interativa:
 *  - o JSON em `OPENAPI_DOCUMENT_PATH`;
 *  - a referência interativa (Scalar) em `API_REFERENCE_PATH`.
 */
export function setupApiDocumentation(
  app: INestApplication,
  options: ApiDocumentationOptions = {},
): void {
  const document = buildApiDocument(app, options);
  const httpAdapter = app.getHttpAdapter();

  httpAdapter.get(
    OPENAPI_DOCUMENT_PATH,
    (_request: unknown, response: unknown): void => {
      httpAdapter.reply(response, document, 200);
    },
  );
  app.use(API_REFERENCE_PATH, apiReference({ content: document }));
}
