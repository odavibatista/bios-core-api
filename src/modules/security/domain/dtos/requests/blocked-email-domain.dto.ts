import { BlockedDomainOrigin } from '@prisma/client';
import { z } from 'zod';
import {
  PaginationQuerySchema,
  paginatedSchema,
} from '@shared/domain/dtos/requests/pagination.dto.js';

/**
 * Nome de domínio: rótulos de letras, dígitos e hífen (sem hífen nas pontas), separados por
 * ponto, terminando em um domínio de topo de letras (ou em punycode, `xn--`), até 253
 * caracteres. Já em minúsculas, sem `@` e sem espaços.
 */
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Domínio bloqueado, como o administrador o vê (UC13). */
export const BlockedEmailDomainSchema = z
  .object({
    id: z.string().describe('Identificador do domínio bloqueado'),
    domain: z
      .string()
      .describe(
        'Domínio bloqueado, em minúsculas e sem @ (ex.: mailinator.com)',
      ),
    origin: z
      .enum(BlockedDomainOrigin)
      .describe(
        'SEED: veio da carga inicial; ADMIN: incluído (ou reincluído) por administrador',
      ),
    created_at: z.iso
      .datetime()
      .describe('Quando o domínio foi incluído pela primeira vez'),
  })
  .describe('Domínio de e-mail bloqueado para cadastro')
  .meta({ id: 'BlockedEmailDomain' });

export type BlockedEmailDomain = z.infer<typeof BlockedEmailDomainSchema>;

/** Página da blacklist (UC13, fluxo 2): só os domínios bloqueados agora. */
export const ListBlockedEmailDomainsQuerySchema = PaginationQuerySchema;

export type ListBlockedEmailDomainsQuery = z.infer<
  typeof ListBlockedEmailDomainsQuerySchema
>;

export const BlockedEmailDomainListResponseSchema = paginatedSchema(
  BlockedEmailDomainSchema,
)
  .describe('Domínios bloqueados, em ordem alfabética')
  .meta({ id: 'BlockedEmailDomainList' });

export type BlockedEmailDomainListResponse = z.infer<
  typeof BlockedEmailDomainListResponseSchema
>;

/** Inclusão de um domínio (UC13, fluxos 3 e 4). */
export const AddBlockedEmailDomainRequestSchema = z
  .object({
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        DOMAIN_PATTERN,
        'Domínio inválido: informe só o domínio, sem @ (ex.: mailinator.com).',
      )
      .describe(
        'Domínio a bloquear, sem @ (ex.: mailinator.com); gravado em minúsculas',
      ),
  })
  .describe('Domínio a incluir na blacklist')
  .meta({ id: 'AddBlockedEmailDomainRequest' });

export type AddBlockedEmailDomainRequest = z.infer<
  typeof AddBlockedEmailDomainRequestSchema
>;
