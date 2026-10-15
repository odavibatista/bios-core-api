/** Pesos do módulo 11 para o primeiro e o segundo dígito verificador. */
const FIRST_CHECK_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const SECOND_CHECK_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/** Doze posições alfanuméricas (a raiz e a ordem) e dois dígitos verificadores. */
const CNPJ_PATTERN = /^[0-9A-Z]{12}\d{2}$/;

/** Pontuação aceita na entrada e removida na normalização. */
const MASK_CHARACTERS = /[./\-\s]/g;

/** Código de "0" na tabela ASCII: o valor de cada caractere é o seu código menos 48. */
const ASCII_ZERO = 48;

/**
 * Dígito verificador de uma sequência de caracteres, pelo módulo 11.
 *
 * O valor de cada caractere é o seu código ASCII menos 48: os algarismos valem
 * 0 a 9 e as letras valem 17 a 42. É a regra do CNPJ alfanumérico (a Receita
 * Federal passou a emiti-lo em julho de 2026) e, para os algarismos, reduz-se
 * ao cálculo clássico — por isso o mesmo código vale para os CNPJs antigos.
 */
function checkDigit(characters: string, weights: readonly number[]): number {
  const sum = [...characters].reduce(
    (total, character, index) =>
      total + (character.charCodeAt(0) - ASCII_ZERO) * weights[index],
    0,
  );
  const remainder = sum % 11;

  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * CNPJ na forma canônica — 14 caracteres, sem pontuação e em maiúsculas —, ou
 * `null` quando o texto não é um CNPJ válido.
 *
 * Aceita a forma com máscara (`11.222.333/0001-81`) e o CNPJ alfanumérico
 * (`12.ABC.345/01DE-35`). Confere o formato e os dois dígitos verificadores, e
 * recusa as sequências de um caractere só (`00000000000000`), que passam no
 * cálculo mas não são CNPJs.
 *
 * A forma canônica é a que entra em chaves de cache, filas e no banco: o mesmo
 * CNPJ escrito de jeitos diferentes não vira duas entradas.
 */
export function parseCnpj(text: string): string | null {
  const cnpj = text.replace(MASK_CHARACTERS, '').toUpperCase();

  if (!CNPJ_PATTERN.test(cnpj)) return null;

  if (new Set(cnpj).size === 1) return null;

  const first = checkDigit(cnpj.slice(0, 12), FIRST_CHECK_WEIGHTS);
  const second = checkDigit(cnpj.slice(0, 13), SECOND_CHECK_WEIGHTS);

  return cnpj.endsWith(`${first}${second}`) ? cnpj : null;
}

/** CNPJ canônico com a máscara de exibição (`11.222.333/0001-81`). */
export function formatCnpj(cnpj: string): string {
  return cnpj.replace(/^(.{2})(.{3})(.{3})(.{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
