import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';
import {
  buildCnpj,
  VALID_CNPJS,
} from '../companies/company-profile.factory.js';

/** Identidade diferente garantida para cenários de isolamento. */
export function otherCguCnpj(cnpj: string): string {
  return faker.helpers.arrayElement(
    VALID_CNPJS.filter((value) => value !== cnpj),
  );
}

/** Resposta sintética da API, inclusive campos pessoais que devem ser descartados. */
export const cguRowFactory = defineFactory(() => ({
  id: faker.number.int({ min: 1, max: 999999999 }),
  sancionado: { codigoFormatado: buildCnpj(), nome: faker.person.fullName() },
  pessoa: { cpfFormatado: '123.456.789-09', nome: faker.person.fullName() },
  orgaoSancionador: { nome: `Órgão ${faker.string.alpha(8)}` },
  tipoSancao: {
    descricaoResumida: 'Suspensão de contratar',
    descricaoPortal: 'Suspensão',
  },
  dataInicioSancao: '01/02/2020',
  dataFimSancao: '01/02/2021',
  dataPublicacaoSancao: '02/02/2020',
  informacoesAdicionaisDoOrgaoSancionador: faker.person.fullName(),
  linkPublicacao: faker.internet.url(),
}));
