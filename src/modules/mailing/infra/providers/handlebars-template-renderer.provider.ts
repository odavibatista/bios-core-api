import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailTemplate } from '@prisma/client';
import type { Environment } from '@shared/config/environment.config.js';
import Handlebars from 'handlebars';
import {
  EMAIL_TEMPLATE_PATHS,
  EMAIL_TEMPLATE_SUBJECTS,
  type EmailTemplateContexts,
  type RenderedEmail,
} from '../../domain/dtos/providers/email-template.dto.js';
import { TemplateRendererProvider } from '../../domain/providers/template-renderer.provider.js';

/** Nome do arquivo de cada template, sem a extensão. */
const TEMPLATE_FILES: Readonly<Record<EmailTemplate, string>> = {
  [EmailTemplate.EMAIL_CONFIRMATION]: 'email-confirmation',
  [EmailTemplate.EMAIL_CHANGE_CONFIRMATION]: 'email-change-confirmation',
  [EmailTemplate.PASSWORD_RESET]: 'password-reset',
  [EmailTemplate.SUSPICIOUS_LOGIN_ALERT]: 'suspicious-login-alert',
};

/** Moldura HTML comum a todas as mensagens. */
const LAYOUT_FILE = 'layout.html';

/**
 * Diretório dos templates, ao lado do módulo.
 *
 * Resolvido a partir do próprio arquivo, e não do diretório de trabalho: em
 * produção o código roda de `dist/`, e os `.hbs` são copiados para lá pelo
 * `nest build` (ver `nest-cli.json`).
 */
const TEMPLATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'templates',
);

/** Data e hora em pt-BR, no fuso de Brasília. */
const DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

/**
 * Renderização dos e-mails transacionais com Handlebars (RF18).
 *
 * Cada template tem duas formas: HTML, embrulhado na moldura comum, e texto
 * simples — que atende leitores sem HTML e melhora a entrega, porque mensagem
 * só-HTML é sinal de spam para boa parte dos filtros.
 *
 * Os arquivos são lidos do disco na primeira renderização e ficam compilados em
 * memória: ler e compilar a cada envio seria custo repetido à toa.
 *
 * As variáveis entram por `{{ }}`, que escapa o valor. Só o corpo já renderizado
 * entra na moldura por `{{{ }}}`, e ele é produto do próprio Handlebars.
 */
@Injectable()
export class HandlebarsTemplateRendererProvider extends TemplateRendererProvider {
  private readonly compiled = new Map<
    string,
    Handlebars.TemplateDelegate<Record<string, unknown>>
  >();
  private readonly frontendUrl: string;

  constructor(configService: ConfigService<Environment, true>) {
    super();
    this.frontendUrl = configService
      .get('FRONTEND_URL', { infer: true })
      .replace(/\/+$/, '');
  }

  override async render<T extends EmailTemplate>(
    template: T,
    context: EmailTemplateContexts[T],
  ): Promise<RenderedEmail> {
    const subject = EMAIL_TEMPLATE_SUBJECTS[template];
    const values = this.toTemplateValues(template, context);
    const file = TEMPLATE_FILES[template];
    const [body, text] = await Promise.all([
      this.apply(`${file}.html`, values),
      this.apply(`${file}.text`, values),
    ]);
    const html = await this.apply(LAYOUT_FILE, { subject, body });

    return { subject, html, text };
  }

  /**
   * Traduz o contexto do template nos valores que os arquivos esperam: o link
   * completo no lugar do token, e a data já formatada em pt-BR.
   */
  private toTemplateValues<T extends EmailTemplate>(
    template: T,
    context: EmailTemplateContexts[T],
  ): Record<string, unknown> {
    const values: Record<string, unknown> = { ...context };
    const path = EMAIL_TEMPLATE_PATHS[template];

    if (path && typeof values.token === 'string') {
      // O token sai do contexto: o que o template mostra é o link.
      values.link = `${this.frontendUrl}/${path}/${values.token}`;
      delete values.token;
    }

    if (values.occurredAt instanceof Date) {
      values.occurredAt = DATE_FORMAT.format(values.occurredAt);
    }

    return values;
  }

  private async apply(
    file: string,
    values: Record<string, unknown>,
  ): Promise<string> {
    const template = this.compiled.get(file) ?? (await this.compile(file));

    return template(values);
  }

  private async compile(
    file: string,
  ): Promise<Handlebars.TemplateDelegate<Record<string, unknown>>> {
    const source = await readFile(join(TEMPLATES_DIR, `${file}.hbs`), 'utf8');
    const template = Handlebars.compile<Record<string, unknown>>(source);
    this.compiled.set(file, template);

    return template;
  }
}
