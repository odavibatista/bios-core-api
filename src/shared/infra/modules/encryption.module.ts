import { Global, Module } from '@nestjs/common';
import { EncryptionProvider } from '../../domain/providers/encryption.provider.js';
import { OpaqueTokenProvider } from '../../domain/providers/opaque-token.provider.js';
import { PasswordProvider } from '../../domain/providers/password.provider.js';
import { AesEncryptionProvider } from '../providers/aes-encryption.provider.js';
import { BcryptPasswordProvider } from '../providers/bcrypt-password.provider.js';
import { CryptoOpaqueTokenProvider } from '../providers/crypto-opaque-token.provider.js';

/**
 * Módulo global de proteção de dados sensíveis (NFSE03): cifragem reversível
 * de e-mail e endereço, senha em duas camadas (hash cifrado) e tokens opacos
 * de uso único, dos quais só o resumo é persistido.
 *
 * Global porque contas, autenticação e qualquer módulo que persista dado
 * sensível dependem dos mesmos contratos, sempre com a mesma configuração de
 * chaves. A senha fica aqui, e não em `authentication`, porque é cadastro
 * (`accounts`) e login (`authentication`) que a usam, com a mesma composição;
 * o token opaco, pelo mesmo motivo, serve aos links de e-mail (`accounts`) e
 * ao refresh token (`authentication`).
 */
@Global()
@Module({
  providers: [
    AesEncryptionProvider,
    { provide: EncryptionProvider, useExisting: AesEncryptionProvider },
    BcryptPasswordProvider,
    { provide: PasswordProvider, useExisting: BcryptPasswordProvider },
    CryptoOpaqueTokenProvider,
    { provide: OpaqueTokenProvider, useExisting: CryptoOpaqueTokenProvider },
  ],
  exports: [EncryptionProvider, PasswordProvider, OpaqueTokenProvider],
})
export class EncryptionModule {}
