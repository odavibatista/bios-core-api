import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
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
import type { AccountsControllerInterface } from '../../domain/dtos/controllers/accounts.controller.dto.js';
import {
  type AccountResponse,
  AccountResponseSchema,
  type ChangeEmailRequest,
  ChangeEmailRequestSchema,
  type DeleteAccountRequest,
  DeleteAccountRequestSchema,
  type UpdateAccountRequest,
  UpdateAccountRequestSchema,
} from '../../domain/dtos/requests/account-management.dto.js';
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
import { ConfirmEmailChangeUseCase } from '../../infra/usecases/confirm-email-change.usecase.js';
import { DeleteOwnAccountUseCase } from '../../infra/usecases/delete-own-account.usecase.js';
import { GetOwnAccountUseCase } from '../../infra/usecases/get-own-account.usecase.js';
import { RegisterUserUseCase } from '../../infra/usecases/register-user.usecase.js';
import { RequestEmailChangeUseCase } from '../../infra/usecases/request-email-change.usecase.js';
import { UpdateOwnAccountUseCase } from '../../infra/usecases/update-own-account.usecase.js';
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

/**
 * Mensagem do pedido de troca de e-mail. É a mesma quando o novo e-mail já é de
 * outra conta: a resposta não pode servir de consulta de contas existentes.
 */
export const EMAIL_CHANGE_REQUESTED_MESSAGE =
  'Se o e-mail puder ser usado, enviamos um link de confirmação para ele. A troca só vale depois que você abrir o link.';

export const EMAIL_CHANGED_MESSAGE = 'E-mail atualizado.';

export const EMAIL_CONFIRMED_MESSAGE =
  'E-mail confirmado. Sua conta está ativa.';

@ApiTags('Contas')
@Controller('accounts')
export class AccountsController implements AccountsControllerInterface {
  constructor(
    private readonly registerUserUseCase: RegisterUserUseCase,
    private readonly confirmEmailUseCase: ConfirmEmailUseCase,
    private readonly resendEmailConfirmationUseCase: ResendEmailConfirmationUseCase,
    private readonly getOwnAccountUseCase: GetOwnAccountUseCase,
    private readonly updateOwnAccountUseCase: UpdateOwnAccountUseCase,
    private readonly requestEmailChangeUseCase: RequestEmailChangeUseCase,
    private readonly confirmEmailChangeUseCase: ConfirmEmailChangeUseCase,
    private readonly deleteOwnAccountUseCase: DeleteOwnAccountUseCase,
  ) {}

  // Pública: o cadastro acontece antes de haver sessão.
  @Public()
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

  // Pública: quem abre o link de confirmação ainda não tem sessão.
  @Public()
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

  // Pública: quem pede novo link não conseguiu confirmar, logo não tem sessão.
  @Public()
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

  @Get('me')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Devolve os dados da própria conta',
    description:
      'E-mail e endereço são decifrados apenas nesta resposta, ao próprio titular.',
  })
  @ResponseSchema(AccountResponseSchema, { description: 'Dados da conta' })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  getOwnAccount(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountResponse> {
    return this.getOwnAccountUseCase.execute(user.userId);
  }

  @Patch('me')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Edita o nome e/ou o endereço da própria conta',
    description:
      'Ao menos um campo é obrigatório; `address: null` remove o endereço. O e-mail tem fluxo próprio, com confirmação.',
  })
  @ResponseSchema(AccountResponseSchema, { description: 'Conta atualizada' })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  updateOwnAccount(
    @Body({ schema: UpdateAccountRequestSchema }) body: UpdateAccountRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountResponse> {
    return this.updateOwnAccountUseCase.execute({
      ...body,
      userId: user.userId,
    });
  }

  @Post('me/email-change')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Pede a troca do e-mail da conta',
    description:
      'Exige a senha atual e envia o link de confirmação ao novo endereço; o e-mail atual vale até o link ser aberto. A resposta é a mesma quando o novo e-mail já pertence a outra conta.',
  })
  @ResponseSchema(AccountMessageResponseSchema, {
    status: HttpStatus.ACCEPTED,
    description: 'Pedido de troca recebido',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  async requestEmailChange(
    @Body({ schema: ChangeEmailRequestSchema }) body: ChangeEmailRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountMessageResponse> {
    await this.requestEmailChangeUseCase.execute({ user, request: body });

    return { message: EMAIL_CHANGE_REQUESTED_MESSAGE };
  }

  // Pública: abrir o link prova o controle do novo e-mail, e a pessoa pode
  // estar sem sessão no dispositivo em que o abre.
  @Public()
  @Post('confirm-email-change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Efetiva a troca de e-mail a partir do token do link',
  })
  @ResponseSchema(AccountMessageResponseSchema, {
    description: 'E-mail atualizado',
  })
  @ErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.CONFLICT,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  async confirmEmailChange(
    @Body({ schema: ConfirmEmailRequestSchema }) body: ConfirmEmailRequest,
  ): Promise<AccountMessageResponse> {
    await this.confirmEmailChangeUseCase.execute(body);

    return { message: EMAIL_CHANGED_MESSAGE };
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Exclui a própria conta',
    description:
      'Confirmada com a senha. Remove a conta, as sessões, as chaves de API e os tokens; as tentativas de login ficam desvinculadas do titular. Não há remoção lógica.',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Conta excluída' })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  async deleteOwnAccount(
    @Body({ schema: DeleteAccountRequestSchema }) body: DeleteAccountRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.deleteOwnAccountUseCase.execute({ user, request: body });
  }
}
