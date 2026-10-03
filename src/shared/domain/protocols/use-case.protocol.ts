/**
 * Contrato base de todo caso de uso do BIOS.
 *
 * Cada caso de uso concentra uma única regra de negócio, recebe uma entrada
 * tipada e devolve uma saída tipada. Os parâmetros genéricos tornam o contrato
 * verificável em tempo de compilação, sem `any`.
 *
 * Casos de uso dependem de contratos (classes abstratas de repositório e de
 * provider), nunca de implementações concretas de infraestrutura.
 *
 * @typeParam TInput  - entrada do caso de uso (`void` quando não há entrada).
 * @typeParam TOutput - saída do caso de uso (`void` quando não há retorno).
 */
export abstract class UseCase<TInput = void, TOutput = void> {
  abstract execute(input: TInput): Promise<TOutput>;
}
