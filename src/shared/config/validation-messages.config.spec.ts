import { z } from 'zod';
import {
  configureValidationMessages,
  REQUIRED_FIELD_MESSAGE,
} from './validation-messages.config.js';

/** Mensagem da primeira falha de `schema` para `input`. */
function messageOf(schema: z.ZodType, input: unknown): string | undefined {
  return schema.safeParse(input).error?.issues[0]?.message;
}

// Sem configurar aqui: os casos dependem do setup dos testes unitários, que precisa aplicá-la.
describe('configureValidationMessages', () => {
  it('campo obrigatório ausente: mensagem própria, sem descrever o tipo recebido', () => {
    const schema = z.object({ password: z.string() });

    expect(messageOf(schema, {})).toBe(REQUIRED_FIELD_MESSAGE);
  });

  it('tipo errado: mensagem do locale pt-BR', () => {
    expect(messageOf(z.string(), 123)).toBe(
      'Entrada inválida: esperava um texto, recebeu um número',
    );
  });

  it.each([
    [z.string().min(8), 'abc', /^Pequeno demais/],
    [z.number().max(10), 11, /^Grande demais/],
    [z.enum(['A', 'B']), 'C', /^Opção inválida/],
    [z.email(), 'x', /^Formato d.* inválido/],
    [z.object({}).strict(), { extra: 1 }, /^Chave inválida: "extra"/],
  ])('mensagem padrão em português (%#)', (schema, input, pattern) => {
    expect(messageOf(schema as z.ZodType, input)).toMatch(pattern);
  });

  it('a mensagem escrita no schema tem precedência', () => {
    const schema = z.object({
      email: z.string({ error: 'Informe um e-mail válido.' }),
    });

    expect(messageOf(schema, {})).toBe('Informe um e-mail válido.');
  });

  it('nenhuma mensagem padrão em inglês', () => {
    const schema = z.object({
      name: z.string().min(2),
      age: z.number().int(),
      role: z.enum(['USER', 'ADMIN']),
    });
    const messages = schema
      .safeParse({ name: 'a', age: 1.5, role: 'X' })
      .error?.issues.map(({ message }) => message);

    expect(messages).toHaveLength(3);
    for (const message of messages ?? []) {
      expect(message).not.toMatch(/Invalid|expected|Too small|Too big/);
    }
  });

  // Por último, para os casos acima dependerem só do setup.
  it('reaplicar a configuração não muda as mensagens', () => {
    configureValidationMessages();

    expect(messageOf(z.object({ password: z.string() }), {})).toBe(
      REQUIRED_FIELD_MESSAGE,
    );
    expect(messageOf(z.string(), 123)).toBe(
      'Entrada inválida: esperava um texto, recebeu um número',
    );
  });
});
