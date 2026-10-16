import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { apiKeyOf } from '@shared/config/throttler.config.js';
import { AuthenticateApiKeyUseCase } from '../../infra/usecases/authenticate-api-key.usecase.js';

/**
 * Guard da API pública: exige uma chave de API válida no cabeçalho
 * `x-api-key` (UC12).
 *
 * Roda depois dos guards globais — entre eles o do limite de requisições, que
 * conta a chamada antes de a chave ser conferida, para que tentativas com
 * chaves inventadas também gastem a cota. A rota que o usa precisa ser
 * `@Public()`, pois o guard global de sessão não se aplica a integradores;
 * `@ApiKeyAuth()` reúne as duas coisas.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly authenticateApiKeyUseCase: AuthenticateApiKeyUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers?: Record<string, unknown> }>();

    await this.authenticateApiKeyUseCase.execute(apiKeyOf(request));

    return true;
  }
}
