import {
  cguRowFactory,
  otherCguCnpj,
} from '@test/factories/cgu/cgu-sanction.factory.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { readCguDate, readCguPage, toCguEvidence } from './cgu-sanction.js';

describe('normalização CGU', () => {
  it('preserva somente CNPJ, ID, órgão, tipo e datas, inclusive sanção histórica', () => {
    const row = cguRowFactory.build();
    const cnpj = row.sancionado.codigoFormatado;
    const [sanction] = readCguPage([row], cnpj).sanctions;
    expect(sanction).toEqual({
      id: String(row.id),
      cnpj,
      authority: row.orgaoSancionador.nome,
      sanctionType: row.tipoSancao.descricaoResumida,
      startDate: '2020-02-01',
      endDate: '2021-02-01',
      publicationDate: '2020-02-02',
    });
    const raw = JSON.stringify(sanction);
    expect(raw).not.toContain(row.sancionado.nome);
    expect(raw).not.toContain(row.pessoa.cpfFormatado);
    expect(raw).not.toContain(row.informacoesAdicionaisDoOrgaoSancionador);
  });

  it.each(['123.456.789-09', '***.456.789-**', '12345678909'])(
    'descarta pessoa física %s',
    (cpf) => {
      const row = cguRowFactory.build({
        sancionado: { codigoFormatado: cpf, nome: 'Pessoa' },
      });
      expect(readCguPage([row], buildCnpj()).sanctions).toEqual([]);
    },
  );

  it('não mistura outro CNPJ', () => {
    const row = cguRowFactory.build();
    expect(
      readCguPage([row], otherCguCnpj(row.sancionado.codigoFormatado))
        .sanctions,
    ).toEqual([]);
  });

  it('CNPJ alfanumérico não é confundido com CPF pela quantidade de dígitos', () => {
    const cnpj = '12ABC345000188';
    const row = {
      id: 3,
      sancionado: { codigoFormatado: '12.ABC.345/0001-88' },
    };
    expect(readCguPage([row], cnpj).sanctions[0]?.cnpj).toBe(cnpj);
  });

  it('aceita o CNPJ do PessoaDTO quando codigoFormatado está ausente', () => {
    const cnpj = buildCnpj();
    const result = readCguPage(
      [{ id: '9', pessoa: { cnpjFormatado: cnpj } }],
      cnpj,
    );
    expect(result.sanctions[0]).toEqual({
      id: '9',
      cnpj,
      authority: null,
      sanctionType: null,
      startDate: null,
      endDate: null,
      publicationDate: null,
    });
  });

  it('usa descricaoPortal como reserva e publica ID/URL dos dois cadastros', () => {
    const cnpj = buildCnpj();
    const [s] = readCguPage(
      [
        {
          id: 9,
          sancionado: { codigoFormatado: cnpj },
          tipoSancao: { descricaoPortal: 'Advertência' },
        },
      ],
      cnpj,
    ).sanctions;
    expect(s.sanctionType).toBe('Advertência');
    for (const slug of ['CGU_CEIS', 'CGU_CNEP'] as const) {
      expect(toCguEvidence(s, slug)).toMatchObject({
        cnpj,
        raw: s,
        finding: {
          reference: '9',
          publishedAt: null,
          url: `https://api.portaldatransparencia.gov.br/api-de-dados/${slug === 'CGU_CEIS' ? 'ceis' : 'cnep'}/9`,
        },
      });
    }
  });

  it('converte publicação para UTC sem interpretar a data final como validade da coleta', () => {
    const row = cguRowFactory.build();
    const [s] = readCguPage([row], row.sancionado.codigoFormatado).sanctions;
    expect(toCguEvidence(s, 'CGU_CEIS').finding.publishedAt).toEqual(
      new Date('2020-02-02T00:00:00Z'),
    );
  });

  it.each([
    {},
    { id: 1 },
    { id: 1, sancionado: { codigoFormatado: 'inválido' } },
  ])('recusa documento ausente/inválido %#', (row) => {
    expect(() => readCguPage([row], buildCnpj())).toThrow();
  });

  it('recusa documentos divergentes', () => {
    const row = cguRowFactory.build();
    expect(() =>
      readCguPage(
        [
          {
            ...row,
            pessoa: {
              cnpjFormatado: otherCguCnpj(row.sancionado.codigoFormatado),
            },
          },
        ],
        row.sancionado.codigoFormatado,
      ),
    ).toThrow(/divergentes/);
  });

  it.each([null, undefined, '', '  ', 'Sem informação'])(
    'aceita data ausente %#',
    (value) => expect(readCguDate(value)).toBeNull(),
  );
  it.each(['31/02/2024', '2024-13-01', 'lixo'])(
    'recusa data impossível %s',
    (value) => expect(() => readCguDate(value)).toThrow(),
  );
  it('aceita data ISO e ano bissexto', () =>
    expect(readCguDate('2024-02-29')).toBe('2024-02-29'));
});
