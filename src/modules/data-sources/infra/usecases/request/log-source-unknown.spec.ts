import { Logger } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import { faker } from '@test/support/faker.js';
import { UnknownReason } from '../../../domain/unknown-reason.js';
import { logSourceUnknown } from './log-source-unknown.js';

describe('logSourceUnknown', () => {
  const logger = new Logger('teste');
  let warn: MockInstance<Logger['warn']>;
  let error: MockInstance<Logger['error']>;

  // restoreMocks desfaz os espiões a cada teste: eles são recriados aqui.
  beforeEach(() => {
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  it('registra falha esperada como aviso estruturado, só com fonte e motivo', () => {
    logSourceUnknown(logger, 'CGU_CEIS', UnknownReason.RATE_LIMITED);

    expect(warn).toHaveBeenCalledWith({
      event: 'source_unknown',
      source: 'CGU_CEIS',
      reason: 'RATE_LIMITED',
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('mantém o erro de programa visível: nome e pilha, nunca a mensagem', () => {
    const secret = faker.string.alphanumeric(40);
    const failure = new TypeError(`chave-api-dados: ${secret}`);

    logSourceUnknown(
      logger,
      'GHG_PROTOCOL',
      UnknownReason.UNEXPECTED_ERROR,
      failure,
    );

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      {
        event: 'source_unknown',
        source: 'GHG_PROTOCOL',
        reason: 'UNEXPECTED_ERROR',
        error: 'TypeError',
      },
      expect.stringContaining('at '),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain(secret);
  });

  it('aceita um valor lançado que não é Error', () => {
    logSourceUnknown(
      logger,
      'CGU_CNEP',
      UnknownReason.UNEXPECTED_ERROR,
      'texto solto',
    );

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'string' }),
      undefined,
    );
  });
});
