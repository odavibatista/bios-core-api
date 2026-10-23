/**
 * Reprova o arquivo de teste e2e em que o Node avisar de vazamento de ouvintes
 * (`MaxListenersExceededWarning`), em vez de deixar o aviso se perder no meio da saída (#259).
 *
 * O aviso quase sempre indica um defeito real: ouvintes que se acumulam num mesmo
 * emissor (um servidor sem `listen` prévio sob requisições simultâneas, um cliente
 * que não é fechado). A causa se corrige; `setMaxListeners` não é a resposta.
 */
const leaks: string[] = [];

process.on('warning', (warning) => {
  if (warning.name === 'MaxListenersExceededWarning') {
    leaks.push(warning.message);
  }
});

afterAll(() => {
  expect(
    leaks,
    'MaxListenersExceededWarning: há ouvintes se acumulando num emissor; corrija a causa, não o limite.',
  ).toEqual([]);
});
