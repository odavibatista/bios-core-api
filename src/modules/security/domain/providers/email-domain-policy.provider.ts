/**
 * Contrato da política de domínios de e-mail (RF22).
 *
 * É por aqui que os outros módulos — cadastro e troca de e-mail — consultam a
 * blacklist: eles dependem deste contrato de domínio, nunca da infraestrutura
 * do módulo de segurança.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class EmailDomainPolicyProvider {
  /**
   * Deixa passar o e-mail cujo domínio não está bloqueado.
   *
   * @throws {BlockedEmailDomainException} quando o domínio está na blacklist.
   */
  abstract execute(email: string): Promise<void>;
}
