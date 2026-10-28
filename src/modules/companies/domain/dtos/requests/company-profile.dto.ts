import { z } from 'zod';
import { REGISTRATION_STATUSES } from '@modules/data-sources/domain/cadastral-normalizers.js';

/**
 * Situação cadastral na Receita Federal, em conjunto fechado (#338): as cinco da Receita e
 * `NAO_RECONHECIDA`, quando o provedor informa outra (o texto dele vem em
 * `registration_status_unrecognized`).
 */
export const RegistrationStatusSchema = z
  .enum(REGISTRATION_STATUSES)
  .describe(
    'Situação cadastral na Receita Federal: uma das cinco da Receita ou, quando o provedor informa outra, o valor de situação não reconhecida (o texto do provedor vem em registration_status_unrecognized)',
  )
  .meta({ id: 'RegistrationStatus' });

/** Atividade econômica (CNAE) com a descrição textual (RF06). */
const CnaeSchema = z
  .object({
    code: z.string().describe('Código CNAE'),
    description: z.string().describe('Descrição textual do CNAE'),
  })
  .describe('Atividade econômica')
  .meta({ id: 'Cnae' });

/** Endereço público da pessoa jurídica. */
const CompanyAddressSchema = z
  .object({
    street: z.string().nullable().describe('Logradouro'),
    number: z.string().nullable().describe('Número'),
    complement: z.string().nullable().describe('Complemento'),
    neighborhood: z.string().nullable().describe('Bairro'),
    city: z.string().describe('Município'),
    city_ibge_code: z.string().nullable().describe('Código IBGE do município'),
    uf: z.string().describe('Unidade da federação (sigla)'),
    zipcode: z.string().nullable().describe('CEP'),
  })
  .describe('Endereço da empresa')
  .meta({ id: 'CompanyAddress' });

/**
 * Perfil cadastral de uma empresa (RF05, RF06).
 *
 * Só dados de pessoa jurídica: nenhum dado de sócios ou administradores existe
 * no perfil, nem aqui (INL02).
 */
export const CompanyProfileResponseSchema = z
  .object({
    cnpj: z.string().describe('CNPJ, sem pontuação'),
    legal_name: z.string().describe('Razão social'),
    trade_name: z.string().nullable().describe('Nome fantasia'),
    registration_status: RegistrationStatusSchema,
    registration_status_unrecognized: z
      .string()
      .nullable()
      .describe(
        'Situação informada pelo provedor, como veio, quando ela não é uma das cinco da Receita; null nas demais',
      ),
    company_size: z.string().nullable().describe('Porte'),
    address: CompanyAddressSchema,
    main_cnae: CnaeSchema.describe('CNAE principal'),
    secondary_cnaes: z.array(CnaeSchema).describe('CNAEs secundários'),
    refreshed_at: z.iso
      .datetime()
      .describe('Quando o cadastro foi atualizado pela última vez na fonte'),
  })
  .describe('Perfil cadastral da empresa')
  .meta({ id: 'CompanyProfileResponse' });

export type CompanyProfileResponse = z.infer<
  typeof CompanyProfileResponseSchema
>;
