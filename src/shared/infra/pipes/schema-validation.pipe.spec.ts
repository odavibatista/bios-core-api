import type { ArgumentMetadata } from '@nestjs/common';
import { faker } from '@test/support/faker.js';
import { z } from 'zod';
import { PaginationQuerySchema } from '../../domain/dtos/requests/pagination.dto.js';
import { ValidationFailedException } from '../../domain/errors/validation-failed.exception.js';
import { SchemaValidationPipe } from './schema-validation.pipe.js';

describe('SchemaValidationPipe', () => {
  const pipe = new SchemaValidationPipe();

  const RequestSchema = z.object({
    cnpj: z.string().regex(/^\d{14}$/),
    address: z.object({ uf: z.string().length(2) }),
  });

  const bodyMetadata: ArgumentMetadata = {
    type: 'body',
    schema: RequestSchema,
  };

  it('devolve o valor transformado pelo schema', async () => {
    const page = faker.number.int({ min: 1, max: 1_000 });
    const queryMetadata: ArgumentMetadata = {
      type: 'query',
      schema: PaginationQuerySchema,
    };

    await expect(
      pipe.transform({ page: String(page) }, queryMetadata),
    ).resolves.toEqual({ page, page_size: 20 });
  });

  it('lança ValidationFailedException com o caminho de cada campo inválido', async () => {
    const attempt = pipe.transform(
      {
        cnpj: faker.string.numeric({ length: { min: 1, max: 13 } }),
        address: { uf: faker.string.alpha({ length: { min: 3, max: 5 } }) },
      },
      bodyMetadata,
    );

    await expect(attempt).rejects.toBeInstanceOf(ValidationFailedException);
    await expect(attempt).rejects.toMatchObject({
      details: [
        { path: 'cnpj', message: expect.any(String) },
        { path: 'address.uf', message: expect.any(String) },
      ],
    });
  });

  it('não valida parâmetros sem schema declarado', async () => {
    const value = faker.lorem.word();

    await expect(pipe.transform(value, { type: 'param' })).resolves.toBe(value);
  });
});
