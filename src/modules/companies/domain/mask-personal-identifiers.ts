/** Texto que substitui o CPF. */
export const CPF_MASK = '***';

/**
 * CPF com exatamente 11 dígitos, com ou sem a pontuação `000.000.000-00`.
 *
 * Os `lookaround` exigem que a sequência não seja parte de uma maior: um CNPJ
 * numérico (14 dígitos) ou formatado (`00.000.000/0000-00`) não é tocado.
 */
const CPF_PATTERN = /(?<!\d)(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/g;

/**
 * Troca por `***` os CPFs que aparecem no texto (INL02).
 *
 * A Receita Federal grava a razão social de empresário individual e de MEI como
 * `NOME COMPLETO 12345678901`: o CPF do titular vem dentro do nome da empresa.
 * O nome do empresário é público por lei; o CPF não precisa ser, e o BIOS só
 * guarda dado público de pessoa jurídica.
 *
 * Mascara toda sequência de 11 dígitos, sem conferir os dígitos verificadores:
 * mascarar um número que não era CPF custa quase nada, e deixar passar um que
 * era custa o que a regra existe para evitar.
 */
export function maskPersonalIdentifiers(text: string): string {
  return text.replace(CPF_PATTERN, CPF_MASK);
}

/** O mesmo, preservando a ausência. */
export function maskPersonalIdentifiersOrNull(
  text: string | null,
): string | null {
  return text === null ? null : maskPersonalIdentifiers(text);
}
