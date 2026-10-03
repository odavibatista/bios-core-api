import { Module } from '@nestjs/common';
import { SharedModule } from '@shared/infra/modules/shared.module.js';
import { IdentityAndAccessModule } from './domains/identity-and-access.module.js';
import { SustainabilityIntelligenceModule } from './domains/sustainability-intelligence.module.js';

/**
 * Módulo raiz.
 *
 * Importa apenas a infraestrutura compartilhada e os módulos agregadores de
 * domínio — nunca os módulos de negócio diretamente —, para que a raiz não
 * cresça como uma lista plana de dezenas de módulos.
 */
@Module({
  imports: [
    SharedModule,
    IdentityAndAccessModule,
    SustainabilityIntelligenceModule,
  ],
})
export class AppModule {}
