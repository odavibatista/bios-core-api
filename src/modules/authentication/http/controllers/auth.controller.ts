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
  type LoginResponse,
  LoginResponseSchema,
} from '../../domain/dtos/requests/login.dto.js';
import { LoginUseCase } from '../../infra/usecases/login.usecase.js';

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController implements AuthControllerInterface {
  constructor(private readonly loginUseCase: LoginUseCase) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autentica com e-mail e senha e abre uma sessão',
    description:
      'Devolve um access token JWT de vida curta e um refresh token opaco de uso único. Cinco senhas incorretas seguidas bloqueiam o IP ou a conta por 15 minutos.',
  })
  @ResponseSchema(LoginResponseSchema, { description: 'Sessão aberta' })
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
  ): Promise<LoginResponse> {
    const session = await this.loginUseCase.execute({ ...body, ip, userAgent });

    return {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      token_type: 'Bearer',
      expires_in: session.expiresIn,
      user: session.user,
    };
  }
}
