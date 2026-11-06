import { toSearchName } from './location-names.js';

describe('toSearchName', () => {
  it.each([
    ['São Paulo', 'SAO PAULO'],
    ["Sant'Ana do Livramento", 'SANT ANA DO LIVRAMENTO'],
    ['Embu-Guaçu', 'EMBU GUACU'],
    ['  Pará   de  Minas ', 'PARA DE MINAS'],
  ])('%s vira %s', (name, expected) => {
    expect(toSearchName(name)).toBe(expected);
  });

  it('texto só de pontuação fica vazio', () => {
    expect(toSearchName('*** --')).toBe('');
  });
});
