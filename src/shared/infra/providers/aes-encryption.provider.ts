import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EncryptionKeyring } from '../../config/encryption.config.js';
import type { Environment } from '../../config/environment.config.js';
import { EncryptionException } from '../../domain/errors/encryption.exception.js';
import {
  type EncryptedValue,
  EncryptionProvider,
} from '../../domain/providers/encryption.provider.js';

const ALGORITHM = 'aes-256-gcm';

/** Tamanho do IV recomendado para o GCM, em bytes. */
const IV_LENGTH = 12;

/** Tamanho da tag de autenticação do GCM, em bytes. */
const TAG_LENGTH = 16;

/**
 * Criptografia simétrica de dados sensíveis com AES-256-GCM (NFSE03).
 *
 * O modo GCM é autenticado: a decifragem só devolve o valor se a tag confirmar
 * que o criptograma não foi alterado. Cada operação sorteia um IV próprio, de
 * modo que cifrar o mesmo valor duas vezes produz textos diferentes — dois
 * documentos com o mesmo e-mail, por exemplo, não são identificáveis pelo
 * conteúdo cifrado.
 *
 * O texto cifrado é serializado como `IV || tag || criptograma` em base64url,
 * e a versão da chave viaja ao lado dele (`EncryptedValue`), não embutida: é o
 * que permite decifrar documentos antigos durante uma rotação de chave.
 *
 * O índice cego usa HMAC-SHA256 com chave própria. Sem uma chave (ou seja, com
 * um hash simples), um vazamento permitiria confirmar se um e-mail conhecido
 * está cadastrado apenas recalculando o hash.
 */
@Injectable()
export class AesEncryptionProvider extends EncryptionProvider {
  private readonly keyring: EncryptionKeyring;
  private readonly blindIndexKey: Buffer;

  constructor(configService: ConfigService<Environment, true>) {
    super();
    this.keyring = configService.get('ENCRYPTION_KEYS', { infer: true });
    this.blindIndexKey = configService.get('BLIND_INDEX_KEY', { infer: true });
  }

  override get activeKeyVersion(): number {
    return this.keyring.activeVersion;
  }

  override encrypt(plaintext: string): EncryptedValue {
    const keyVersion = this.keyring.activeVersion;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.keyOf(keyVersion), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return {
      ciphertext: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
        'base64url',
      ),
      keyVersion,
    };
  }

  override decrypt({ ciphertext, keyVersion }: EncryptedValue): string {
    const payload = Buffer.from(ciphertext, 'base64url');

    if (payload.length <= IV_LENGTH + TAG_LENGTH) {
      throw new EncryptionException('texto cifrado truncado');
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      this.keyOf(keyVersion),
      payload.subarray(0, IV_LENGTH),
    );
    decipher.setAuthTag(payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));

    try {
      return Buffer.concat([
        decipher.update(payload.subarray(IV_LENGTH + TAG_LENGTH)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new EncryptionException(
        'falha na verificação de integridade (texto adulterado ou chave incorreta)',
      );
    }
  }

  override blindIndex(value: string): string {
    return createHmac('sha256', this.blindIndexKey)
      .update(normalize(value))
      .digest('base64url');
  }

  private keyOf(version: number): Buffer {
    const key = this.keyring.keys.get(version);

    if (!key) {
      throw new EncryptionException(
        `versão de chave ${version} não está configurada em ENCRYPTION_KEYS`,
      );
    }

    return key;
  }
}

/**
 * Normalização do valor antes do índice cego: a busca precisa encontrar a
 * conta independentemente de caixa, espaços nas bordas ou forma Unicode.
 */
function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFC');
}
