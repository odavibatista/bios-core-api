import type { EncryptedValue } from '@shared/domain/providers/encryption.provider.js';

/** `<versão>:<texto cifrado>`, o texto em base64url. */
const PENDING_EMAIL_PATTERN = /^(\d+):([A-Za-z0-9_-]+)$/;

/**
 * Novo e-mail, cifrado, na forma em que o token de troca de e-mail o guarda.
 *
 * O token só tem um campo de texto para o e-mail pendente, e o link vale por
 * horas: se a chave de cifragem for rotacionada nesse intervalo, o e-mail
 * precisa poder ser decifrado com a versão que o cifrou. Por isso a versão
 * viaja junto do texto cifrado.
 */
export function encodePendingEmail({
  ciphertext,
  keyVersion,
}: EncryptedValue): string {
  return `${keyVersion}:${ciphertext}`;
}

/** Inverso de `encodePendingEmail`; `null` para qualquer texto que não tenha essa forma. */
export function decodePendingEmail(encoded: string): EncryptedValue | null {
  const match = PENDING_EMAIL_PATTERN.exec(encoded);

  return match ? { keyVersion: Number(match[1]), ciphertext: match[2] } : null;
}
