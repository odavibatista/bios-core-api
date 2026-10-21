import { EvidenceCategory, EvidenceState } from '@prisma/client';
import { evidenceSourceFactory } from '@test/factories/evidences/evidence.factory.js';
import { IBAMA_CNPJ } from '@test/factories/ibama/ibama-dump.factory.js';
import { faker } from '@test/support/faker.js';
import { contentHash } from '../../domain/canonical-json.js';
import { InvalidEvidenceError } from '../../domain/dtos/errors/evidence.errors.js';
import type { EvidenceBatchEntry } from '../../domain/dtos/providers/evidence-batch.dto.js';
import type {
  EvidenceRepository,
  EvidenceToSave,
} from '../../domain/dtos/repositories/evidence.repository.js';
import type { RawEvidenceRepository } from '../../domain/dtos/repositories/raw-evidence.repository.js';
import {
  BATCH_WRITE_CONCURRENCY,
  RepositoryEvidenceBatch,
} from './repository-evidence-batch.js';

describe('RepositoryEvidenceBatch', () => {
  const evidenceRepository = {
    save: vi.fn<EvidenceRepository['save']>(),
    deleteNotCollectedSince:
      vi.fn<EvidenceRepository['deleteNotCollectedSince']>(),
  };
  const rawEvidenceRepository = {
    save: vi.fn<RawEvidenceRepository['save']>(),
  };
  const source = evidenceSourceFactory.build({
    slug: 'IBAMA',
    category: EvidenceCategory.INFRACAO_AMBIENTAL,
  });
  const collectedAt = faker.date.recent();
  const validUntil = new Date(collectedAt.getTime() + 2 * 86_400_000);
  let batch: RepositoryEvidenceBatch;

  function entry(reference: string, over: Partial<EvidenceBatchEntry> = {}) {
    return {
      cnpj: IBAMA_CNPJ,
      finding: {
        reference,
        identity: `AI-${reference}`,
        summary: `Auto ${reference}`,
      },
      raw: { payload: { NUM: reference } },
      ...over,
    } satisfies EvidenceBatchEntry;
  }

  const savedEvidences = (): EvidenceToSave[] =>
    evidenceRepository.save.mock.calls.map(([evidence]) => evidence);

  function open(ingestionRunId: string | null = null) {
    batch = new RepositoryEvidenceBatch(
      evidenceRepository as unknown as EvidenceRepository,
      rawEvidenceRepository,
      source,
      collectedAt,
      validUntil,
      ingestionRunId,
    );
  }

  beforeEach(() => {
    evidenceRepository.save.mockResolvedValue(undefined);
    evidenceRepository.deleteNotCollectedSince.mockResolvedValue(0);
    rawEvidenceRepository.save.mockImplementation((raw) =>
      Promise.resolve(`raw-${raw.externalReference}`),
    );
    open();
  });

  it('expõe a fonte da carga', () => {
    expect(batch.sourceSlug).toBe('IBAMA');
  });

  describe('write', () => {
    it('grava a evidência CONFIRMED com categoria, ODS, datas e o vínculo com o registro bruto', async () => {
      await batch.write([entry('1')]);

      expect(savedEvidences()).toEqual([
        {
          key: `IBAMA:${IBAMA_CNPJ}:AI-1`,
          cnpj: IBAMA_CNPJ,
          dataSourceId: source.id,
          odsId: source.odsId,
          category: EvidenceCategory.INFRACAO_AMBIENTAL,
          state: EvidenceState.CONFIRMED,
          signal: 'NEGATIVE',
          summary: 'Auto 1',
          sourceReference: '1',
          sourceUrl: null,
          details: null,
          publishedAt: null,
          collectedAt,
          validUntil,
          rawEvidenceId: 'raw-1',
        },
      ]);
    });

    it('grava o registro bruto antes da evidência, com a execução, a referência e o resumo do conteúdo', async () => {
      open('run-7');
      const order: string[] = [];
      rawEvidenceRepository.save.mockImplementation((raw) => {
        order.push('raw');

        return Promise.resolve(`raw-${raw.externalReference}`);
      });
      evidenceRepository.save.mockImplementation(() => {
        order.push('evidence');

        return Promise.resolve();
      });

      await batch.write([entry('1')]);

      expect(order).toEqual(['raw', 'evidence']);
      const [raw] = rawEvidenceRepository.save.mock.calls[0];
      expect(raw).toEqual({
        dataSourceId: source.id,
        ingestionRunId: 'run-7',
        cnpj: IBAMA_CNPJ,
        externalReference: '1',
        payload: { payload: { NUM: '1' } },
        payloadHash: contentHash({
          key: `IBAMA:${IBAMA_CNPJ}:AI-1`,
          raw: { payload: { NUM: '1' } },
        }),
        collectedAt,
      });
    });

    it('o mesmo registro tem o mesmo resumo; conteúdo diferente, outro', async () => {
      await batch.write([entry('1'), entry('2')]);
      await batch.write([entry('1')]);
      await batch.write([
        entry('1', { raw: { payload: { NUM: '1', VALOR: '10' } } }),
      ]);

      const hashes = rawEvidenceRepository.save.mock.calls.map(
        ([raw]) => raw.payloadHash,
      );
      // Ordem das gravações: registro 1, registro 2, registro 1 de novo, registro 1 alterado.
      expect(hashes[0]).toBe(hashes[2]);
      expect(hashes[0]).not.toBe(hashes[1]);
      expect(hashes[0]).not.toBe(hashes[3]);
    });

    it('a mesma ordem das chaves do registro não muda o resumo', async () => {
      await batch.write([entry('1', { raw: { a: 1, b: 2 } })]);
      await batch.write([entry('1', { raw: { b: 2, a: 1 } })]);

      const [first, second] = rawEvidenceRepository.save.mock.calls;
      expect(first[0].payloadHash).toBe(second[0].payloadHash);
    });

    it('devolve quantas evidências gravou', async () => {
      await expect(
        batch.write([entry('1'), entry('2'), entry('3')]),
      ).resolves.toBe(3);
    });

    it('lote vazio não grava nada', async () => {
      await expect(batch.write([])).resolves.toBe(0);

      expect(rawEvidenceRepository.save).not.toHaveBeenCalled();
      expect(evidenceRepository.save).not.toHaveBeenCalled();
    });

    it('chave repetida no lote vale uma vez só, a última', async () => {
      const first = entry('1');
      const last = entry('1', {
        finding: { reference: '1', identity: 'AI-1', summary: 'a última' },
      });

      await expect(batch.write([first, entry('2'), last])).resolves.toBe(2);

      expect(
        savedEvidences().find(({ sourceReference }) => sourceReference === '1')
          ?.summary,
      ).toBe('a última');
      expect(rawEvidenceRepository.save).toHaveBeenCalledTimes(2);
    });

    it('a mesma referência com identidades diferentes são duas evidências', async () => {
      await expect(
        batch.write([
          entry('1', { finding: { reference: '9185894-E', identity: 'AI-1' } }),
          entry('2', { finding: { reference: '9185894-E', identity: 'AI-2' } }),
        ]),
      ).resolves.toBe(2);
    });

    it('a mesma referência em empresas diferentes são duas evidências', async () => {
      await expect(
        batch.write([entry('1'), entry('1', { cnpj: '00000000000191' })]),
      ).resolves.toBe(2);
    });

    it('limita as gravações simultâneas', async () => {
      let inFlight = 0;
      let peak = 0;
      rawEvidenceRepository.save.mockImplementation(async (raw) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;

        return `raw-${raw.externalReference}`;
      });
      const entries = Array.from(
        { length: BATCH_WRITE_CONCURRENCY * 4 },
        (_, i) => entry(String(i)),
      );

      await batch.write(entries);

      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(BATCH_WRITE_CONCURRENCY);
      expect(evidenceRepository.save).toHaveBeenCalledTimes(entries.length);
    });

    describe('entrada inválida: nada é gravado', () => {
      it.each(['11.222.333/0001-81', '11222333000182', '123', ''])(
        'recusa o CNPJ "%s"',
        async (cnpj) => {
          await expect(
            batch.write([entry('1'), entry('2', { cnpj })]),
          ).rejects.toBeInstanceOf(InvalidEvidenceError);

          expect(rawEvidenceRepository.save).not.toHaveBeenCalled();
          expect(evidenceRepository.save).not.toHaveBeenCalled();
        },
      );

      it('recusa o registro sem referência', async () => {
        await expect(
          batch.write([
            entry('1'),
            entry('2', { finding: { reference: '  ' } }),
          ]),
        ).rejects.toBeInstanceOf(InvalidEvidenceError);

        expect(evidenceRepository.save).not.toHaveBeenCalled();
      });
    });

    describe('falhas', () => {
      it('propaga a falha ao gravar o registro bruto, sem gravar a evidência dele', async () => {
        rawEvidenceRepository.save.mockRejectedValue(new Error('banco fora'));

        await expect(batch.write([entry('1')])).rejects.toThrow('banco fora');

        expect(evidenceRepository.save).not.toHaveBeenCalled();
      });

      it('propaga a falha ao gravar a evidência', async () => {
        evidenceRepository.save.mockRejectedValue(new Error('banco fora'));

        await expect(batch.write([entry('1')])).rejects.toThrow('banco fora');
      });

      it('na primeira falha, não começa nenhum item novo', async () => {
        const entries = Array.from(
          { length: BATCH_WRITE_CONCURRENCY * 10 },
          (_, i) => entry(String(i)),
        );
        rawEvidenceRepository.save.mockRejectedValue(new Error('banco fora'));

        await expect(batch.write(entries)).rejects.toThrow('banco fora');

        expect(
          rawEvidenceRepository.save.mock.calls.length,
        ).toBeLessThanOrEqual(BATCH_WRITE_CONCURRENCY);
      });
    });
  });

  describe('finish', () => {
    it('remove da fonte o que a carga não renovou, com o corte na data da carga', async () => {
      evidenceRepository.deleteNotCollectedSince.mockResolvedValue(42);

      await expect(batch.finish()).resolves.toEqual({ removed: 42 });

      expect(evidenceRepository.deleteNotCollectedSince).toHaveBeenCalledWith(
        source.id,
        collectedAt,
      );
    });

    it('propaga a falha do banco', async () => {
      evidenceRepository.deleteNotCollectedSince.mockRejectedValue(
        new Error('banco fora'),
      );

      await expect(batch.finish()).rejects.toThrow('banco fora');
    });
  });
});
