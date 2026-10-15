/**
 * E-mail na forma canônica: sem espaços nas bordas e em minúsculas.
 *
 * É a forma que entra no índice cego e na comparação de unicidade. Sem ela,
 * `Maria@Exemplo.com` e `maria@exemplo.com` virariam duas contas, e o login
 * digitado com outra caixa não encontraria a conta.
 *
 * Aplicada pelo caso de uso, e não pelo schema de entrada: a regra vale para
 * qualquer caminho que receba um e-mail (cadastro, login, reenvio), mesmo os
 * que não passam por um endpoint.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Primeiro nome de um nome completo, para a saudação dos e-mails.
 *
 * Devolve o nome inteiro quando não há espaço.
 */
export function firstNameOf(fullName: string): string {
  const [first = ''] = fullName.trim().split(/\s+/);

  return first;
}
