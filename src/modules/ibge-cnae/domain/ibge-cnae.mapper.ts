import { z } from 'zod';
import {
  cleanText,
  normalizeCnaeCode,
} from '@modules/data-sources/domain/cadastral-normalizers.js';
import type { CnaeDescription } from './dtos/providers/cnae-description.dto.js';

/**
 * Os campos da subclasse da API de Classificações do IBGE que o BIOS usa. O
 * resto (classe, grupo, divisão, seção, atividades e notas explicativas) é
 * descartado: o BIOS precisa só da descrição da subclasse.
 */
const SubclassSchema = z.object({
  id: z.union([z.string(), z.number()]),
  descricao: z.union([z.string(), z.number()]).nullish(),
});

/**
 * A API devolve a subclasse como objeto ou como lista de subclasses,
 * conforme o formato da consulta; lê-se as duas formas.
 */
const ResponseSchema = z.union([z.array(SubclassSchema), SubclassSchema]);

/** O que a resposta diz sobre o código consultado. */
export type CnaeLookup =
  | { kind: 'FOUND'; value: CnaeDescription }
  /** A resposta é válida, mas não traz a subclasse pedida (lista vazia ou de outros códigos). */
  | { kind: 'ABSENT' }
  /** A resposta não tem o formato esperado, ou a subclasse vem sem descrição. */
  | { kind: 'INVALID' };

/**
 * Lê a resposta do IBGE para o código consultado.
 *
 * Só vale a subclasse **de código igual ao pedido**: se a resposta trouxer
 * outra, a descrição de outra atividade seria gravada na empresa errada.
 * Resposta bem formada sem o código é `ABSENT` (o código não existe na
 * taxonomia), e não falha da fonte.
 */
export function readCnaeDescription(
  body: unknown,
  expectedCode: string,
): CnaeLookup {
  const parsed = ResponseSchema.safeParse(body);

  if (!parsed.success) return { kind: 'INVALID' };

  const subclasses = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const subclass = subclasses.find(
    ({ id }) => normalizeCnaeCode(id) === expectedCode,
  );

  if (!subclass) return { kind: 'ABSENT' };

  const description = cleanText(subclass.descricao);

  return description === null
    ? { kind: 'INVALID' }
    : { kind: 'FOUND', value: { code: expectedCode, description } };
}
