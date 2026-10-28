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

/** Portes da Receita Federal, na grafia que o BIOS adota. */
const COMPANY_SIZE_BY_LETTERS: Readonly<Record<string, string | null>> = {
  MICROEMPRESA: 'MICRO EMPRESA',
  ME: 'MICRO EMPRESA',
  EMPRESADEPEQUENOPORTE: 'EMPRESA DE PEQUENO PORTE',
  PEQUENOPORTE: 'EMPRESA DE PEQUENO PORTE',
  EPP: 'EMPRESA DE PEQUENO PORTE',
  DEMAIS: 'DEMAIS',
  NAOINFORMADO: null,
};

/**
 * Porte da empresa na grafia única do BIOS (`MICRO EMPRESA`,
 * `EMPRESA DE PEQUENO PORTE`, `DEMAIS`), ou `null` quando não informado.
 *
 * Os provedores escrevem o mesmo porte de jeitos diferentes (`Demais`,
 * `MICROEMPRESA`, `Micro Empresa`); sem unificar, trocar de provedor mudaria o
 * cadastro — e o hash de conteúdo que detecta mudança cadastral — sem que a
 * empresa tivesse mudado. Um porte desconhecido é mantido, em maiúsculas e sem
 * acento, em vez de descartado.
 */
export function normalizeCompanySize(value: RawValue): string | null {
  const text = cleanUpperText(value)
    ?.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

  if (!text) return null;

  const letters = text.replace(/[^A-Z]/g, '');

  return letters in COMPANY_SIZE_BY_LETTERS
    ? COMPANY_SIZE_BY_LETTERS[letters]
    : text;
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
 * Situações cadastrais que o BIOS expõe (#338): as cinco da Receita Federal e
 * `NAO_RECONHECIDA`, para a que o provedor informa e não está entre elas.
 */
export const REGISTRATION_STATUSES = [
  'ATIVA',
  'SUSPENSA',
  'INAPTA',
  'BAIXADA',
  'NULA',
  'NAO_RECONHECIDA',
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Situação informada pelo provedor que não está no conjunto da Receita. */
export const UNRECOGNIZED_REGISTRATION_STATUS = 'NAO_RECONHECIDA';

/** Situação cadastral no conjunto do BIOS, com o texto do provedor quando não casou. */
export interface NormalizedRegistrationStatus {
  status: RegistrationStatus;
  /** Texto do provedor, só quando a situação é `NAO_RECONHECIDA`. */
  unrecognized: string | null;
}

/** Situações da Receita pelas letras da descrição (sem acento, caixa ou pontuação). */
const REGISTRATION_STATUS_BY_LETTERS: Readonly<
  Record<string, RegistrationStatus>
> = {
  ATIVA: 'ATIVA',
  SUSPENSA: 'SUSPENSA',
  INAPTA: 'INAPTA',
  BAIXADA: 'BAIXADA',
  NULA: 'NULA',
};

/** Situações da Receita pelo código numérico (`situacao_cadastral`). */
const REGISTRATION_STATUS_BY_CODE: Readonly<
  Record<number, RegistrationStatus>
> = {
  1: 'NULA',
  2: 'ATIVA',
  3: 'SUSPENSA',
  4: 'INAPTA',
  8: 'BAIXADA',
};

/**
 * Situação cadastral no conjunto fechado do BIOS (#338).
 *
 * Os provedores escrevem a mesma situação de jeitos diferentes (`ATIVA`, `Ativa`,
 * o código `2`); sem unificar, o front não teria um conjunto conhecido para
 * traduzir, filtrar ou colorir, e trocar de provedor mudaria o cadastro. Vale a
 * descrição, comparada só pelas letras; do contrário, o código da Receita (que
 * também pode vir no lugar da descrição).
 *
 * Situação informada que não casa com nenhuma das cinco **não derruba o
 * cadastro nem é perdida**: vira `NAO_RECONHECIDA`, com o texto do provedor em
 * `unrecognized`. `null` só quando o provedor não informa situação alguma.
 */
export function normalizeRegistrationStatus(
  description: RawValue,
  code?: RawValue,
): NormalizedRegistrationStatus | null {
  const text = cleanText(description);
  const codeText = cleanText(code);
  const recognized =
    statusByText(text) ??
    (codeText === null ? undefined : statusByText(codeText));

  if (recognized) return { status: recognized, unrecognized: null };

  const informed = text ?? codeText;

  return informed === null
    ? null
    : { status: UNRECOGNIZED_REGISTRATION_STATUS, unrecognized: informed };
}

function statusByText(text: string | null): RegistrationStatus | undefined {
  if (text === null) return undefined;

  if (/^\d+$/.test(text)) return REGISTRATION_STATUS_BY_CODE[Number(text)];

  const letters = text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[^A-Z]/g, '');

  return REGISTRATION_STATUS_BY_LETTERS[letters];
}

/**
 * Situação de um cadastro já gravado, no conjunto fechado.
 *
 * Cadastros gravados antes do conjunto fechado guardam a descrição do provedor
 * como veio; a que não for uma das situações conhecidas é lida como
 * `NAO_RECONHECIDA`, com o texto guardado, em vez de quebrar a resposta.
 */
export function storedRegistrationStatus(
  stored: string,
  unrecognized: string | null,
): NormalizedRegistrationStatus {
  const known = REGISTRATION_STATUSES.find((status) => status === stored);

  return known
    ? { status: known, unrecognized }
    : { status: UNRECOGNIZED_REGISTRATION_STATUS, unrecognized: stored };
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
