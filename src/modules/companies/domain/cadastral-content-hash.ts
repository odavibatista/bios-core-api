import { createHash } from 'node:crypto';
import type { CadastralRecord } from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';

/**
 * Hash do conteúdo cadastral, que detecta mudança sem motor de diff
 * (`content_hash` / `previous_content_hash`).
 *
 * O que entra é só o que a empresa **é**: nome, situação, porte, endereço e
 * atividades. O que fica de fora é o que muda sem a empresa mudar:
 *  - o provedor que respondeu e o instante da consulta;
 *  - o código IBGE do município, que só alguns provedores informam: trocar
 *    de provedor mudaria o hash sem nenhuma mudança cadastral.
 *
 * A serialização tem ordem de chaves fixa, e os CNAEs secundários entram
 * ordenados por código: o hash não pode depender da ordem em que o provedor
 * listou as atividades.
 */
export function computeCadastralContentHash(record: CadastralRecord): string {
  const { address } = record;
  const content = [
    record.cnpj,
    record.legalName,
    record.tradeName,
    record.registrationStatus,
    record.companySize,
    [
      address.street,
      address.number,
      address.complement,
      address.neighborhood,
      address.city,
      address.uf,
      address.zipcode,
    ],
    [record.mainCnae.code, record.mainCnae.description],
    [...record.secondaryCnaes]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(({ code, description }) => [code, description]),
  ];

  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
