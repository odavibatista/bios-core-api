/**
 * Grafias usadas por outras fontes para municípios do IBGE, por código do município.
 *
 * A Receita e os espelhos do CNPJ nem sempre acompanham o nome oficial. Sem estes
 * sinônimos, escolher o município no seletor não alcançaria quem foi cadastrado com a
 * grafia antiga. Levantados contra a base de novembro de 2026; os cinco últimos são nomes
 * que o próprio IBGE já usou.
 */
export const CITY_ALIASES: Readonly<Record<number, readonly string[]>> = {
  1502954: ['ELDORADO DOS CARAJAS'],
  4317103: ['SANTANA DO LIVRAMENTO'],
  3303807: ['PARATI'],
  1506500: ['SANTA ISABEL DO PARA'],
  5107800: ['SANTO ANTONIO DO LEVERGER'],
  4212809: ['BALNEARIO DE PICARRAS'],
  1706001: ['COUTO DE MAGALHAES'],
  1720499: ['SAO VALERIO DA NATIVIDADE'],
  2922250: ['MUQUEM DE SAO FRANCISCO'],
  1708254: ['FORTALEZA DO TABOCAO'],
  2405306: ['BOA SAÚDE'],
  3108909: ['BRASOPOLIS'],
  2928505: ['SANTA TERESINHA'],
  2400208: ['ACU'],
  2401206: ['ARES'],
  1400605: ['SAO LUIZ'],
  2802601: ['GRACHO CARDOSO'],
  3105509: ['BARAO DE MONTE ALTO'],
};
