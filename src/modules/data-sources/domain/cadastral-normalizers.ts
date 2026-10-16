/**
 * Funções de normalização que os adapters cadastrais compartilham.
 *
 * Os provedores concordam no conteúdo (vem tudo da Receita Federal) e
 * discordam na forma: número ou texto, vazio ou ausente, com ou sem máscara.
 * Normalizar aqui, uma vez, é o que faz o mesmo cadastro sair igual de qualquer
 * um deles — e o hash do conteúdo (detecção de mudança) não variar por troca de
 * provedor.
 */

/** Valor que o provedor pode mandar como texto, número ou nada. */
export type RawValue = string | number | null | undefined;

/** Texto sem espaços nas bordas, ou `null` quando vazio ou ausente. */
export function cleanText(value: RawValue): string | null {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();

  return text === '' ? null : text;
}

/** Texto limpo em maiúsculas, ou `null`. */
export function cleanUpperText(value: RawValue): string | null {
  return cleanText(value)?.toUpperCase() ?? null;
}

/**
 * Número de `length` dígitos com zeros à esquerda, ou `null`.
 *
 * Provedores que mandam o código como número perdem os zeros iniciais
 * (`1234567` em vez de `01234567`); quem o recebe como texto pode trazer
 * máscara. Zero e valores fora do tamanho são tratados como ausência: é como
 * alguns provedores indicam "sem informação".
 */
function fixedDigits(value: RawValue, length: number): string | null {
  const digits = cleanText(value)?.replace(/\D/g, '') ?? '';

  if (digits === '' || /^0+$/.test(digits) || digits.length > length) {
    return null;
  }

  return digits.padStart(length, '0');
}

/** Código CNAE de 7 dígitos, ou `null` (inclui o `0` que indica "sem CNAE"). */
export function normalizeCnaeCode(value: RawValue): string | null {
  return fixedDigits(value, 7);
}

/** Código IBGE de município de 7 dígitos, ou `null`. */
export function normalizeIbgeCode(value: RawValue): string | null {
  return fixedDigits(value, 7);
}

/** CEP de 8 dígitos, sem máscara, ou `null`. */
export function normalizeZipcode(value: RawValue): string | null {
  return fixedDigits(value, 8);
}

/** Sigla da UF: 2 letras maiúsculas, ou `null`. */
export function normalizeUf(value: RawValue): string | null {
  const uf = cleanUpperText(value);

  return uf !== null && /^[A-Z]{2}$/.test(uf) ? uf : null;
}

/**
 * Situação cadastral a partir do código da Receita, para o provedor que só
 * informa o número.
 */
const REGISTRATION_STATUS_BY_CODE: Readonly<Record<number, string>> = {
  1: 'NULA',
  2: 'ATIVA',
  3: 'SUSPENSA',
  4: 'INAPTA',
  8: 'BAIXADA',
};

/**
 * Situação cadastral em maiúsculas: a descrição, quando vem; do contrário, a
 * traduzida do código. `null` quando nenhuma das duas permite saber.
 */
export function normalizeRegistrationStatus(
  description: RawValue,
  code?: RawValue,
): string | null {
  const text = cleanUpperText(description);

  if (text !== null) return text;

  const numeric = Number(cleanText(code));

  return REGISTRATION_STATUS_BY_CODE[numeric] ?? null;
}

/**
 * Logradouro completo. A Receita guarda o tipo (`AVENIDA`) à parte do nome
 * (`PAULISTA`); junta os dois, a menos que o nome já comece pelo tipo.
 */
export function joinStreet(type: RawValue, name: RawValue): string | null {
  const streetType = cleanUpperText(type);
  const streetName = cleanText(name);

  if (streetName === null) return null;

  if (streetType === null || streetName.toUpperCase().startsWith(streetType)) {
    return streetName;
  }

  return `${streetType} ${streetName}`;
}
