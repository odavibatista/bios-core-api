import { Worker } from 'node:worker_threads';
import { Injectable } from '@nestjs/common';
import { readReportIdentity } from '../../domain/ghg-inventory.js';

// PDF nao e executado e seu texto nao sai da thread. Limites evitam prender a API.
const SCRIPT = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { readFile } = require('node:fs/promises');
(async () => {
  const { getDocument } = await import(workerData.parser);
  const data = new Uint8Array(await readFile(workerData.path));
  const task = getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true, verbosity: 0 });
  try {
    const doc = await task.promise;
    let text = '';
    for (let i = 1; i <= Math.min(3, doc.numPages); i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      text += content.items.map((item) => item.str ?? '').join(' ') + '\n';
    }
    // So os rotulos CNPJ/Ano chegam ao processo principal.
    text = text.replace(/[\u200b-\u200f\u2060\ufeff]/g, '');
    const labels = text.match(/CNPJ\s*:\s*[A-Z0-9.\/-]+|Ano\s+inventariado\s*:\s*\d{4}/gi) ?? [];
    parentPort.postMessage(labels.join(' '));
  } finally { await task.destroy(); }
})().catch(() => process.exit(1));
`;

/** Leitura de PDF em thread descartavel com prazo e memoria limitados. */
@Injectable()
export class GhgReportReader {
  async read(path: string, budgetMs: number) {
    if (budgetMs <= 0) return null;
    return new Promise<ReturnType<typeof readReportIdentity>>((resolve) => {
      const worker = new Worker(SCRIPT, {
        eval: true,
        workerData: {
          path,
          parser: import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'),
        },
        resourceLimits: { maxOldGenerationSizeMb: 128 },
        stdout: true,
        stderr: true,
      });
      const finish = (text: unknown) => {
        clearTimeout(timer);
        void worker.terminate();
        resolve(typeof text === 'string' ? readReportIdentity(text) : null);
      };
      const timer = setTimeout(() => finish(null), budgetMs);
      worker.once('message', finish);
      worker.once('error', () => finish(null));
      worker.once('exit', () => finish(null));
    });
  }
}
