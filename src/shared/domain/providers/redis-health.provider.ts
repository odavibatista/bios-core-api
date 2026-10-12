/**
 * Contrato de verificação de disponibilidade do Redis.
 *
 * Separado de `DatabaseHealthProvider` porque são dependências distintas: a API
 * sobe com uma fora do ar e o health check aponta qual delas falhou.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class RedisHealthProvider {
  abstract isAvailable(): Promise<boolean>;
}
