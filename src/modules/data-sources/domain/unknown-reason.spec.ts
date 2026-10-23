import { SourceOutcome } from './dtos/providers/data-source-request.dto.js';
import { UnknownReason, unknownReasonOf } from './unknown-reason.js';

describe('unknownReasonOf', () => {
  it.each([
    [{ outcome: SourceOutcome.DISABLED }, UnknownReason.SOURCE_DISABLED],
    [{ outcome: SourceOutcome.TIMEOUT, message: 'x' }, UnknownReason.TIMEOUT],
    [
      { outcome: SourceOutcome.RATE_LIMITED, status: 429, message: 'x' },
      UnknownReason.RATE_LIMITED,
    ],
    [
      { outcome: SourceOutcome.NOT_FOUND, status: 404 },
      UnknownReason.ENDPOINT_NOT_FOUND,
    ],
    [
      { outcome: SourceOutcome.FAILURE, status: 401, message: 'x' },
      UnknownReason.CREDENTIAL_REJECTED,
    ],
    [
      { outcome: SourceOutcome.FAILURE, status: 403, message: 'x' },
      UnknownReason.CREDENTIAL_REJECTED,
    ],
    [
      { outcome: SourceOutcome.FAILURE, status: 500, message: 'x' },
      UnknownReason.SOURCE_ERROR,
    ],
    [
      { outcome: SourceOutcome.FAILURE, message: 'conexão recusada' },
      UnknownReason.SOURCE_ERROR,
    ],
  ] as const)('classifica %j como %s', (response, reason) => {
    expect(unknownReasonOf(response)).toBe(reason);
  });

  it('mantém o conjunto fechado e sem texto livre', () => {
    for (const [key, value] of Object.entries(UnknownReason)) {
      expect(value).toBe(key);
      expect(key).toMatch(/^[A-Z_]+$/);
    }
  });
});
