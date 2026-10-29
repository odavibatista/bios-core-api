import {
  cnaeDivisionOf,
  monthlyWindow,
  withMinimumSample,
} from './sector-evolution.js';

describe('evolução setorial: regras (#89, #90)', () => {
  describe('monthlyWindow', () => {
    it.each([
      [
        '2026-10-28T15:30:00Z',
        '2026-10-01T00:00:00.000Z',
        '2026-11-01T00:00:00.000Z',
      ],
      [
        '2026-10-01T00:00:00Z',
        '2026-10-01T00:00:00.000Z',
        '2026-11-01T00:00:00.000Z',
      ],
      [
        '2026-10-31T23:59:59.999Z',
        '2026-10-01T00:00:00.000Z',
        '2026-11-01T00:00:00.000Z',
      ],
      [
        '2026-12-15T12:00:00Z',
        '2026-12-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
      ],
      [
        '2028-02-29T12:00:00Z',
        '2028-02-01T00:00:00.000Z',
        '2028-03-01T00:00:00.000Z',
      ],
    ])('%s cai na janela [%s, %s)', (instant, start, end) => {
      const window = monthlyWindow(new Date(instant));

      expect(window.start.toISOString()).toBe(start);
      expect(window.end.toISOString()).toBe(end);
    });
  });

  describe('cnaeDivisionOf', () => {
    it.each([
      ['62', '62'],
      ['620', '62'],
      ['62015', '62'],
      ['6201501', '62'],
      ['6201-5/01', '62'],
      ['62.01-5', '62'],
      [' 01 ', '01'],
    ])('%j → divisão %s', (code, division) => {
      expect(cnaeDivisionOf(code)).toBe(division);
    });

    it.each(['', '6', '6201', '620150', '62015011', 'ab', '00', '0000000'])(
      'recusa %j',
      (code) => {
        expect(cnaeDivisionOf(code)).toBeNull();
      },
    );
  });

  describe('withMinimumSample (IA05)', () => {
    const totals = {
      companyCount: 6,
      scoredCompanyCount: 4,
      averageScore: -12.5,
      averageConfidence: 0.6,
    };

    it('com amostra suficiente, mantém as médias', () => {
      expect(withMinimumSample(totals, 4)).toEqual(totals);
    });

    it('poucas empresas com índice: omite só o índice médio', () => {
      expect(withMinimumSample(totals, 5)).toEqual({
        ...totals,
        averageScore: null,
      });
    });

    it('poucas empresas no setor: omite as duas médias, e mantém as contagens', () => {
      expect(withMinimumSample(totals, 7)).toEqual({
        companyCount: 6,
        scoredCompanyCount: 4,
        averageScore: null,
        averageConfidence: null,
      });
    });

    it('com uma empresa e mínimo 1, a média é a dela (o mínimo é o que protege)', () => {
      const single = {
        companyCount: 1,
        scoredCompanyCount: 1,
        averageScore: 10,
        averageConfidence: 0.5,
      };

      expect(withMinimumSample(single, 1)).toEqual(single);
      expect(withMinimumSample(single, 2)).toMatchObject({
        averageScore: null,
        averageConfidence: null,
      });
    });
  });
});
