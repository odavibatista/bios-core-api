/**
 * Contrato de verificação de disponibilidade do banco de dados.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção:
 * o caso de uso depende deste contrato, e o módulo de banco decide qual
 * implementação o atende.
 */
export abstract class DatabaseHealthProvider {
  abstract isAvailable(): Promise<boolean>;
}
