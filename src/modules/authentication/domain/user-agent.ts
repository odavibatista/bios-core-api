/** User-agent acima disso é truncado: o cabeçalho é livre e não deve inflar o banco. */
export const USER_AGENT_MAX_LENGTH = 512;

/** User-agent no tamanho que se aceita gravar. */
export function truncateUserAgent(
  userAgent: string | undefined,
): string | undefined {
  return userAgent?.slice(0, USER_AGENT_MAX_LENGTH);
}
