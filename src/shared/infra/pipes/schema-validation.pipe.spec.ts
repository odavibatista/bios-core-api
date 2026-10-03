import type { ArgumentMetadata } from '@nestjs/common';
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
    const queryMetadata: ArgumentMetadata = {
      type: 'query',
      schema: PaginationQuerySchema,
    };

    await expect(pipe.transform({ page: '3' }, queryMetadata)).resolves.toEqual(
      {
        page: 3,
        page_size: 20,
      },
    );
  });

  it('lança ValidationFailedException com o caminho de cada campo inválido', async () => {
    const attempt = pipe.transform(
      { cnpj: '123', address: { uf: 'SAO' } },
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
    await expect(pipe.transform('livre', { type: 'param' })).resolves.toBe(
      'livre',
    );
  });
});
