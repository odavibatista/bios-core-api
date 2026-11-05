import { z } from 'zod';
import {
  cleanText,
  joinStreet,
  normalizeCnaeCode,
  normalizeCompanySize,
  normalizeRegistrationStatus,
  normalizeUf,
  normalizeZipcode,
  type RawValue,
} from '@modules/data-sources/domain/cadastral-normalizers.js';
import type {
  CadastralCnae,
  CadastralRecord,
} from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';

/** Campo que o OpenCNPJ manda como texto, número ou `null`, conforme o registro. */
const field = z.union([z.string(), z.number()]).nullish();

/**
 * Os campos da resposta do OpenCNPJ (`GET /{cnpj}`) que o BIOS usa.
 *
 * Lista de campos permitidos, como no adapter da BrasilAPI: o `z.object`
 * descarta o resto. A resposta traz também o quadro societário (`QSA`), e-mail,
 * telefones e a qualificação do responsável, e nada disso é lido (INL02).
 */
const OpenCnpjSchema = z.object({
  cnpj: z.string(),
  razao_social: field,
  nome_fantasia: field,
  situacao_cadastral: field,
  porte_empresa: field,
  codigo_natureza_juridica: field,
  natureza_juridica: field,
  cnae_principal: field,
  cnaes_secundarios: z.array(field).nullish(),
  cnaes: z.array(z.object({ codigo: field, descricao: field })).nullish(),
  tipo_logradouro: field,
  logradouro: field,
  numero: field,
  complemento: field,
  bairro: field,
  cep: field,
  uf: field,
  municipio: field,
  lgpd_anonimizado: z.boolean().nullish(),
});

/**
 * O provedor anonimizou o registro a pedido (`lgpd_anonimizado`). Vale para os CNPJs da lista
 * dele, e não para todo cadastro de pessoa física.
 */
export function isAnonymizedRecord(body: unknown): boolean {
  const parsed = OpenCnpjSchema.pick({ lgpd_anonimizado: true }).safeParse(
    body,
  );

  return parsed.success && parsed.data.lgpd_anonimizado === true;
}

/** CNPJ da resposta, na forma canônica (sem máscara, em maiúsculas). */
function canonical(cnpj: string): string {
  return cnpj.replace(/[./\-\s]/g, '').toUpperCase();
}

/**
 * Converte a resposta do OpenCNPJ para o cadastro do BIOS, ou `null` quando
 * ela não é utilizável.
 *
 * É `null` quando o corpo não tem o formato esperado, quando faltam os campos
 * sem os quais o perfil não faz sentido e quando o CNPJ da resposta não é o
 * consultado. O registro **anonimizado** chega aqui como `null` também, mas o
 * adapter o reconhece antes por `isAnonymizedRecord` e não segue a cadeia.
 *
 * O OpenCNPJ não informa o código IBGE do município (o `codigo_municipio`
 * dele é o da Receita, outra tabela), então `cityIbgeCode` fica `null`. A
 * descrição dos CNAEs vem da lista `cnaes` quando ela existe; o item
 * `cnaes_secundarios` traz só os códigos.
 */
export function toCadastralRecord(
  body: unknown,
  expectedCnpj: string,
): CadastralRecord | null {
  const parsed = OpenCnpjSchema.safeParse(body);

  if (!parsed.success) return null;

  const raw = parsed.data;
  const legalName = cleanText(raw.razao_social);
  const registrationStatus = normalizeRegistrationStatus(
    raw.situacao_cadastral,
  );
  const mainCode = normalizeCnaeCode(raw.cnae_principal);
  const city = cleanText(raw.municipio);
  const uf = normalizeUf(raw.uf);

  if (
    raw.lgpd_anonimizado === true ||
    canonical(raw.cnpj) !== expectedCnpj ||
    legalName === null ||
    registrationStatus === null ||
    mainCode === null ||
    city === null ||
    uf === null
  ) {
    return null;
  }

  const descriptions = descriptionsByCode(raw.cnaes ?? []);

  return {
    cnpj: expectedCnpj,
    legalName,
    tradeName: cleanText(raw.nome_fantasia),
    registrationStatus: registrationStatus.status,
    registrationStatusUnrecognized: registrationStatus.unrecognized,
    companySize: normalizeCompanySize(raw.porte_empresa),
    legalNatureCode: cleanText(raw.codigo_natureza_juridica),
    legalNature: cleanText(raw.natureza_juridica),
    address: {
      street: joinStreet(raw.tipo_logradouro, raw.logradouro),
      number: cleanText(raw.numero),
      complement: cleanText(raw.complemento),
      neighborhood: cleanText(raw.bairro),
      city,
      cityIbgeCode: null,
      uf,
      zipcode: normalizeZipcode(raw.cep),
    },
    mainCnae: { code: mainCode, description: descriptions.get(mainCode) ?? '' },
    secondaryCnaes: secondaryCnaesOf(
      raw.cnaes_secundarios ?? (raw.cnaes ?? []).map(({ codigo }) => codigo),
      mainCode,
      descriptions,
    ),
  };
}

/** Descrição de cada CNAE da lista `cnaes`, pelo código normalizado. */
function descriptionsByCode(
  cnaes: readonly { codigo?: RawValue; descricao?: RawValue }[],
): Map<string, string> {
  const descriptions = new Map<string, string>();

  for (const { codigo, descricao } of cnaes) {
    const code = normalizeCnaeCode(codigo);
    const description = cleanText(descricao);

    if (code !== null && description !== null) {
      descriptions.set(code, description);
    }
  }

  return descriptions;
}

function secondaryCnaesOf(
  codes: readonly RawValue[],
  mainCode: string,
  descriptions: ReadonlyMap<string, string>,
): CadastralCnae[] {
  const seen = new Set<string>([mainCode]);
  const cnaes: CadastralCnae[] = [];

  for (const raw of codes) {
    const code = normalizeCnaeCode(raw);

    if (code === null || seen.has(code)) continue;

    seen.add(code);
    cnaes.push({ code, description: descriptions.get(code) ?? '' });
  }

  return cnaes;
}
