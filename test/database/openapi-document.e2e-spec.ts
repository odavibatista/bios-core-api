import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  buildApiDocument,
  readApiVersion,
} from '@shared/config/api-documentation.config.js';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';

const SERVER_URL = 'https://api.bios.example';
const COMPONENT_PREFIX = '#/components/schemas/';

/** Toda operação da API e o `operationId` que o cliente gerado leva no nome do método. */
const EXPECTED_OPERATIONS: Record<string, string> = {
  'GET /health': 'checkHealth',
  'GET /ods': 'listOds',
  'POST /accounts': 'registerAccount',
  'POST /accounts/confirm-email': 'confirmEmail',
  'POST /accounts/resend-confirmation': 'resendEmailConfirmation',
  'GET /accounts/me': 'getOwnAccount',
  'PATCH /accounts/me': 'updateOwnAccount',
  'DELETE /accounts/me': 'deleteOwnAccount',
  'POST /accounts/me/email-change': 'requestEmailChange',
  'POST /accounts/confirm-email-change': 'confirmEmailChange',
  'POST /auth/login': 'login',
  'POST /auth/refresh': 'refreshSession',
  'POST /auth/logout': 'logout',
  'POST /auth/logout-all': 'logoutAllDevices',
  'POST /auth/change-password': 'changePassword',
  'POST /auth/forgot-password': 'forgotPassword',
  'POST /auth/reset-password': 'resetPassword',
  'POST /api-keys': 'createApiKey',
  'GET /api-keys': 'listApiKeys',
  'DELETE /api-keys/{id}': 'revokeApiKey',
  'GET /admin/blocked-email-domains': 'listBlockedEmailDomains',
  'POST /admin/blocked-email-domains': 'addBlockedEmailDomain',
  'DELETE /admin/blocked-email-domains/{id}': 'removeBlockedEmailDomain',
  'GET /companies': 'searchCompanies',
  'GET /companies/export/xlsx': 'exportCompaniesXlsx',
  'GET /companies/{cnpj}': 'getCompanyProfile',
  'GET /v1/companies/{cnpj}': 'getPublicCompanyProfile',
  'GET /companies/{cnpj}/evidences': 'getCompanyEvidences',
  'GET /companies/{cnpj}/scores/{odsNumber}/explanation': 'getScoreExplanation',
  'GET /sectors': 'listSectors',
  'GET /sectors/{cnae}/evolution': 'getSectorEvolution',
};

interface Operation {
  method: string;
  path: string;
  operation: {
    operationId?: string;
    requestBody?: { content?: Record<string, { schema?: unknown }> };
    responses?: Record<
      string,
      { content?: Record<string, { schema?: { $ref?: string } }> }
    >;
  };
}

/** Todas as operações do documento, com método e caminho. */
function operationsOf(document: OpenAPIObject): Operation[] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item as Record<string, Operation['operation']>)
      .filter(([method]) =>
        ['get', 'post', 'put', 'patch', 'delete'].includes(method),
      )
      .map(([method, operation]) => ({
        method: method.toUpperCase(),
        path,
        operation,
      })),
  );
}

/** Todo `$ref` que aparece em qualquer ponto do documento. */
function refsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refsOf);

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      key === '$ref' && typeof child === 'string' ? [child] : refsOf(child),
    );
  }

  return [];
}

