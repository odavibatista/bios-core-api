#!/usr/bin/env node
// @ts-check

/**
 * Gera as chaves de criptografia da aplicação (NFSE03).
 *
 * Imprime as duas variáveis prontas para colar no `.env`. As chaves saem em
 * base64 e têm 32 bytes, como exigido por AES-256 e HMAC-SHA256.
 *
 *   npm run keys:generate
 *
 * Para rotacionar a chave AES, gere apenas uma nova e acrescente-a a
 * ENCRYPTION_KEYS com a versão seguinte, preservando as anteriores:
 *
 *   npm run keys:generate -- --version 2
 */
import { randomBytes } from 'node:crypto';

const KEY_LENGTH_BYTES = 32;

const versionFlag = process.argv.indexOf('--version');
const version = versionFlag === -1 ? 1 : Number(process.argv[versionFlag + 1]);

if (!Number.isInteger(version) || version < 1) {
  console.error('A versão da chave deve ser um inteiro maior ou igual a 1.');
  process.exit(1);
}

const key = () => randomBytes(KEY_LENGTH_BYTES).toString('base64');

console.log(`ENCRYPTION_KEYS=${version}:${key()}`);
console.log(`BLIND_INDEX_KEY=${key()}`);
console.log(
  '\nAo rotacionar, mantenha as versões anteriores em ENCRYPTION_KEYS e não' +
    '\ntroque BLIND_INDEX_KEY: ela invalidaria os índices cegos já gravados.',
);
