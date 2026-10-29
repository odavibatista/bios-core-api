import { base, Faker, pt_BR } from '@faker-js/faker';
import { cnpjWithCheckDigits } from '@shared/domain/value-objects/cnpj.js';
import type { DecoyCompany } from './dtos/requests/decoy-company.dto.js';

/**
 * Atividades plausíveis para as empresas sintéticas: códigos e descrições oficiais da
 * CNAE (IBGE), que são públicos e não identificam empresa alguma.
 */
const CNAES = [
  [
    '4711302',
    'Comércio varejista de mercadorias em geral, com predominância de produtos alimentícios - supermercados',
  ],
  ['6201501', 'Desenvolvimento de programas de computador sob encomenda'],
  ['4120400', 'Construção de edifícios'],
  [
    '4930202',
    'Transporte rodoviário de carga, exceto produtos perigosos e mudanças, intermunicipal, interestadual e internacional',
  ],
  ['1091101', 'Fabricação de produtos de panificação industrial'],
  ['0115600', 'Cultivo de soja'],
  ['3511501', 'Geração de energia elétrica'],
  ['8630503', 'Atividade médica ambulatorial restrita a consultas'],
  ['5611201', 'Restaurantes e similares'],
  [
    '2330301',
    'Fabricação de estruturas pré-moldadas de concreto armado, em série e sob encomenda',
  ],
] as const;

const LEGAL_SUFFIXES = ['LTDA', 'S.A.', 'EIRELI', 'LTDA ME'] as const;
const COMPANY_SIZES = [
  'MICRO EMPRESA',
  'EMPRESA DE PEQUENO PORTE',
  'DEMAIS',
] as const;

/** Total de "empresas" que a listagem isca diz ter: grande o bastante para parecer real. */
const DECOY_TOTAL = 48_731;

/** Semente estável de um texto (FNV-1a de 32 bits). */
function seedOf(text: string): number {
  let hash = 0x811c9dc5;

  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash;
}

/**
 * Gera empresas sintéticas plausíveis para os endpoints isca (RF21, #88): razão social,
 * CNPJ válido, CNAE, UF, município e índices, pelo Faker em pt-BR.
 *
 * **Nunca lê dado real** (NFSE07): nada vem do banco nem das fontes. A geração é
 * determinística pela semente: o mesmo CNPJ ou a mesma página devolvem sempre o mesmo
 * conteúdo, como uma base de verdade faria. Tem a própria instância do Faker, para que a
 * semente de uma isca não interfira em nenhum outro uso.
 */
export class DecoyCompanyGenerator {
  private readonly faker = new Faker({ locale: [pt_BR, base] });

  /** A empresa de um CNPJ: sempre a mesma para o mesmo CNPJ. */
  company(cnpj: string): DecoyCompany {
    this.faker.seed(seedOf(cnpj));

    return this.build(cnpj);
  }

  /** Uma página da listagem: sempre a mesma para o mesmo número e tamanho. */
  page(
    page: number,
    pageSize: number,
  ): { items: DecoyCompany[]; total: number } {
    const offset = (page - 1) * pageSize;
    const count = Math.max(0, Math.min(pageSize, DECOY_TOTAL - offset));
    const items = Array.from({ length: count }, (_, index) => {
      this.faker.seed(offset + index + 1);

      return this.build(
        cnpjWithCheckDigits(`${this.faker.string.numeric(8)}0001`),
      );
    });

    return { items, total: DECOY_TOTAL };
  }

  private build(cnpj: string): DecoyCompany {
    const { faker } = this;
    const name = faker.company.name().toUpperCase();
    const [code, description] = faker.helpers.arrayElement(CNAES);

    return {
      cnpj,
      legal_name: `${name} ${faker.helpers.arrayElement(LEGAL_SUFFIXES)}`,
      trade_name: faker.datatype.boolean({ probability: 0.7 })
        ? faker.company.name()
        : null,
      registration_status: faker.helpers.weightedArrayElement([
        { weight: 9, value: 'ATIVA' },
        { weight: 1, value: 'BAIXADA' },
      ]),
      company_size: faker.helpers.arrayElement(COMPANY_SIZES),
      address: {
        city: faker.location.city(),
        uf: faker.location.state({ abbreviated: true }),
        zipcode: faker.string.numeric(8),
      },
      main_cnae: { code, description },
      ods_scores: [13, 15].map((ods_number) => ({
        ods_number,
        score_value: faker.number.int({ min: -80, max: 60 }),
        confidence_value: faker.number.float({
          min: 0.1,
          max: 0.95,
          fractionDigits: 2,
        }),
      })),
    };
  }
}
