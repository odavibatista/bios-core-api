import { z } from 'zod';
import { cleanText } from '@modules/data-sources/domain/cadastral-normalizers.js';
import type { PostalAddress } from './dtos/providers/postal-address.dto.js';

/** CEP com 8 dígitos, ou `null`. Aceita a forma com hífen. */
export function normalizePostalCode(value: string): string | null {
  const digits = value.trim().replace('-', '');

  return /^\d{8}$/.test(digits) ? digits : null;
}

/** O ViaCEP responde 200 com `erro` para um CEP bem formado que não existe. */
const AbsentSchema = z.object({
  erro: z.union([z.literal(true), z.literal('true')]),
});

/** Os campos do ViaCEP que o BIOS usa. O resto (DDD, GIA, SIAFI, região) é descartado. */
const AddressSchema = z.object({
  cep: z.string(),
  logradouro: z.string().nullish(),
  bairro: z.string().nullish(),
  localidade: z.string(),
  uf: z.string().regex(/^[A-Z]{2}$/),
  ibge: z.string().nullish(),
});

/** O que a resposta diz sobre o CEP consultado. */
export type PostalCodeLookup =
  | { kind: 'FOUND'; value: PostalAddress }
  /** O CEP não existe. */
  | { kind: 'ABSENT' }
  /** A resposta não tem o formato esperado, ou é de outro CEP. */
  | { kind: 'INVALID' };

/**
 * Lê a resposta do ViaCEP para o CEP consultado.
 *
 * Só vale o endereço **do CEP pedido**: uma resposta de outro CEP preencheria o endereço de
 * alguém com a rua errada. Número e complemento nunca são lidos: o CEP não os define, e o
 * campo `complemento` do ViaCEP é uma faixa de numeração, não o complemento da pessoa.
 */
export function readPostalAddress(
  body: unknown,
  expectedCode: string,
): PostalCodeLookup {
  if (AbsentSchema.safeParse(body).success) return { kind: 'ABSENT' };

  const parsed = AddressSchema.safeParse(body);

  if (!parsed.success) return { kind: 'INVALID' };

  const { cep, logradouro, bairro, localidade, uf, ibge } = parsed.data;
  const city = cleanText(localidade);

  if (normalizePostalCode(cep) !== expectedCode || city === null) {
    return { kind: 'INVALID' };
  }

  return {
    kind: 'FOUND',
    value: {
      postalCode: expectedCode,
      street: cleanText(logradouro),
      neighborhood: cleanText(bairro),
      city,
      state: uf,
      cityIbgeCode: ibge && /^\d{7}$/.test(ibge) ? ibge : null,
    },
  };
}
