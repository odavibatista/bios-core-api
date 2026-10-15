import { faker } from '@test/support/faker.js';
import { truncateUserAgent, USER_AGENT_MAX_LENGTH } from './user-agent.js';

describe('truncateUserAgent', () => {
  it('mantém o user-agent que cabe no limite', () => {
    const userAgent = faker.internet.userAgent();

    expect(truncateUserAgent(userAgent)).toBe(userAgent);
  });

  it('corta o que passa do limite', () => {
    const truncated = truncateUserAgent('x'.repeat(USER_AGENT_MAX_LENGTH + 1));

    expect(truncated).toHaveLength(USER_AGENT_MAX_LENGTH);
  });

  it('aceita o user-agent exatamente no limite', () => {
    const userAgent = 'x'.repeat(USER_AGENT_MAX_LENGTH);

    expect(truncateUserAgent(userAgent)).toBe(userAgent);
  });

  it('devolve undefined quando o cabeçalho não veio', () => {
    expect(truncateUserAgent(undefined)).toBeUndefined();
  });
});
