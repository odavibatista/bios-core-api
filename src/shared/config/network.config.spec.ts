import { z } from 'zod';
import {
  addressListVariable,
  addressSet,
  INTERNAL_NETWORKS,
  normalizeIp,
  trustProxyVariable,
} from './network.config.js';

describe('configuração de rede (#87)', () => {
  describe('TRUST_PROXY', () => {
    const parse = (value?: string) =>
      z.object({ TRUST_PROXY: trustProxyVariable() }).safeParse({
        TRUST_PROXY: value,
      });

    it.each([
      [undefined, false],
      ['false', false],
      ['', false],
      ['0', false],
      ['1', 1],
      ['2', 2],
      ['10', 10],
      ['loopback', ['loopback']],
      [
        'loopback, 10.0.0.0/8 ,203.0.113.7',
        ['loopback', '10.0.0.0/8', '203.0.113.7'],
      ],
      ['uniquelocal,fc00::/7', ['uniquelocal', 'fc00::/7']],
    ])('%j vira %j', (value, expected) => {
      expect(parse(value)).toMatchObject({
        success: true,
        data: { TRUST_PROXY: expected },
      });
    });

    it.each([
      'true',
      'TRUE',
      '11',
      'qualquer',
      '10.0.0.0/33',
      '300.1.1.1',
      'loopback,x',
    ])('recusa %j (true deixaria o cliente escolher o próprio IP)', (value) => {
      expect(parse(value).success).toBe(false);
    });
  });

  describe('HONEYPOT_EXEMPT_IPS', () => {
    const parse = (value?: string) =>
      z
        .object({ IPS: addressListVariable(INTERNAL_NETWORKS) })
        .safeParse({ IPS: value });

    it('padrão: loopback e redes internas', () => {
      expect(parse(undefined)).toMatchObject({
        success: true,
        data: { IPS: [...INTERNAL_NETWORKS] },
      });
    });

    it('vazia é aceita: ninguém isento', () => {
      expect(parse('')).toMatchObject({ success: true, data: { IPS: [] } });
    });

    it('aceita IPs e faixas, v4 e v6', () => {
      expect(
        parse('203.0.113.7, 198.51.100.0/24, 2001:db8::/32'),
      ).toMatchObject({
        success: true,
        data: { IPS: ['203.0.113.7', '198.51.100.0/24', '2001:db8::/32'] },
      });
    });

    it.each(['localhost', '10.0.0.0/40', '1.2.3', 'a/b/c'])(
      'recusa %j',
      (value) => {
        expect(parse(value).success).toBe(false);
      },
    );
  });

  describe('normalizeIp', () => {
    it.each([
      ['::ffff:203.0.113.7', '203.0.113.7'],
      ['203.0.113.7', '203.0.113.7'],
      [' 2001:DB8::1 ', '2001:db8::1'],
    ])('%j vira %j', (ip, expected) => {
      expect(normalizeIp(ip)).toBe(expected);
    });
  });

  describe('addressSet', () => {
    const internal = addressSet(INTERNAL_NETWORKS);

    it.each([
      '127.0.0.1',
      '::ffff:127.0.0.1',
      '10.1.2.3',
      '172.31.255.255',
      '192.168.0.10',
      '::1',
      'fd12::1',
    ])('a rede interna contém %s', (ip) => {
      expect(internal.has(ip)).toBe(true);
    });

    it.each(['203.0.113.7', '172.32.0.1', '8.8.8.8', '2001:db8::1', 'lixo'])(
      'a rede interna não contém %s',
      (ip) => {
        expect(internal.has(ip)).toBe(false);
      },
    );

    it('confere IP exato e faixa', () => {
      const set = addressSet(['203.0.113.7', '198.51.100.0/24']);

      expect(set.has('203.0.113.7')).toBe(true);
      expect(set.has('203.0.113.8')).toBe(false);
      expect(set.has('198.51.100.200')).toBe(true);
    });

    it('vazio não contém nada', () => {
      expect(addressSet([]).has('127.0.0.1')).toBe(false);
    });
  });
});
