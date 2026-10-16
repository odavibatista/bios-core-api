import { SourceOutcome } from './dtos/providers/data-source-request.dto.js';
import { toLookupResult } from './data-source.interface.js';

describe('toLookupResult', () => {
  /** Lê um objeto com `razao_social`; `null` para qualquer outro formato. */
  const parseName = (body: unknown): string | null =>
    typeof body === 'object' &&
    body !== null &&
    'razao_social' in body &&
    typeof body.razao_social === 'string'
      ? body.razao_social
      : null;

  it('devolve o dado convertido quando a fonte respondeu no formato esperado', () => {
    expect(
      toLookupResult(
        {
          outcome: SourceOutcome.SUCCESS,
          status: 200,
          body: { razao_social: 'ACME LTDA' },
        },
        parseName,
      ),
    ).toEqual({ status: 'FOUND', data: 'ACME LTDA' });
  });

  it('trata corpo fora do formato como fonte indisponível, nunca como dado', () => {
    expect(
      toLookupResult(
        { outcome: SourceOutcome.SUCCESS, status: 200, body: { outro: 1 } },
        parseName,
      ),
    ).toEqual({
      status: 'UNAVAILABLE',
      reason: SourceOutcome.FAILURE,
      message: 'resposta fora do formato esperado',
    });
  });

  it('a ausência de registro é uma resposta válida, não indisponibilidade', () => {
    expect(
      toLookupResult(
        { outcome: SourceOutcome.NOT_FOUND, status: 404 },
        parseName,
      ),
    ).toEqual({ status: 'NOT_FOUND' });
  });

  it('fonte desabilitada fica indisponível, sem mensagem', () => {
    expect(
      toLookupResult({ outcome: SourceOutcome.DISABLED }, parseName),
    ).toEqual({ status: 'UNAVAILABLE', reason: SourceOutcome.DISABLED });
  });

  it.each([
    SourceOutcome.FAILURE,
    SourceOutcome.TIMEOUT,
    SourceOutcome.RATE_LIMITED,
  ] as const)('repassa o motivo e a mensagem de %s', (outcome) => {
    expect(toLookupResult({ outcome, message: 'detalhe' }, parseName)).toEqual({
      status: 'UNAVAILABLE',
      reason: outcome,
      message: 'detalhe',
    });
  });

  it('não chama o conversor quando não há corpo a converter', () => {
    const parse = vi.fn();

    toLookupResult({ outcome: SourceOutcome.NOT_FOUND, status: 404 }, parse);
    toLookupResult({ outcome: SourceOutcome.TIMEOUT, message: 'x' }, parse);

    expect(parse).not.toHaveBeenCalled();
  });
});
