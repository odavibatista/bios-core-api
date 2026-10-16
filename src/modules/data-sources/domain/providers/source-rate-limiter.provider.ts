/**
 * Contrato do limite de requisições às fontes externas (NFPD01).
 *
 * É o BIOS limitando a si mesmo, para respeitar o teto que cada fonte
 * declara — o oposto do throttler da API, que limita quem chama o BIOS.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class SourceRateLimiter {
  /**
   * Tenta reservar uma chamada à fonte dentro do teto por minuto.
   *
   * Devolve `false` quando o teto da janela móvel de um minuto já foi atingido
   * por todas as instâncias juntas: a chamada não deve ser feita.
   *
   * @throws quando o contador está indisponível. Quem chama não faz a chamada:
   * errar para o lado de não consultar protege a fonte de um bloqueio por
   * excesso.
   */
  abstract tryAcquire(slug: string, limitPerMinute: number): Promise<boolean>;
}
