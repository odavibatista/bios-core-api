import { z } from 'zod';
import { ptBR } from 'zod/locales';

/** Mensagem de campo obrigatório que não veio na requisição. */
export const REQUIRED_FIELD_MESSAGE = 'Campo obrigatório.';

/**
 * Campo obrigatório ausente: o locale descreveria o tipo recebido ("esperava um texto, recebeu
 * um valor undefined"), que não diz nada a quem preenche um formulário. Os demais casos seguem
 * o locale (`undefined` devolve a vez a ele).
 */
const requiredFieldError: z.core.$ZodErrorMap = (issue) =>
  issue.code === 'invalid_type' && issue.input === undefined
    ? REQUIRED_FIELD_MESSAGE
    : undefined;

/**
 * Mensagens de validação em português (pt-BR) para toda a aplicação.
 *
 * As mensagens escritas nos schemas ("Informe um e-mail válido.") têm precedência; esta
 * configuração cobre as padrão do Zod, que sairiam em inglês nos `details` do 422 e nos erros
 * de variável de ambiente. A configuração é global do Zod: precisa valer antes da primeira
 * validação, a do ambiente no `ConfigModule.forRoot`.
 */
export function configureValidationMessages(): void {
  z.config({ ...ptBR(), customError: requiredFieldError });
}