/**
 * O documento OpenAPI como o cliente Angular e os integradores o consomem (RF17, #330):
 * modelos com nome, métodos com nome estável, URL base e versão. É gerado da aplicação real,
 * com todos os controllers registrados.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Documento OpenAPI (e2e)',
  () => {
    let app: INestApplication;
    let document: OpenAPIObject;
    let operations: Operation[];

    beforeAll(async () => {
      ({ app } = await createDatabaseTestingApp());
      document = buildApiDocument(app, { serverUrl: SERVER_URL });
      operations = operationsOf(document);

      // O CI publica o documento como artefato, para o front gerar o cliente sem subir a API.
      const exportPath = process.env.OPENAPI_EXPORT_PATH;

      if (exportPath) {
        // Com a URL relativa: quem gera o cliente informa a base da API em tempo de execução.
        const exported = buildApiDocument(app);

        mkdirSync(dirname(exportPath), { recursive: true });
        writeFileSync(exportPath, `${JSON.stringify(exported, null, 2)}\n`);
      }
    });

    afterAll(async () => {
      await app.close();
    });

    describe('identificação do documento', () => {
      it('publica a URL base, para o cliente gerado saber onde chamar', () => {
        expect(document.servers).toEqual([{ url: SERVER_URL }]);
      });

      it('sem URL configurada, usa a relativa "/"', () => {
        expect(buildApiDocument(app).servers).toEqual([{ url: '/' }]);
      });

      it('a versão é a do package.json', () => {
        const { version } = JSON.parse(
          readFileSync('package.json', 'utf8'),
        ) as { version: string };

        expect(document.info.version).toBe(version);
        expect(readApiVersion()).toBe(version);
      });

      it('declara os dois esquemas de autenticação', () => {
        expect(Object.keys(document.components?.securitySchemes ?? {})).toEqual(
          expect.arrayContaining(['jwt', 'api-key']),
        );
      });
    });

    describe('operações', () => {
      it('cada operação tem o operationId explícito esperado, e nenhuma operação some ou aparece sem registro', () => {
        const actual = Object.fromEntries(
          operations.map(({ method, path, operation }) => [
            `${method} ${path}`,
            operation.operationId,
          ]),
        );

        expect(actual).toEqual(EXPECTED_OPERATIONS);
      });

      it('os operationId são únicos', () => {
        const ids = operations.map(({ operation }) => operation.operationId);

        expect(new Set(ids).size).toBe(ids.length);
      });

      it('nenhum operationId deriva do nome da classe do controller', () => {
        for (const { operation } of operations) {
          expect(operation.operationId).not.toMatch(/Controller_/);
          expect(operation.operationId).toMatch(/^[a-z][A-Za-z0-9]*$/);
        }
      });
    });

    describe('modelos nomeados', () => {
      it('não sobra schema com nome automático (__schemaN)', () => {
        expect(JSON.stringify(document)).not.toContain('__schema');
        expect(
          Object.keys(document.components?.schemas ?? {}),
        ).not.toContainEqual(expect.stringMatching(/^__schema/));
      });

      it('a resposta de sucesso em JSON de toda operação é um modelo nomeado', () => {
        for (const { method, path, operation } of operations) {
          const success = Object.entries(operation.responses ?? {}).find(
            ([status]) => status.startsWith('2'),
          )?.[1];
          const json = success?.content?.['application/json'];

          if (!json) continue; // 204 e o arquivo XLSX não têm corpo JSON

          expect(
            json.schema?.$ref,
            `${method} ${path} devolve schema inline`,
          ).toMatch(new RegExp(`^${COMPONENT_PREFIX}[A-Z]`));
        }
      });

      it('o corpo da requisição em JSON de toda operação é um modelo nomeado', () => {
        const withBody = operations.filter(({ operation }) =>
          Boolean(operation.requestBody),
        );

        expect(withBody.length).toBeGreaterThan(10);

        for (const { method, path, operation } of withBody) {
          const schema = operation.requestBody?.content?.['application/json']
            ?.schema as { $ref?: string } | undefined;

          expect(
            schema?.$ref,
            `${method} ${path} recebe schema inline`,
          ).toMatch(new RegExp(`^${COMPONENT_PREFIX}[A-Z]`));
        }
      });

      it('toda resposta de erro declarada usa o mesmo modelo ErrorResponse', () => {
        let errors = 0;

        for (const { operation } of operations) {
          for (const [status, response] of Object.entries(
            operation.responses ?? {},
          )) {
            if (!/^[45]/.test(status)) continue;

            errors += 1;
            expect(response.content?.['application/json']?.schema?.$ref).toBe(
              `${COMPONENT_PREFIX}ErrorResponse`,
            );
          }
        }

        expect(errors).toBeGreaterThan(20);
      });

      it('o perfil completo é um só modelo, partilhado pelo painel e pela API pública', () => {
        const refOf = (path: string) =>
          operations.find(
            (candidate) =>
              candidate.method === 'GET' && candidate.path === path,
          )?.operation.responses?.['200']?.content?.['application/json']?.schema
            ?.$ref;

        expect(refOf('/companies/{cnpj}')).toBe(
          `${COMPONENT_PREFIX}CompanyFullProfileResponse`,
        );
        expect(refOf('/v1/companies/{cnpj}')).toBe(refOf('/companies/{cnpj}'));
      });

      it('as peças reaproveitadas são componentes únicos, e não cópias', () => {
        const schemas = Object.keys(document.components?.schemas ?? {});

        for (const name of [
          'ErrorResponse',
          'PaginationMeta',
          'CompanyOdsScore',
          'ScoreContribution',
          'CompanyEvidence',
          'JsonValue',
          'Address',
        ]) {
          expect(
            schemas.filter((candidate) => candidate === name),
          ).toHaveLength(1);
        }
      });

      it('todo enum anulável traz null na lista, como exige o OpenAPI 3.0.3', () => {
        const nullableEnums: { path: string; values: unknown[] }[] = [];
        const visit = (value: unknown, path: string): void => {
          if (Array.isArray(value)) {
            value.forEach((child, index) => visit(child, `${path}/${index}`));
          } else if (value && typeof value === 'object') {
            const schema = value as Record<string, unknown>;

            if (schema.nullable === true && Array.isArray(schema.enum)) {
              nullableEnums.push({ path, values: schema.enum });
            }
            Object.entries(schema).forEach(([key, child]) =>
              visit(child, `${path}/${key}`),
            );
          }
        };

        visit(document, '');

        // Os campos que a API devolve nulos de verdade precisam estar entre eles.
        expect(nullableEnums.map(({ path }) => path)).toEqual(
          expect.arrayContaining([
            '/components/schemas/ScoreContribution/properties/weight_reason',
            '/components/schemas/CompanyEvidence/properties/signal',
            '/components/schemas/CompanyOdsScore/properties/coverage_status',
          ]),
        );
        expect(
          nullableEnums
            .filter(({ values }) => !values.includes(null))
            .map(({ path }) => path),
        ).toEqual([]);
      });

      it('o JSON livre das evidências é o tipo recursivo JsonValue', () => {
        const schemas = document.components?.schemas ?? {};
        const jsonValue = JSON.stringify(schemas.JsonValue);

        expect(jsonValue).toContain(`${COMPONENT_PREFIX}JsonValue`);
        expect(JSON.stringify(schemas.CompanyEvidence)).toContain(
          `${COMPONENT_PREFIX}JsonValue`,
        );
      });

      it('todo $ref do documento aponta para um componente que existe', () => {
        const schemas = new Set(
          Object.keys(document.components?.schemas ?? {}),
        );
        const dangling = refsOf(document)
          .filter((ref) => ref.startsWith(COMPONENT_PREFIX))
          .map((ref) => ref.slice(COMPONENT_PREFIX.length))
          .filter((name) => !schemas.has(name));

        expect(dangling).toEqual([]);
      });

      it('todo componente é usado por alguma operação ou por outro componente', () => {
        const names = Object.keys(document.components?.schemas ?? {});
        const used = new Set(
          refsOf({
            paths: document.paths,
            schemas: document.components?.schemas,
          })
            .filter((ref) => ref.startsWith(COMPONENT_PREFIX))
            .map((ref) => ref.slice(COMPONENT_PREFIX.length)),
        );

        expect(names.filter((name) => !used.has(name))).toEqual([]);
      });
    });

    describe('arquivo XLSX', () => {
      it('é declarado como binário, e não como JSON', () => {
        const operation = operations.find(
          ({ operation: candidate }) =>
            candidate.operationId === 'exportCompaniesXlsx',
        )?.operation;
        const content = operation?.responses?.['200']?.content;

        expect(Object.keys(content ?? {})).toEqual([
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ]);
      });
    });
  },
);
