import { Module } from '@nestjs/common';
import { AccountsModule } from '@modules/accounts/infra/modules/accounts.module.js';
import { AuthenticationModule } from '@modules/authentication/infra/modules/authentication.module.js';
import { ApiKeysModule } from '@modules/api-keys/infra/modules/api-keys.module.js';
import { SecurityModule } from '@modules/security/infra/modules/security.module.js';
import { HoneypotModule } from '@modules/honeypot/infra/modules/honeypot.module.js';
import { MailingModule } from '@modules/mailing/infra/modules/mailing.module.js';

/**
 * Agregador do domínio de identidade e acesso: contas, autenticação, chaves de
 * API, defesas de borda (com as rotas isca do honeypot) e e-mails transacionais.
 */
@Module({
  imports: [
    AccountsModule,
    AuthenticationModule,
    ApiKeysModule,
    SecurityModule,
    HoneypotModule,
    MailingModule,
  ],
})
export class IdentityAndAccessModule {}
