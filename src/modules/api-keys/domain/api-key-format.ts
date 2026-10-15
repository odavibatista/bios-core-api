/** Início de toda chave de API do BIOS: identifica o que é, em log e em varredura de segredos. */
export const API_KEY_PREFIX = 'bios';

/** Caracteres aleatórios do prefixo público da chave. */
export const API_KEY_PUBLIC_ID_LENGTH = 8;

/** Caracteres do segredo (256 bits em base64url). */
const API_KEY_SECRET_LENGTH = 43;

/** `bios_<8 alfanuméricos>_<43 de base64url>`. */
const API_KEY_PATTERN = new RegExp(
  `^(${API_KEY_PREFIX}_[A-Za-z0-9]{${API_KEY_PUBLIC_ID_LENGTH}})_[A-Za-z0-9_-]{${API_KEY_SECRET_LENGTH}}$`,
);

/**
 * Chave completa a partir do identificador público e do segredo.
 *
 * `bios_<identificador>_<segredo>`: o início identifica a chave sem revelá-la,
 * e o identificador público (`bios_<identificador>`) é o prefixo que a
 * listagem exibe e que permite localizar a chave sem varrer hashes.
 */
export function buildApiKey(publicId: string, secret: string): string {
  return `${API_KEY_PREFIX}_${publicId}_${secret}`;
}

/** Prefixo público de uma chave (`bios_<identificador>`). */
export function apiKeyPrefixOf(publicId: string): string {
  return `${API_KEY_PREFIX}_${publicId}`;
}

/**
 * Prefixo público de um texto que tem o formato de uma chave de API, ou `null`.
 *
 * Confere só o formato — barra de imediato o lixo que não pode ser chave sem
 * consultar o banco —, e não a validade: quem decide é o hash.
 */
export function parseApiKey(text: string): string | null {
  return API_KEY_PATTERN.exec(text.trim())?.[1] ?? null;
}
