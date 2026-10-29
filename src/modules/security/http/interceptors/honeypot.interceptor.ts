import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { from, type Observable, switchMap } from 'rxjs';
import { RegisterHoneypotHitUseCase } from '../../infra/usecases/register-honeypot-hit.usecase.js';

/** Tamanho máximo gravado do caminho e do user-agent: o resto é descartado. */
const MAX_TEXT_LENGTH = 512;

interface HoneypotRequest {
  ip?: string;
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Registra a chamada e bloqueia o IP **antes** de a isca responder (RF21): a requisição
 * seguinte do mesmo IP, a qualquer rota, já é recusada.
 *
 * Falha no registro não muda a resposta da isca nem afeta outra rota (NFSE07): é
 * registrada no log e a requisição segue.
 */
@Injectable()
export class HoneypotInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HoneypotInterceptor.name);

  constructor(private readonly register: RegisterHoneypotHitUseCase) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<HoneypotRequest>();

    return from(this.registerHit(request)).pipe(switchMap(() => next.handle()));
  }

  private async registerHit(request: HoneypotRequest): Promise<void> {
    if (!request.ip) return;

    const userAgent = request.headers['user-agent'];

    try {
      await this.register.execute({
        ip: request.ip,
        endpoint: request.originalUrl.split('?')[0].slice(0, MAX_TEXT_LENGTH),
        httpMethod: request.method,
        userAgent:
          typeof userAgent === 'string'
            ? userAgent.slice(0, MAX_TEXT_LENGTH)
            : null,
      });
    } catch (error) {
      this.logger.error(
        `Chamada à isca não registrada (${error instanceof Error ? error.name : typeof error}).`,
      );
    }
  }
}
