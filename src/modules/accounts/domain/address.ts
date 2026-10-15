import { type Address, AddressSchema } from './dtos/requests/address.dto.js';

/**
 * Endereço na forma que se guarda: CEP só com dígitos e sem complemento vazio.
 *
 * A mesma entrada em formas diferentes ("01310-100" e "01310100") produz o
 * mesmo registro.
 */
export function normalizeAddress(address: Address): Address {
  const complement = address.complement?.trim();

  return {
    postal_code: address.postal_code.replace('-', ''),
    street: address.street.trim(),
    number: address.number.trim(),
    ...(complement ? { complement } : {}),
    neighborhood: address.neighborhood.trim(),
    city: address.city.trim(),
    state: address.state,
  };
}

/** Endereço em texto, pronto para ser cifrado. */
export function serializeAddress(address: Address): string {
  return JSON.stringify(normalizeAddress(address));
}

/**
 * Endereço a partir do texto decifrado.
 *
 * O conteúdo é conferido contra o schema: um documento corrompido ou escrito
 * por outra versão do sistema falha aqui, em vez de chegar ao usuário como um
 * endereço malformado.
 */
export function parseAddress(serialized: string): Address {
  return AddressSchema.parse(JSON.parse(serialized));
}
