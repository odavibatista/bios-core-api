import { timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { parseApiKey } from '../../domain/api-key-format.js';
import { InvalidApiKeyException } from '../../domain/dtos/errors/invalid-api-key.exception.js';
import { ApiKeyRepository } from '../../domain/dtos/repositories/api-key.repository.js';

/**
 * Precisão do "último uso" da chave: dentro desta janela, chamadas seguidas
 * não regravam a data. Um minuto basta para o titular saber se a chave está em
 * uso, sem transformar cada leitura da API em escrita no banco.
 */
export const LAST_USED_PRECISION_MS = 60_000;

/** Chave de API autenticada: qual é e de quem. */
export interface AuthenticatedApiKey {
  apiKeyId: string;
  userId: string;
}

/**
 * Autentica uma chamada à API pública pela chave de API (UC12, fluxo 2).
 *
 * O prefixo público localiza a chave; o segredo é conferido pelo resumo
 * SHA-256, em tempo constante. Chave ausente, malformada, desconhecida, com
 * segredo errado ou revogada recebe a mesma recusa.
 *
 * Registrar o uso é acessório: falhar em gravar a data não derruba uma chamada
 * legítima, só fica no registro de erros.
 *
 * @throws {InvalidApiKeyException} quando a chave não é válida.
 */
@Injectable()
export class AuthenticateApiKeyUseCase extends UseCase<
  string | undefined,
  AuthenticatedApiKey
> {
  private readonly logger = new Logger(AuthenticateApiKeyUseCase.name);

  constructor(
    private readonly apiKeyRepository: ApiKeyRepository,
    private readonly opaqueTokenProvider: OpaqueTokenProvider,
  ) {
    super();
  }

  override async execute(
    apiKey: string | undefined,
  ): Promise<AuthenticatedApiKey> {
    const prefix = apiKey ? parseApiKey(apiKey) : null;

    // O formato barra o lixo sem consultar o banco.
    if (!apiKey || !prefix) throw new InvalidApiKeyException();

    // Calculado antes da busca, para que a chave desconhecida não responda
    // mais depressa que a conhecida de segredo errado.
    const hash = this.opaqueTokenProvider.hash(apiKey.trim());
    const credential = await this.apiKeyRepository.findActiveByPrefix(prefix);

    if (!credential || !sameDigest(hash, credential.hash)) {
      throw new InvalidApiKeyException();
    }

    await this.registerUse(credential.id);

    return { apiKeyId: credential.id, userId: credential.userId };
  }

  private async registerUse(apiKeyId: string): Promise<void> {
    const now = new Date();

    try {
      await this.apiKeyRepository.markUsed(
        apiKeyId,
        now,
        new Date(now.getTime() - LAST_USED_PRECISION_MS),
      );
    } catch (error) {
      this.logger.error(
        `Uso da chave ${apiKeyId} não registrado: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** Compara dois resumos hexadecimais em tempo constante. */
function sameDigest(received: string, stored: string): boolean {
  const receivedBytes = Buffer.from(received);
  const storedBytes = Buffer.from(stored);

  return (
    receivedBytes.length === storedBytes.length &&
    timingSafeEqual(receivedBytes, storedBytes)
  );
}
