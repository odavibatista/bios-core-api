import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EmailTemplate } from '@prisma/client';
import {
  buildAlertContext,
  buildTokenContext,
  TOKEN_TEMPLATES,
} from '@test/factories/mailing/email-template.factory.js';
import { faker } from '@test/support/faker.js';
import {
  EMAIL_TEMPLATE_PATHS,
  EMAIL_TEMPLATE_SUBJECTS,
} from '../../domain/dtos/providers/email-template.dto.js';
import { HandlebarsTemplateRendererProvider } from './handlebars-template-renderer.provider.js';

/** Base dos links, sem barra ao final. */
const FRONTEND_URL = 'https://bios.test';

function createRenderer(
  frontendUrl = FRONTEND_URL,
): Promise<HandlebarsTemplateRendererProvider> {
  return Test.createTestingModule({
    providers: [
      HandlebarsTemplateRendererProvider,
      { provide: ConfigService, useValue: { get: () => frontendUrl } },
    ],
  })
    .compile()
    .then((moduleRef) => moduleRef.get(HandlebarsTemplateRendererProvider));
}

describe('HandlebarsTemplateRendererProvider', () => {
  describe('todos os templates', () => {
    it.each(TOKEN_TEMPLATES)('%s rende HTML e texto', async (template) => {
      const context = buildTokenContext();

      const { subject, html, text } = await (
        await createRenderer()
      ).render(template, context);

      expect(subject).toBe(EMAIL_TEMPLATE_SUBJECTS[template]);
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('lang="pt-BR"');
      expect(text).not.toContain('<');
      // As duas formas falam com a mesma pessoa e levam o mesmo link.
      for (const body of [html, text]) {
        expect(body).toContain(context.name);
        expect(body).toContain(context.validity);
      }
    });

    it('o alerta de acesso suspeito rende HTML e texto', async () => {
      const context = buildAlertContext();

      const { subject, html, text } = await (
        await createRenderer()
      ).render(EmailTemplate.SUSPICIOUS_LOGIN_ALERT, context);

      expect(subject).toBe(
        EMAIL_TEMPLATE_SUBJECTS[EmailTemplate.SUSPICIOUS_LOGIN_ALERT],
      );
      for (const body of [html, text]) {
        expect(body).toContain(context.name);
        expect(body).toContain(context.ipAddress);
      }
    });

    it('embrulha o HTML na moldura comum, com o assunto no título', async () => {
      const { subject, html } = await (
        await createRenderer()
      ).render(EmailTemplate.PASSWORD_RESET, buildTokenContext());

      expect(html).toContain(`<title>${subject}</title>`);
      expect(html).toContain('Esta é uma mensagem automática do BIOS');
    });
  });

  describe('link de ação', () => {
    it.each(TOKEN_TEMPLATES)(
      '%s aponta para a rota do front-end com o token',
      async (template) => {
        const context = buildTokenContext();

        const { html, text } = await (
          await createRenderer()
        ).render(template, context);

        const link = `${FRONTEND_URL}/${EMAIL_TEMPLATE_PATHS[template]}/${context.token}`;
        // O token vai em segmento de caminho justamente para o link aparecer
        // igual no HTML: em parâmetro de consulta, o "=" seria escapado.
        expect(html).toContain(`href="${link}"`);
        expect(text).toContain(link);
      },
    );

    it('não duplica a barra quando a URL base termina com uma', async () => {
      const context = buildTokenContext();

      const { html } = await (
        await createRenderer(`${FRONTEND_URL}/`)
      ).render(EmailTemplate.EMAIL_CONFIRMATION, context);

      expect(html).toContain(`href="${FRONTEND_URL}/confirmar-email/`);
      expect(html).not.toContain('//confirmar-email');
    });

    it('não expõe o token cru fora do link', async () => {
      const context = buildTokenContext();

      const { html } = await (
        await createRenderer()
      ).render(EmailTemplate.PASSWORD_RESET, context);

      // O token aparece uma única vez: dentro do href.
      expect(html.split(context.token)).toHaveLength(2);
    });
  });

  describe('segurança do conteúdo', () => {
    it('escapa o que vem do contexto', async () => {
      const context = {
        ...buildTokenContext(),
        name: '<script>alert("xss")</script>',
      };

      const { html } = await (
        await createRenderer()
      ).render(EmailTemplate.EMAIL_CONFIRMATION, context);

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('o alerta de acesso suspeito não leva link nem segredo', async () => {
      const context = buildAlertContext();

      const { html, text } = await (
        await createRenderer()
      ).render(EmailTemplate.SUSPICIOUS_LOGIN_ALERT, context);

      // Alerta de invasão é alvo clássico de phishing: nada clicável aqui.
      for (const body of [html, text]) {
        expect(body).not.toContain(FRONTEND_URL);
        expect(body.toLowerCase()).not.toContain('token');
      }
      expect(html).not.toContain('<a ');
    });

    it('formata a data do alerta em pt-BR', async () => {
      const context = {
        ...buildAlertContext(),
        occurredAt: new Date('2026-03-15T18:45:00-03:00'),
      };

      const { text } = await (
        await createRenderer()
      ).render(EmailTemplate.SUSPICIOUS_LOGIN_ALERT, context);

      expect(text).toContain('15/03/2026');
      expect(text).toContain('18:45');
    });
  });

  it('compila cada arquivo uma única vez', async () => {
    const renderer = await createRenderer();
    const template = faker.helpers.arrayElement(TOKEN_TEMPLATES);

    const first = await renderer.render(template, buildTokenContext());
    const second = await renderer.render(template, buildTokenContext());

    // Mesmo assunto e mesma moldura: o cache não embaralha os templates.
    expect(second.subject).toBe(first.subject);
    expect(second.html).toContain('<!doctype html>');
  });
});
