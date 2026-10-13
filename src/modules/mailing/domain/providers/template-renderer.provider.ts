import type { EmailTemplate } from '@prisma/client';
import type {
  EmailTemplateContexts,
  RenderedEmail,
} from '../dtos/providers/email-template.dto.js';

/**
 * Contrato de renderização dos e-mails transacionais (RF18).
 *
 * O contexto é verificado contra o template escolhido: pedir
 * `SUSPICIOUS_LOGIN_ALERT` com os dados de um link de confirmação não compila.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class TemplateRendererProvider {
  abstract render<T extends EmailTemplate>(
    template: T,
    context: EmailTemplateContexts[T],
  ): Promise<RenderedEmail>;
}
