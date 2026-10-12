import { Global, Module } from '@nestjs/common';
import { EncryptionProvider } from '../../domain/providers/encryption.provider.js';
import { PasswordProvider } from '../../domain/providers/password.provider.js';
import { AesEncryptionProvider } from '../providers/aes-encryption.provider.js';
import { BcryptPasswordProvider } from '../providers/bcrypt-password.provider.js';

/**
 * Módulo global de proteção de dados sensíveis (NFSE03): cifragem reversível
 * de e-mail e endereço, e senha em duas camadas (hash cifrado).
 *
 * Global porque contas, autenticação e qualquer módulo que persista dado
 * sensível dependem dos mesmos contratos, sempre com a mesma configuração de
 * chaves. A senha fica aqui, e não em `authentication`, porque é cadastro
 * (`accounts`) e login (`authentication`) que a usam, com a mesma composição.
 */
@Global()
@Module({
  providers: [
    AesEncryptionProvider,
    { provide: EncryptionProvider, useExisting: AesEncryptionProvider },
    BcryptPasswordProvider,
    { provide: PasswordProvider, useExisting: BcryptPasswordProvider },
  ],
  exports: [EncryptionProvider, PasswordProvider],
})
export class EncryptionModule {}
