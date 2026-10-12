import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import type { Environment } from '../../config/environment.config.js';
import type { EncryptedValue } from '../../domain/providers/encryption.provider.js';
import { EncryptionProvider } from '../../domain/providers/encryption.provider.js';
import { PasswordProvider } from '../../domain/providers/password.provider.js';

/**
 * Senha protegida em duas camadas: hash bcrypt, cifrado com AES-256 (NFSE03).
 *
 * O bcrypt resiste a força bruta pelo custo configurável; a cifragem do hash
 * acrescenta uma segunda barreira, porque a chave AES vive fora do banco. Um
 * vazamento da coleção, sozinho, não permite nem testar senhas contra o hash.
 *
 * **Pré-hash antes do bcrypt.** O bcrypt ignora o que passa de 72 bytes. Sem
 * tratamento, duas senhas longas que só diferem depois desse limite seriam
 * aceitas uma pela outra — uma falha real de autenticação, não um detalhe
 * teórico. Por isso a senha passa primeiro por SHA-256 em base64 (44
 * caracteres, sempre dentro do limite), e só esse resumo vai ao bcrypt. O
 * base64 também evita o byte nulo, que truncaria a entrada em implementações
 * do bcrypt escritas em C.
 *
 * Trocar essa composição invalidaria todas as senhas já gravadas: qualquer
 * mudança aqui exige um fluxo de reidratação no próximo login.
 */
@Injectable()
export class BcryptPasswordProvider extends PasswordProvider {
  private readonly cost: number;

  constructor(
    configService: ConfigService<Environment, true>,
    private readonly encryptionProvider: EncryptionProvider,
  ) {
    super();
    this.cost = configService.get('BCRYPT_COST', { infer: true });
  }

  override async hash(plaintext: string): Promise<EncryptedValue> {
    const digest = await hash(prepare(plaintext), this.cost);

    return this.encryptionProvider.encrypt(digest);
  }

  override async verify(
    plaintext: string,
    stored: EncryptedValue,
  ): Promise<boolean> {
    const digest = this.encryptionProvider.decrypt(stored);

    return compare(prepare(plaintext), digest);
  }
}

/**
 * Resumo da senha em base64, para que o bcrypt receba sempre uma entrada
 * dentro do seu limite de 72 bytes.
 */
function prepare(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('base64');
}
