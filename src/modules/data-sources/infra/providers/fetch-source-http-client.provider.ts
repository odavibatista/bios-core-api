import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';
import {
  SourceHttpClient,
  type SourceDownloadedFile,
  type SourceDownloadRequest,
  type SourceHttpRequest,
  type SourceHttpResult,
} from '../../domain/providers/source-http-client.provider.js';

const TOO_LARGE_MESSAGE = 'arquivo maior que o limite aceito';

/** Maior corpo aceito de uma fonte. APIs de consulta por CNPJ respondem em poucos KB. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const USER_AGENT = 'bios-core-api';

/** Código da causa de uma falha de rede do `fetch` (ex.: `ECONNREFUSED`), quando houver. */
function causeCodeOf(error: Error): string | undefined {
  const cause: unknown = error.cause;

  return cause instanceof Error && 'code' in cause
    ? String(cause.code)
    : undefined;
}

/**
 * Cliente HTTP das fontes externas, sobre o `fetch` do Node.
 *
 * Decisões de segurança e robustez:
 *  - **tempo máximo da chamada inteira**, corpo incluído (`AbortSignal.timeout`):
 *    uma fonte que responde o cabeçalho e trava o corpo não prende o worker;
 *  - **sem redirecionamentos** (`redirect: 'manual'`): o endereço vem do
 *    catálogo, e seguir um `Location` levaria a chamada, com seus cabeçalhos,
 *    para onde a fonte mandasse;
 *  - **corpo limitado** (`MAX_RESPONSE_BYTES`), lido em fluxo: uma resposta
 *    desmedida é abortada sem ser carregada na memória;
 *  - **nunca lança**: todo desfecho volta como resultado, e o caso de uso o
 *    classifica e registra.
 */
@Injectable()
export class FetchSourceHttpClient extends SourceHttpClient {
  override async get({
    url,
    headers,
    timeoutMs,
  }: SourceHttpRequest): Promise<SourceHttpResult> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          'user-agent': USER_AGENT,
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Só o corpo de uma resposta 2xx interessa; as demais bastam pelo status.
      if (!response.ok) {
        await response.body?.cancel();

        return { kind: 'RESPONSE', status: response.status };
      }

      return await this.readJson(response);
    } catch (error) {
      return this.failureOf(error);
    }
  }

  /**
   * Baixa um arquivo grande (um dump em lote) para o disco.
   *
   * Valem as mesmas garantias de `get` (tempo máximo da chamada inteira, sem
   * redirecionamentos, nunca lança) com duas diferenças: o corpo vai direto para
   * o arquivo, em fluxo, e o limite é o de `maxBytes`, não o de uma resposta de
   * API. O SHA-256 é calculado durante a gravação, sem reler o arquivo. Falhar
   * no meio, estourar o limite ou o tempo apaga o que foi gravado.
   */
  override async download({
    url,
    headers,
    timeoutMs,
    destination,
    maxBytes,
  }: SourceDownloadRequest): Promise<SourceHttpResult> {
    const signal = AbortSignal.timeout(timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { accept: '*/*', 'user-agent': USER_AGENT, ...headers },
        signal,
      });

      if (!response.ok) {
        await response.body?.cancel();

        return { kind: 'RESPONSE', status: response.status };
      }

      if (!response.body) {
        return { kind: 'FAILED', message: 'resposta sem corpo' };
      }

      if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body.cancel();

        return { kind: 'FAILED', message: TOO_LARGE_MESSAGE };
      }

      const file = await this.saveToDisk(
        response.body as NodeReadableStream,
        destination,
        maxBytes,
        signal,
      );

      if (file.bytes === 0) {
        await rm(destination, { force: true });

        return { kind: 'FAILED', message: 'arquivo vazio' };
      }

      return { kind: 'RESPONSE', status: response.status, file };
    } catch (error) {
      await rm(destination, { force: true });

      return signal.aborted ? { kind: 'TIMEOUT' } : this.failureOf(error);
    }
  }

  private async saveToDisk(
    body: NodeReadableStream,
    destination: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<SourceDownloadedFile> {
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;

        if (bytes > maxBytes) {
          done(new Error(TOO_LARGE_MESSAGE));

          return;
        }

        hash.update(chunk);
        done(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(body),
      meter,
      createWriteStream(destination),
      { signal },
    );

    return { path: destination, bytes, checksum: hash.digest('hex') };
  }

  private async readJson(response: Response): Promise<SourceHttpResult> {
    const declared = Number(response.headers.get('content-length'));

    if (declared > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();

      return { kind: 'FAILED', message: 'resposta maior que o limite aceito' };
    }

    const text = await this.readText(response);

    if (text === null) {
      return { kind: 'FAILED', message: 'resposta maior que o limite aceito' };
    }

    if (text.trim() === '') {
      return { kind: 'RESPONSE', status: response.status };
    }

    try {
      return {
        kind: 'RESPONSE',
        status: response.status,
        json: JSON.parse(text) as unknown,
      };
    } catch {
      return { kind: 'FAILED', message: 'resposta não é um JSON válido' };
    }
  }

  /** Lê o corpo em fluxo; `null` quando passa do limite, sem terminar de ler. */
  private async readText(response: Response): Promise<string | null> {
    if (!response.body) return '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';

    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      received += value.byteLength;

      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();

        return null;
      }

      text += decoder.decode(value, { stream: true });
    }

    return text + decoder.decode();
  }

  private failureOf(error: unknown): SourceHttpResult {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { kind: 'TIMEOUT' };
    }

    if (error instanceof Error) {
      const code = causeCodeOf(error);

      return {
        kind: 'FAILED',
        message: code ? `${error.message} (${code})` : error.message,
      };
    }

    return { kind: 'FAILED', message: String(error) };
  }
}
