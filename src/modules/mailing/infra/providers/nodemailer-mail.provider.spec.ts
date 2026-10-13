import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createTransport, type Transporter } from 'nodemailer';
import { mailDispatchRequestFactory } from '@test/factories/mailing/email-dispatch.factory.js';
import { faker } from '@test/support/faker.js';
import {
  MAIL_TRANSPORT,
  NodemailerMailProvider,
} from './nodemailer-mail.provider.js';

/** Remetente único da aplicação. */
const MAIL_FROM = 'BIOS <nao-responda@bios.test>';

/**
 * Transporte `jsonTransport` do próprio Nodemailer: monta a mensagem de
 * verdade, mas devolve o resultado como JSON em vez de abrir conexão SMTP.
 */
function jsonTransport(): Transporter {
  return createTransport({ jsonTransport: true });
}

function createProvider(
  transport: Transporter,
): Promise<NodemailerMailProvider> {
  return Test.createTestingModule({
    providers: [
      NodemailerMailProvider,
      { provide: MAIL_TRANSPORT, useValue: transport },
      { provide: ConfigService, useValue: { get: () => MAIL_FROM } },
    ],
  })
    .compile()
    .then((moduleRef) => moduleRef.get(NodemailerMailProvider));
}

describe('NodemailerMailProvider', () => {
  it('entrega a mensagem ao transporte, com o remetente da configuração', async () => {
    const transport = jsonTransport();
    const sendMail = vi.spyOn(transport, 'sendMail');
    const { to, subject, html, text } = mailDispatchRequestFactory.build();

    await (await createProvider(transport)).send({ to, subject, html, text });

    expect(sendMail).toHaveBeenCalledWith({
      from: MAIL_FROM,
      to,
      subject,
      html,
      text,
    });
  });

  it('monta uma mensagem que o Nodemailer aceita', async () => {
    const { to, subject, html, text } = mailDispatchRequestFactory.build();

    // Sem dublê: é o transporte real que valida endereço, assunto e corpo.
    await expect(
      (await createProvider(jsonTransport())).send({ to, subject, html, text }),
    ).resolves.toBeUndefined();
  });

  it('propaga a falha de envio, para a fila decidir o reenvio', async () => {
    const transport = jsonTransport();
    const failure = new Error(faker.lorem.sentence());
    vi.spyOn(transport, 'sendMail').mockRejectedValue(failure);
    const { to, subject, html, text } = mailDispatchRequestFactory.build();

    await expect(
      (await createProvider(transport)).send({ to, subject, html, text }),
    ).rejects.toBe(failure);
  });
});
