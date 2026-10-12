import { Global, Module } from '@nestjs/common';
import { EncryptionProvider } from '../../domain/providers/encryption.provider.js';
import { AesEncryptionProvider } from '../providers/aes-encryption.provider.js';

/**
 * Módulo global de criptografia de dados sensíveis (NFSE03).
 *
 * Global porque contas, tokens e qualquer módulo que persista dado sensível
 * dependem do mesmo contrato, sempre com a mesma configuração de chaves.
 */
@Global()
@Module({
  providers: [
    AesEncryptionProvider,
    { provide: EncryptionProvider, useExisting: AesEncryptionProvider },
  ],
  exports: [EncryptionProvider],
})
export class EncryptionModule {}
