import { CNAE_DIVISIONS, cnaeDivisionDescription } from './cnae-divisions.js';

describe('divisões da CNAE 2.3', () => {
  it('são as 87 divisões oficiais, cada uma com 2 dígitos', () => {
    expect(CNAE_DIVISIONS.size).toBe(87);

    for (const division of CNAE_DIVISIONS.keys()) {
      expect(division).toMatch(/^\d{2}$/);
    }
  });

  it('vão da 01 à 99, em ordem crescente', () => {
    const divisions = [...CNAE_DIVISIONS.keys()];

    expect(divisions[0]).toBe('01');
    expect(divisions.at(-1)).toBe('99');
    expect(divisions).toEqual([...divisions].sort());
  });

  it('as descrições não têm espaço sobrando', () => {
    for (const description of CNAE_DIVISIONS.values()) {
      expect(description).toBe(description.replace(/\s+/g, ' ').trim());
      expect(description).not.toBe('');
    }
  });

  it('devolve a descrição oficial da divisão', () => {
    expect(cnaeDivisionDescription('62')).toBe(
      'ATIVIDADES DOS SERVIÇOS DE TECNOLOGIA DA INFORMAÇÃO',
    );
    expect(cnaeDivisionDescription('25')).toBe(
      'FABRICAÇÃO DE PRODUTOS DE METAL, EXCETO MÁQUINAS E EQUIPAMENTOS',
    );
  });

  it.each(['00', '04', '34', '98', '6', '620'])(
    'divisão que não existe (%j): undefined',
    (division) => {
      expect(cnaeDivisionDescription(division)).toBeUndefined();
    },
  );
});
