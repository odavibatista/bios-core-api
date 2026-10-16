import { z } from 'zod';

/** Nome do job de consulta cadastral na fila `company-profile`. */
export const FETCH_COMPANY_PROFILE_JOB = 'fetch-company-profile';

/** Janela, em segundos, em que pedidos do mesmo CNPJ compartilham um único job. */
export const COMPANY_PROFILE_JOB_DEDUP_WINDOW_SECONDS = 60;

/**
 * O que quem consulta envia ao consumidor da fila (`CompanyProfileProcessor`).
 *
 * Só o CNPJ canônico (14 caracteres): o consumidor não precisa de mais nada, e
 * nenhum dado de quem consulta entra na fila.
 */
export interface CompanyProfileJobPayload {
  cnpj: string;
}

/**
 * Schema do payload, que o consumidor confere antes de agir: o que vem da fila
 * é entrada externa, ainda que o produtor seja o próprio core.
 */
export const CompanyProfileJobPayloadSchema = z.object({
  cnpj: z.string(),
});

/**
 * O que o consumidor devolve ao concluir o job.
 *
 *  - `FOUND`: um provedor respondeu e `company_profile` foi gravado/atualizado;
 *  - `NOT_FOUND`: todos os provedores consultados confirmaram que o CNPJ não existe;
 *  - `SOURCES_UNAVAILABLE`: nenhum provedor da cadeia (BrasilAPI → OpenCNPJ →
 *    Minha Receita) pôde responder.
 *
 * É o contrato entre quem pede (`GetCompanyProfileUseCase`) e quem consome a
 * fila, que conversam só por ela (`14-Projeto-e-Arquitetura.md`, seção 2),
 * ainda que hoje vivam no mesmo processo. Quem pede confere o resultado contra
 * este schema: um consumidor fora do contrato é tratado como fonte
 * indisponível, nunca como dado.
 */
export const CompanyProfileJobResultSchema = z.object({
  outcome: z.enum(['FOUND', 'NOT_FOUND', 'SOURCES_UNAVAILABLE']),
});

export type CompanyProfileJobResult = z.infer<
  typeof CompanyProfileJobResultSchema
>;

/**
 * Identificador do job de um CNPJ.
 *
 * Pedidos do mesmo CNPJ na mesma janela caem no mesmo job, em vez de gerar uma
 * consulta externa por requisição. A janela existe porque o BullMQ ignora a
 * publicação de um `jobId` que já existe, e os jobs falhos são mantidos: com um
 * identificador fixo por CNPJ, um único job falho impediria para sempre uma
 * nova tentativa. Sem `:` — o BullMQ não aceita esse separador em identificador.
 */
export function companyProfileJobId(cnpj: string, now = new Date()): string {
  const window = Math.floor(
    now.getTime() / (COMPANY_PROFILE_JOB_DEDUP_WINDOW_SECONDS * 1_000),
  );

  return `company-profile-${cnpj}-${window}`;
}
