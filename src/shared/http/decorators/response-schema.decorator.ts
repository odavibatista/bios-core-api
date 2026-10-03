import { applyDecorators, HttpStatus, SerializeOptions } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { z } from 'zod';
import { ErrorResponseSchema } from '../../domain/dtos/errors/error-response.dto.js';

/**
 * Opções de `@ResponseSchema()`.
 */
export interface ResponseSchemaOptions {
  /** Status HTTP da resposta de sucesso (padrão: 200). */
  status?: HttpStatus;
  /** Descrição exibida na documentação. */
  description?: string;
}

/**
 * Declara o schema Zod da resposta de sucesso de um endpoint.
 *
 * Um único schema alimenta duas coisas, que assim nunca divergem:
 *  - a documentação OpenAPI (`@ApiResponse`);
 *  - a serialização da resposta (`@SerializeOptions`): o interceptor global valida
 *    o retorno do handler contra o schema e descarta campos não declarados, impedindo
 *    o vazamento acidental de dados internos (ex.: hashes e campos cifrados).
 */
export function ResponseSchema(
  schema: z.ZodType,
  { status = HttpStatus.OK, description = '' }: ResponseSchemaOptions = {},
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiResponse({ status, description, standardSchema: schema }),
    SerializeOptions({ schema }),
  );
}

/**
 * Documenta as respostas de erro possíveis de um endpoint com o corpo de erro
 * padronizado (`ErrorResponse`).
 */
export function ErrorResponses(
  ...statuses: HttpStatus[]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: HttpStatus[status],
        standardSchema: ErrorResponseSchema,
      }),
    ),
  );
}
