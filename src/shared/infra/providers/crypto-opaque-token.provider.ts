import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type GeneratedOpaqueToken,
  OpaqueTokenProvider,
} from '../../domain/providers/opaque-token.provider.js';

/** Bytes aleatórios do token: 256 bits, fora do alcance de qualquer tentativa por força bruta. */
const TOKEN_BYTES = 32;

/**
 * Tokens opacos sobre o gerador criptográfico do Node.
 *
 * O resumo é SHA-256 simples, sem sal nem custo: o token já tem 256 bits de
 * entropia, então não há dicionário a atacar, e o resumo precisa ser
 * determinístico para servir de chave de busca. Um hash lento (bcrypt) só
 * seria necessário para segredos escolhidos por pessoas, como a senha.
 */
@Injectable()
export class CryptoOpaqueTokenProvider extends OpaqueTokenProvider {
  override generate(): GeneratedOpaqueToken {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');

    return { token, hash: this.hash(token) };
  }

  override hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
