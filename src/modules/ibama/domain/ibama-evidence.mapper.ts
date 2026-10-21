import type { Prisma } from '@prisma/client';
import type { EvidenceBatchEntry } from '@modules/evidences/domain/dtos/providers/evidence-batch.dto.js';
import type { IbamaRecord } from './dtos/providers/ibama-dump.dto.js';
import { IBAMA_RESOURCES, IbamaResource } from './ibama-resource.js';
import {
  formatBrl,
  formatDate,
  formatHectares,
  parseBrazilianNumber,
  parseIbamaDate,
} from './ibama-values.js';

/**
 * Página de cada dataset no portal de dados abertos do IBAMA: onde o registro
 * pode ser conferido na fonte (RF09). O dump não traz um link por registro, então
 * o link leva ao conjunto de dados, e a `reference` identifica o registro nele.
 */
export const IBAMA_DATASET_URLS: Readonly<Record<IbamaResource, string>> = {
  [IbamaResource.AUTO_INFRACAO]:
    'https://dadosabertos.ibama.gov.br/dataset/fiscalizacao-auto-de-infracao',
  [IbamaResource.TERMO_EMBARGO]:
    'https://dadosabertos.ibama.gov.br/dataset/fiscalizacao-termo-de-embargo',
};

/**
 * Prefixo da identidade de cada recurso: o identificador interno de um auto e o
 * de um termo são sequências diferentes, e podem coincidir.
 */
const IDENTITY_PREFIX: Readonly<Record<IbamaResource, string>> = {
  [IbamaResource.AUTO_INFRACAO]: 'AI-',
  [IbamaResource.TERMO_EMBARGO]: 'TE-',
};

/** Situações em que o documento deixou de valer: não é infração nem embargo. */
const ANNULLED_STATUSES = new Set([
  'cancelado',
  'excluído',
  'excluido',
  'substituído por outro',
  'substituido por outro',
]);

function isAnnulledStatus(status: string | undefined): boolean {
  return status !== undefined && ANNULLED_STATUSES.has(status.toLowerCase());
}

/**
 * O documento foi anulado: cancelado, excluído ou substituído por outro (o
 * substituto é um registro à parte). Uma infração anulada não aconteceu para
 * efeito de índice, e uma evidência negativa que não vale seria injusta com a
 * empresa (IND01), então ela não vira evidência.
 */
export function isAnnulled(record: IbamaRecord): boolean {
  const { payload } = record;

  return (
    payload.SIT_CANCELADO?.toUpperCase() === 'S' ||
    isAnnulledStatus(payload.DES_STATUS_FORMULARIO) ||
    isAnnulledStatus(payload.DES_STATUS_FORMULARIO_AIE)
  );
}

/** Tira dos detalhes o que o dump não informou. */
function compact(
  details: Record<string, Prisma.InputJsonValue | null>,
): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== null),
  );
}

function place(municipality?: string, uf?: string): string {
  if (municipality && uf) return ` (${municipality}/${uf})`;

  const only = municipality || uf;

  return only ? ` (${only})` : '';
}

function infractionNotice(record: IbamaRecord) {
  const { payload } = record;
  const fine = parseBrazilianNumber(payload.VAL_AUTO_INFRACAO);
  const area = parseBrazilianNumber(payload.QT_AREA);
  const title = [payload.TIPO_AUTO ?? 'Auto de infração', payload.DES_INFRACAO]
    .filter(Boolean)
    .join(': ');

  return {
    summary: `${title}${fine === null ? '' : ` — ${formatBrl(fine)}`}${place(payload.MUNICIPIO, payload.UF)}`,
    publishedAt: parseIbamaDate(payload.DAT_HORA_AUTO_INFRACAO),
    details: compact({
      resource: record.resource,
      notice_type: payload.TIPO_AUTO ?? null,
      infraction_type: payload.TIPO_INFRACAO ?? null,
      infraction_code: payload.COD_INFRACAO ?? null,
      infraction_description: payload.DES_INFRACAO ?? null,
      severity: payload.GRAVIDADE_INFRACAO ?? null,
      fine_amount: fine,
      area_hectares: area,
      biomes: payload.DS_BIOMAS_ATINGIDOS ?? null,
      municipality: payload.MUNICIPIO ?? null,
      municipality_code: payload.COD_MUNICIPIO ?? null,
      uf: payload.UF ?? null,
      process_number:
        payload.NU_PROCESSO_FORMATADO ?? payload.NUM_PROCESSO ?? null,
      status: payload.DES_STATUS_FORMULARIO ?? null,
      fact_date:
        parseIbamaDate(payload.DT_FATO_INFRACIONAL)
          ?.toISOString()
          .slice(0, 10) ?? null,
    }),
  };
}

