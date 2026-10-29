import { BlockList, isIP } from 'node:net';
import { z } from 'zod';

/**
 * Faixas de rede internas: loopback, privadas (RFC 1918 e RFC 4193) e link-local.
 *
 * É o padrão das isenções do honeypot (#87): o proxy reverso, o monitoramento e a própria
 * máquina vivem nelas, e bloqueá-los derrubaria a API inteira. Robôs de raspagem chegam
 * por endereços públicos.
 */
export const INTERNAL_NETWORKS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
] as const;

/** Nomes de faixas que o Express aceita em `trust proxy`. */
const TRUST_PROXY_KEYWORDS = ['loopback', 'linklocal', 'uniquelocal'];

/** Proxies em cadeia aceitos em `TRUST_PROXY` numérico. */
const MAX_PROXY_HOPS = 10;

/** `trust proxy` do Express, como `TRUST_PROXY` o descreve. */
export type TrustProxySetting = false | number | string[];

function entriesOf(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** Um IP (v4 ou v6) ou uma faixa CIDR (`10.0.0.0/8`, `fc00::/7`). */
function isAddressOrNetwork(entry: string): boolean {
  const [address, prefix, ...rest] = entry.split('/');
  const family = isIP(address);

  if (rest.length > 0 || family === 0) return false;
  if (prefix === undefined) return true;

  return (
    /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)
  );
}

/**
 * Quais proxies na frente da API são confiáveis para dizer o IP do cliente
 * (`X-Forwarded-For`), no formato do `trust proxy` do Express (#87).
 *
 *  - `false` (padrão): sem proxy; o IP é o da conexão;
 *  - um número: quantos proxies há na frente (ex.: `1` para um balanceador);
 *  - uma lista de IPs, faixas CIDR ou `loopback`/`linklocal`/`uniquelocal`: os proxies.
 *
 * `true` (confiar em qualquer um) é recusado de propósito: com ele, o cliente escreve o
 * próprio IP no cabeçalho e poderia fazer o honeypot bloquear o IP de outra pessoa.
 */
export function trustProxyVariable() {
  return z
    .string()
    .default('false')
    .transform((text, context): TrustProxySetting => {
      const value = text.trim().toLowerCase();

      if (value === 'false' || value === '' || value === '0') return false;

      if (/^\d+$/.test(value) && Number(value) <= MAX_PROXY_HOPS) {
        return Number(value);
      }

      // `true` não é proxy nem faixa: cai na recusa abaixo.
      const entries = entriesOf(value);

      if (
        entries.length > 0 &&
        entries.every(
          (entry) =>
            TRUST_PROXY_KEYWORDS.includes(entry) || isAddressOrNetwork(entry),
        )
      ) {
        return entries;
      }

      context.addIssue({
        code: 'custom',
        message:
          'deve ser false, o número de proxies na frente da API (até 10) ou a lista dos ' +
          'proxies (IPs, faixas CIDR, loopback, linklocal ou uniquelocal); true não é aceito',
      });
      return z.NEVER;
    });
}

/** Lista de IPs e faixas CIDR separados por vírgula; vazia é aceita. */
export function addressListVariable(defaultValue: readonly string[]) {
  return z
    .string()
    .default(defaultValue.join(','))
    .transform((text, context) => {
      const entries = entriesOf(text);
      const invalid = entries.find((entry) => !isAddressOrNetwork(entry));

      if (invalid !== undefined) {
        context.addIssue({
          code: 'custom',
          message: `"${invalid}" não é um IP nem uma faixa CIDR (ex.: 203.0.113.7, 10.0.0.0/8)`,
        });
        return z.NEVER;
      }

      return entries;
    });
}

/**
 * IP na forma em que é comparado e gravado: o IPv4 que chega escrito como IPv6
 * (`::ffff:203.0.113.7`, comum em servidores que ouvem nas duas famílias) volta a IPv4.
 */
export function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip.trim());

  return mapped ? mapped[1] : ip.trim().toLowerCase();
}

/** Conjunto de IPs e faixas, para conferir pertencimento. */
export function addressSet(entries: readonly string[]): {
  has(ip: string): boolean;
} {
  const list = new BlockList();

  for (const entry of entries) {
    const [address, prefix] = entry.split('/');
    const type = isIP(address) === 6 ? 'ipv6' : 'ipv4';

    if (prefix === undefined) list.addAddress(address, type);
    else list.addSubnet(address, Number(prefix), type);
  }

  return {
    has(ip: string): boolean {
      const address = normalizeIp(ip);
      const family = isIP(address);

      return (
        family !== 0 && list.check(address, family === 6 ? 'ipv6' : 'ipv4')
      );
    },
  };
}
