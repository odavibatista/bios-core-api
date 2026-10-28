import { z } from 'zod';
import {
  cleanText,
  normalizeCompanySize,
  joinStreet,
  normalizeCnaeCode,
  normalizeIbgeCode,
  normalizeRegistrationStatus,
  normalizeUf,
  normalizeZipcode,
  type RawValue,
} from './cadastral-normalizers.js';
import type {
  CadastralCnae,
  CadastralRecord,
} from './dtos/providers/cadastral-record.dto.js';

/** Campo que os provedores mandam como texto, número ou `null`, conforme o registro. */
const field = z.union([z.string(), z.number()]).nullish();

/**
 * Os campos da resposta que o BIOS usa, no formato dos dados abertos da Receita
 * (`GET /{cnpj}` da BrasilAPI e do Minha Receita, que servem os mesmos dados no
 * mesmo formato).
 *
 * Fica em `data-sources`, e não em um adapter, para que os dois provedores
 * compartilhem a leitura sem que um módulo dependa do outro (NFPD02). Se um
 * deles divergir do formato, o mapper dele passa a ser próprio.
 *
 * É uma **lista de campos permitidos**: o `z.object` descarta o que não está
 * aqui. A resposta traz também o quadro societário (`qsa`: nomes e CPFs de
 * sócios e representantes), contatos, regime tributário e capital social, e
 * nada disso chega ao BIOS (INL02) — não porque o código o filtre depois, mas
 * porque nunca é lido.
 */
const ReceitaOpenDataSchema = z.object({
  cnpj: z.string(),
  razao_social: field,
  nome_fantasia: field,
  descricao_situacao_cadastral: field,
  situacao_cadastral: field,
  porte: field,
  cnae_fiscal: field,
  cnae_fiscal_descricao: field,
  cnaes_secundarios: z
    .array(z.object({ codigo: field, descricao: field }))
    .nullish(),
  descricao_tipo_de_logradouro: field,
  logradouro: field,
  numero: field,
  complemento: field,
  bairro: field,
  municipio: field,
  uf: field,
  cep: field,
  codigo_municipio_ibge: field,
});

/** CNPJ da resposta, na forma canônica (sem máscara, em maiúsculas). */
function canonical(cnpj: string): string {
  return cnpj.replace(/[./\-\s]/g, '').toUpperCase();
}

/**
 * Converte a resposta de um provedor do formato dos dados abertos da Receita para o cadastro do BIOS, ou `null` quando
 * ela não é utilizável.
 *
 * É `null` quando o corpo não tem o formato esperado, quando faltam os campos
 * sem os quais o perfil não faz sentido (razão social, situação, CNAE
 * principal, município e UF) e quando o CNPJ da resposta **não é o consultado**:
 * gravar o cadastro de outra empresa sob o CNPJ pedido seria pior do que não
 * ter dado.
 *
 * O provedor indica "sem CNAE secundário" com um item de código `0`; esses
 * itens, e os repetidos, são descartados.
 */
export function toCadastralRecord(
  body: unknown,
  expectedCnpj: string,
): CadastralRecord | null {
  const parsed = ReceitaOpenDataSchema.safeParse(body);

  if (!parsed.success) return null;

  const raw = parsed.data;
  const legalName = cleanText(raw.razao_social);
  const registrationStatus = normalizeRegistrationStatus(
    raw.descricao_situacao_cadastral,
    raw.situacao_cadastral,
  );
  const mainCode = normalizeCnaeCode(raw.cnae_fiscal);
  const city = cleanText(raw.municipio);
  const uf = normalizeUf(raw.uf);

  if (
    canonical(raw.cnpj) !== expectedCnpj ||
    legalName === null ||
    registrationStatus === null ||
    mainCode === null ||
    city === null ||
    uf === null
  ) {
    return null;
  }

  return {
    cnpj: expectedCnpj,
    legalName,
    tradeName: cleanText(raw.nome_fantasia),
    registrationStatus: registrationStatus.status,
    registrationStatusUnrecognized: registrationStatus.unrecognized,
    companySize: normalizeCompanySize(raw.porte),
    address: {
      street: joinStreet(raw.descricao_tipo_de_logradouro, raw.logradouro),
      number: cleanText(raw.numero),
      complement: cleanText(raw.complemento),
      neighborhood: cleanText(raw.bairro),
      city,
      cityIbgeCode: normalizeIbgeCode(raw.codigo_municipio_ibge),
      uf,
      zipcode: normalizeZipcode(raw.cep),
    },
    mainCnae: {
      code: mainCode,
      description: cleanText(raw.cnae_fiscal_descricao) ?? '',
    },
    secondaryCnaes: secondaryCnaesOf(raw.cnaes_secundarios ?? [], mainCode),
  };
}

function secondaryCnaesOf(
  items: readonly { codigo?: RawValue; descricao?: RawValue }[],
  mainCode: string,
): CadastralCnae[] {
  const seen = new Set<string>([mainCode]);
  const cnaes: CadastralCnae[] = [];

  for (const item of items) {
    const code = normalizeCnaeCode(item.codigo);

    if (code === null || seen.has(code)) continue;

    seen.add(code);
    cnaes.push({ code, description: cleanText(item.descricao) ?? '' });
  }

  return cnaes;
}
