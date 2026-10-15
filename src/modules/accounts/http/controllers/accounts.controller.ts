import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import type { AccountsControllerInterface } from '../../domain/dtos/controllers/accounts.controller.dto.js';
import {
  type AccountMessageResponse,
  AccountMessageResponseSchema,
} from '../../domain/dtos/requests/account-message.dto.js';
import {
  type ConfirmEmailRequest,
  ConfirmEmailRequestSchema,
  type ResendEmailConfirmationRequest,
  ResendEmailConfirmationRequestSchema,
} from '../../domain/dtos/requests/email-confirmation.dto.js';
import {
  type RegisterUserRequest,
  RegisterUserRequestSchema,
} from '../../domain/dtos/requests/register-user.dto.js';
import { ConfirmEmailUseCase } from '../../infra/usecases/confirm-email.usecase.js';
import { RegisterUserUseCase } from '../../infra/usecases/register-user.usecase.js';
import { ResendEmailConfirmationUseCase } from '../../infra/usecases/resend-email-confirmation.usecase.js';

/**
 * Mensagem de quem se cadastra. É a mesma exista a conta ou não: a resposta
 * não pode servir para descobrir quais e-mails estão cadastrados (UC01, 2.2).
 */
export const REGISTRATION_ACCEPTED_MESSAGE =
  'Se o e-mail puder ser cadastrado, enviamos um link de confirmação. Verifique sua caixa de entrada.';

/** Mensagem do reenvio: igualmente idêntica para qualquer e-mail. */
export const CONFIRMATION_RESENT_MESSAGE =
  'Se houver uma conta aguardando confirmação para este e-mail, enviamos um novo link.';

export const EMAIL_CONFIRMED_MESSAGE =
  'E-mail confirmado. Sua conta está ativa.';

@ApiTags('Contas')
@Controller('accounts')
export class AccountsController implements AccountsControllerInterface {
  constructor(
    private readonly registerUserUseCase: RegisterUserUseCase,
    private readonly confirmEmailUseCase: ConfirmEmailUseCase,
    private readonly resendEmailConfirmationUseCase: ResendEmailConfirmationUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Cadastra uma conta e envia o link de confirmação por e-mail',
    description:
      'A conta nasce inativa e só entra em uso depois da confirmação. A resposta é a mesma para um e-mail novo e para um já cadastrado.',
  })
  @ResponseSchema(AccountMessageResponseSchema, {
    status: HttpStatus.ACCEPTED,
    description: 'Pedido de cadastro recebido',
  })
  @ErrorResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.TOO_MANY_REQUESTS)
  async register(
    @Body({ schema: RegisterUserRequestSchema }) body: RegisterUserRequest,
  ): Promise<AccountMessageResponse> {
    await this.registerUserUseCase.execute(body);

    return { message: REGISTRATION_ACCEPTED_MESSAGE };
  }

  @Post('confirm-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirma o e-mail e ativa a conta a partir do token do link',
  })
  @ResponseSchema(AccountMessageResponseSchema, {
    description: 'Conta ativada',
  })
  @ErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  async confirmEmail(
    @Body({ schema: ConfirmEmailRequestSchema }) body: ConfirmEmailRequest,
  ): Promise<AccountMessageResponse> {
    await this.confirmEmailUseCase.execute(body);

    return { message: EMAIL_CONFIRMED_MESSAGE };
  }

  @Post('resend-confirmation')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Pede um novo link de confirmação para uma conta ainda inativa',
    description:
      'O link anterior deixa de valer. A resposta é a mesma para qualquer e-mail.',
  })
  @ResponseSchema(AccountMessageResponseSchema, {
    status: HttpStatus.ACCEPTED,
    description: 'Pedido de reenvio recebido',
  })
  @ErrorResponses(HttpStatus.UNPROCESSABLE_ENTITY, HttpStatus.TOO_MANY_REQUESTS)
  async resendEmailConfirmation(
    @Body({ schema: ResendEmailConfirmationRequestSchema })
    body: ResendEmailConfirmationRequest,
  ): Promise<AccountMessageResponse> {
    await this.resendEmailConfirmationUseCase.execute(body);

    return { message: CONFIRMATION_RESENT_MESSAGE };
  }
}
