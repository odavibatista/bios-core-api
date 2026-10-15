import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import type { AuthControllerInterface } from '../../domain/dtos/controllers/auth.controller.dto.js';
import {
  type LoginRequest,
  LoginRequestSchema,
} from '../../domain/dtos/requests/login.dto.js';
import {
  type RefreshSessionRequest,
  RefreshSessionRequestSchema,
} from '../../domain/dtos/requests/refresh-session.dto.js';
import {
  type SessionResponse,
  SessionResponseSchema,
  toSessionResponse,
} from '../../domain/dtos/requests/session.dto.js';
import { LoginUseCase } from '../../infra/usecases/login.usecase.js';
import { RefreshSessionUseCase } from '../../infra/usecases/refresh-session.usecase.js';

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController implements AuthControllerInterface {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshSessionUseCase: RefreshSessionUseCase,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autentica com e-mail e senha e abre uma sessão',
    description:
      'Devolve um access token JWT de vida curta e um refresh token opaco de uso único. Cinco senhas incorretas seguidas bloqueiam o IP ou a conta por 15 minutos.',
  })
  @ResponseSchema(SessionResponseSchema, { description: 'Sessão aberta' })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  async login(
    @Body({ schema: LoginRequestSchema }) body: LoginRequest,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<SessionResponse> {
    const session = await this.loginUseCase.execute({ ...body, ip, userAgent });

    return toSessionResponse(session);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Troca o refresh token por um novo par de tokens',
    description:
      'O refresh token é de uso único: a renovação o invalida e devolve outro. Reapresentar um refresh token já usado derruba todas as sessões do usuário e avisa o titular por e-mail. Toda recusa tem a mesma resposta.',
  })
  @ResponseSchema(SessionResponseSchema, { description: 'Sessão renovada' })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  async refresh(
    @Body({ schema: RefreshSessionRequestSchema }) body: RefreshSessionRequest,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<SessionResponse> {
    const session = await this.refreshSessionUseCase.execute({
      refreshToken: body.refresh_token,
      ip,
      userAgent,
    });

    return toSessionResponse(session);
  }
}