function embargoNotice(record: IbamaRecord) {
  const { payload } = record;
  const area = parseBrazilianNumber(payload.QTD_AREA_EMBARGADA);
  const liftedAt = parseIbamaDate(payload.DAT_DESEMBARGO);
  const lifted =
    payload.SIT_DESEMBARGO?.toUpperCase() === 'S' || liftedAt !== null;
  const parts = [
    'Termo de embargo',
    payload.TIPO_AREA,
    area === null ? undefined : `${formatHectares(area)} ha`,
  ].filter(Boolean);
  const liftedText = lifted
    ? ` — desembargado${liftedAt ? ` em ${formatDate(liftedAt)}` : ''}`
    : '';

  return {
    summary: `${parts.join(' — ')}${place(payload.MUNICIPIO, payload.UF)}${liftedText}`,
    publishedAt: parseIbamaDate(payload.DAT_EMBARGO),
    details: compact({
      resource: record.resource,
      area_type: payload.TIPO_AREA ?? null,
      area_hectares: area,
      deter_prodes: payload.DETER_PRODES ?? null,
      municipality: payload.MUNICIPIO ?? null,
      municipality_code: payload.COD_MUNICIPIO ?? null,
      uf: payload.UF ?? null,
      process_number: payload.NUM_PROCESSO ?? null,
      status: payload.DES_STATUS_FORMULARIO ?? null,
      infraction_notice: payload.NUM_AUTO_INFRACAO ?? null,
      lifted,
      lifted_at: liftedAt?.toISOString().slice(0, 10) ?? null,
      lift_type: payload.TIPO_DESEMBARGO ?? null,
    }),
  };
}

/**
 * Registro do IBAMA, como entrada da carga em lote de evidências (UC14, RF08,
 * RF09), ou `null` quando o documento foi anulado (`isAnnulled`).
 *
 *  - **referência** é o número público do documento (o que se mostra e se
 *    procura no órgão); **identidade**, o identificador interno do IBAMA quando
 *    há (e o número, quando não), com o recurso à frente. O número público se
 *    repete no dump, e duas evidências diferentes não podem cair na mesma chave;
 *  - **resumo e detalhes** só usam colunas permitidas do registro, em português
 *    e com valores já convertidos (reais, hectares, datas);
 *  - **data de publicação** é a do auto ou do termo (só o dia);
 *  - **link** leva ao conjunto de dados na fonte;
 *  - o **registro bruto** guardado é o do adapter, sem nome do autuado, texto
 *    livre nem geometria (INL02).
 *
 * Um embargo suspenso (desembargado) continua sendo evidência: ele aconteceu, e
 * o quanto pesa é do cálculo do índice; `details.lifted` o distingue.
 */
export function toEvidenceEntry(
  record: IbamaRecord,
): EvidenceBatchEntry | null {
  if (isAnnulled(record)) return null;

  const notice =
    record.resource === IbamaResource.AUTO_INFRACAO
      ? infractionNotice(record)
      : embargoNotice(record);

  return {
    cnpj: record.cnpj,
    finding: {
      reference: record.reference,
      identity: `${IDENTITY_PREFIX[record.resource]}${record.sequence ?? record.reference}`,
      summary: notice.summary,
      url: IBAMA_DATASET_URLS[record.resource],
      details: notice.details,
      publishedAt: notice.publishedAt,
    },
    raw: { resource: record.resource, payload: allowedPayload(record) },
  };
}

/**
 * O payload do registro bruto, só com as colunas permitidas do recurso. O
 * adapter já entrega o registro assim; refazer o corte aqui evita que um
 * campo a mais (um nome, um texto livre) chegue ao banco por um registro que
 * não passou pelo adapter.
 */
function allowedPayload(record: IbamaRecord): Record<string, string> {
  const allowed = new Set(IBAMA_RESOURCES[record.resource].payloadColumns);

  return Object.fromEntries(
    Object.entries(record.payload).filter(([column]) => allowed.has(column)),
  );
}
