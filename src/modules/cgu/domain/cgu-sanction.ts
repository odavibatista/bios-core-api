import { z } from 'zod';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import type { EvidenceBatchEntry } from '@modules/evidences/domain/dtos/providers/evidence-batch.dto.js';

export const CGU_SLUGS = ['CGU_CEIS', 'CGU_CNEP'] as const;
export type CguSlug = (typeof CGU_SLUGS)[number];

/**
 * CEIS e CNEP usam a mesma chave, e o teto oficial é por token: os dois cadastros
 * dividem um único contador de requisições por minuto (NFPD01).
 */
export const CGU_RATE_LIMIT_GROUP = 'CGU';

const text = z.string().trim().max(1000);
// Whitelist: nunca guardar PessoaDTO, nomes do sancionado, contato ou texto livre.
export const CguSanctionSchema = z.object({
  id: z.string().regex(/^\d+$/),
  cnpj: z.string().refine((value) => parseCnpj(value) === value),
  authority: text.nullable(),
  sanctionType: text.nullable(),
  startDate: z.iso.date().nullable(),
  endDate: z.iso.date().nullable(),
  publicationDate: z.iso.date().nullable(),
});
export type CguSanction = z.infer<typeof CguSanctionSchema>;

const RowSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  sancionado: z.object({ codigoFormatado: z.string().nullish() }).nullish(),
  pessoa: z.object({ cnpjFormatado: z.string().nullish() }).nullish(),
  orgaoSancionador: z.object({ nome: text.nullish() }).nullish(),
  tipoSancao: z
    .object({
      descricaoResumida: text.nullish(),
      descricaoPortal: text.nullish(),
    })
    .nullish(),
  dataInicioSancao: z.string().nullish(),
  dataFimSancao: z.string().nullish(),
  dataPublicacaoSancao: z.string().nullish(),
});

/** Datas civis da fonte, sem converter data inválida em ausência de sanção. */
export function readCguDate(value: string | null | undefined): string | null {
  if (!value?.trim() || /^sem informa[çc][ãa]o$/i.test(value.trim()))
    return null;
  const date = value.trim();
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  const iso = brazilian
    ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`
    : date;
  return z.iso.date().parse(iso);
}

/** Sanitiza a página inteira antes de permitir cache ou persistência. */
export function readCguPage(
  body: unknown,
  cnpj: string,
): { ids: string[]; sanctions: CguSanction[] } {
  const rows = z.array(RowSchema).parse(body);
  const sanctions: CguSanction[] = [];
  const ids = rows.map((row) => String(row.id));
  for (const row of rows) {
    const document =
      row.sancionado?.codigoFormatado?.trim() ||
      row.pessoa?.cnpjFormatado?.trim();
    if (!document) throw new Error('Documento ausente na resposta CGU.');
    // CPF inclusive mascarado: sai antes de mapear qualquer dado do registro.
    if (
      /^[\d.*\-\s]+$/.test(document) &&
      document.replace(/[^\d*]/g, '').length === 11
    )
      continue;
    const normalized = parseCnpj(document);
    if (!normalized) throw new Error('Documento inválido na resposta CGU.');
    const alternate = row.pessoa?.cnpjFormatado?.trim();
    if (alternate && parseCnpj(alternate) !== normalized)
      throw new Error('Documentos divergentes na resposta CGU.');
    if (normalized !== cnpj) continue;
    sanctions.push(
      CguSanctionSchema.parse({
        id: String(row.id),
        cnpj,
        authority: row.orgaoSancionador?.nome || null,
        sanctionType:
          row.tipoSancao?.descricaoResumida ||
          row.tipoSancao?.descricaoPortal ||
          null,
        startDate: readCguDate(row.dataInicioSancao),
        endDate: readCguDate(row.dataFimSancao),
        publicationDate: readCguDate(row.dataPublicacaoSancao),
      }),
    );
  }
  return { ids, sanctions };
}

/** Uma evidência por sanção, com ID e URL auditáveis da API oficial. */
export function toCguEvidence(
  sanction: CguSanction,
  slug: CguSlug,
): EvidenceBatchEntry {
  const register = slug === 'CGU_CEIS' ? 'ceis' : 'cnep';
  return {
    cnpj: sanction.cnpj,
    raw: { ...sanction },
    finding: {
      reference: sanction.id,
      summary: `Sanção administrativa registrada no ${register.toUpperCase()}`,
      url: `https://api.portaldatransparencia.gov.br/api-de-dados/${register}/${sanction.id}`,
      details: { ...sanction },
      publishedAt: sanction.publicationDate
        ? new Date(`${sanction.publicationDate}T00:00:00.000Z`)
        : null,
    },
  };
}
