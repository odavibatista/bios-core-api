import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { CurrentUser } from '@shared/http/decorators/current-user.decorator.js';
import { Public } from '@shared/http/decorators/public.decorator.js';
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
import { LogoutUseCase } from '../../infra/usecases/logout.usecase.js';
import { RefreshSessionUseCase } from '../../infra/usecases/refresh-session.usecase.js';

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController implements AuthControllerInterface {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshSessionUseCase: RefreshSessionUseCase,
    private readonly logoutUseCase: LogoutUseCase,
  ) {}

  @Public()
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

  @Public()
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

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Encerra a sessão do dispositivo atual',
    description:
      'Revoga a sessão do dispositivo: o access token deixa de ser aceito de imediato, sem esperar o vencimento, e o refresh token deixa de renovar. As sessões dos outros dispositivos não são afetadas.',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Sessão encerrada',
  })
  @ErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.logoutUseCase.execute({ user, allDevices: false });
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Encerra as sessões de todos os dispositivos do usuário',
    description:
      'Revoga todas as sessões ativas do usuário, inclusive a atual, com efeito imediato sobre os tokens já emitidos.',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Sessões encerradas',
  })
  @ErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS)
  async logoutAllDevices(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.logoutUseCase.execute({ user, allDevices: true });
  }
}
