import { Test } from '@nestjs/testing';
import { EmailTemplate } from '@prisma/client';
import {
  buildObjectId,
  mailDispatchRequestFactory,
} from '@test/factories/mailing/email-dispatch.factory.js';
import { buildTokenContext } from '@test/factories/mailing/email-template.factory.js';
import { faker } from '@test/support/faker.js';
import type { RenderedEmail } from '../../domain/dtos/providers/email-template.dto.js';
import { TemplateRendererProvider } from '../../domain/providers/template-renderer.provider.js';
import { DispatchEmailUseCase } from './dispatch-email.usecase.js';
import { SendTransactionalEmailUseCase } from './send-transactional-email.usecase.js';

describe('SendTransactionalEmailUseCase', () => {
  const templateRendererProvider = {
    render: vi.fn<() => Promise<RenderedEmail>>(),
  };
  const dispatchEmailUseCase = { execute: vi.fn<() => Promise<string>>() };
  let useCase: SendTransactionalEmailUseCase;

  /** Mensagem renderizada, nas duas formas. */
  function rendered(): RenderedEmail {
    const { subject, html, text } = mailDispatchRequestFactory.build();

    return { subject, html, text };
  }

  beforeEach(async () => {
    templateRendererProvider.render.mockResolvedValue(rendered());
    dispatchEmailUseCase.execute.mockResolvedValue(buildObjectId());

    const moduleRef = await Test.createTestingModule({
      providers: [
        SendTransactionalEmailUseCase,
        {
          provide: TemplateRendererProvider,
          useValue: templateRendererProvider,
        },
        { provide: DispatchEmailUseCase, useValue: dispatchEmailUseCase },
      ],
    }).compile();

    useCase = moduleRef.get(SendTransactionalEmailUseCase);
  });

  it('renderiza o template pedido e enfileira a mensagem pronta', async () => {
    const message = rendered();
    templateRendererProvider.render.mockResolvedValue(message);
    const to = faker.internet.email();
    const context = buildTokenContext();
    const userId = buildObjectId();

    await useCase.execute({
      template: EmailTemplate.EMAIL_CONFIRMATION,
      to,
      context,
      userId,
    });

    expect(templateRendererProvider.render).toHaveBeenCalledWith(
      EmailTemplate.EMAIL_CONFIRMATION,
      context,
    );
    expect(dispatchEmailUseCase.execute).toHaveBeenCalledWith({
      template: EmailTemplate.EMAIL_CONFIRMATION,
      to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      userId,
    });
  });

  it('devolve o identificador da auditoria', async () => {
    const dispatchLogId = buildObjectId();
    dispatchEmailUseCase.execute.mockResolvedValue(dispatchLogId);

    await expect(
      useCase.execute({
        template: EmailTemplate.PASSWORD_RESET,
        to: faker.internet.email(),
        context: buildTokenContext(),
      }),
    ).resolves.toBe(dispatchLogId);
  });

  it('renderiza antes de enfileirar, para o job levar a mensagem pronta', async () => {
    const order: string[] = [];
    templateRendererProvider.render.mockImplementation(() => {
      order.push('render');
      return Promise.resolve(rendered());
    });
    dispatchEmailUseCase.execute.mockImplementation(() => {
      order.push('enqueue');
      return Promise.resolve(buildObjectId());
    });

    await useCase.execute({
      template: EmailTemplate.EMAIL_CHANGE_CONFIRMATION,
      to: faker.internet.email(),
      context: buildTokenContext(),
    });

    // Mudar um template não altera e-mail que já está na fila.
    expect(order).toEqual(['render', 'enqueue']);
  });

  it('não enfileira quando a renderização falha', async () => {
    templateRendererProvider.render.mockRejectedValue(
      new Error(faker.lorem.sentence()),
    );

    await expect(
      useCase.execute({
        template: EmailTemplate.EMAIL_CONFIRMATION,
        to: faker.internet.email(),
        context: buildTokenContext(),
      }),
    ).rejects.toThrow();

    expect(dispatchEmailUseCase.execute).not.toHaveBeenCalled();
  });
});
