/**
 * O cálculo não pode rodar porque o ambiente não está configurado para ele: não há
 * ODS ativo ou um ODS ativo não tem regras de pontuação.
 *
 * É defeito de configuração, e não falha passageira: repetir o job não ajuda, então o
 * consumidor a trata como irrecuperável (sem as tentativas de repetição da fila).
 */
export class ScoringNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoringNotConfiguredError';
  }
}
