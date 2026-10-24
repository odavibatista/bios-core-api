import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  EvidenceBatch,
  EvidenceBatchEntry,
} from '@modules/evidences/domain/dtos/providers/evidence-batch.dto.js';
import { ibamaRecordFactory } from '@test/factories/ibama/ibama-dump.factory.js';
import type { IbamaRecord } from '../../domain/dtos/providers/ibama-dump.dto.js';
import {
  NORMALIZATION_CHUNK_SIZE,
  NormalizeIbamaRecordsUseCase,
} from './normalize-ibama-records.usecase.js';

async function* stream(records: readonly IbamaRecord[]) {
  for (const record of records) yield await Promise.resolve(record);
}

describe('NormalizeIbamaRecordsUseCase', () => {
  const write = vi.fn<EvidenceBatch['write']>();
  const finish = vi.fn<EvidenceBatch['finish']>();
  const batch: EvidenceBatch = { sourceSlug: 'IBAMA', write, finish };
  let useCase: NormalizeIbamaRecordsUseCase;

  const written = (): EvidenceBatchEntry[] =>
    write.mock.calls.flatMap(([entries]) => [...entries]);

  beforeEach(async () => {
    write.mockImplementation((entries) => Promise.resolve(entries.length));
    finish.mockResolvedValue({ removed: 0, affectedCnpjs: [] });
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [NormalizeIbamaRecordsUseCase],
    }).compile();

    useCase = moduleRef.get(NormalizeIbamaRecordsUseCase);
  });

  it('grava uma evidência por registro, na ordem do dump', async () => {
    const records = ibamaRecordFactory.buildMany(3);

    const output = await useCase.execute({ records: stream(records), batch });

    expect(written().map(({ finding }) => finding.reference)).toEqual(
      records.map(({ reference }) => reference),
    );
    expect(output).toEqual({ read: 3, annulled: 0, written: 3 });
  });

  it('pula os registros anulados e os conta', async () => {
    const [valid, cancelled, excluded] = [
      ibamaRecordFactory.build(),
      ibamaRecordFactory.build({
        payload: { SIT_CANCELADO: 'S', NUM_AUTO_INFRACAO: '2' },
      }),
      ibamaRecordFactory.build({
        payload: { DES_STATUS_FORMULARIO: 'Excluído', NUM_AUTO_INFRACAO: '3' },
      }),
    ];

    const output = await useCase.execute({
      records: stream([valid, cancelled, excluded]),
      batch,
    });

    expect(written()).toHaveLength(1);
    expect(written()[0].finding.reference).toBe(valid.reference);
    expect(output).toEqual({ read: 3, annulled: 2, written: 1 });
  });

  it('grava em lotes, e a memória não acompanha o tamanho do dump', async () => {
    const total = NORMALIZATION_CHUNK_SIZE * 2 + 37;

    const output = await useCase.execute({
      records: stream(ibamaRecordFactory.buildMany(total)),
      batch,
    });

    expect(write.mock.calls.map(([entries]) => entries.length)).toEqual([
      NORMALIZATION_CHUNK_SIZE,
      NORMALIZATION_CHUNK_SIZE,
      37,
    ]);
    expect(output.written).toBe(total);
  });

  it('o lote cheio é gravado antes de ler o seguinte', async () => {
    const order: string[] = [];
    write.mockImplementation((entries) => {
      order.push(`write:${entries.length}`);

      return Promise.resolve(entries.length);
    });
    async function* tracked() {
      for (const record of ibamaRecordFactory.buildMany(
        NORMALIZATION_CHUNK_SIZE + 1,
      )) {
        order.push('read');
        yield await Promise.resolve(record);
      }
    }

    await useCase.execute({ records: tracked(), batch });

    expect(order.indexOf(`write:${NORMALIZATION_CHUNK_SIZE}`)).toBe(
      NORMALIZATION_CHUNK_SIZE,
    );
  });

  it('um lote só de anulados não grava nada', async () => {
    const output = await useCase.execute({
      records: stream(
        ibamaRecordFactory.buildMany(5, { payload: { SIT_CANCELADO: 'S' } }),
      ),
      batch,
    });

    expect(write).not.toHaveBeenCalled();
    expect(output).toEqual({ read: 5, annulled: 5, written: 0 });
  });

  it('dump vazio: nada lido, nada gravado', async () => {
    await expect(
      useCase.execute({ records: stream([]), batch }),
    ).resolves.toEqual({ read: 0, annulled: 0, written: 0 });
    expect(write).not.toHaveBeenCalled();
  });

  it('soma o que a carga gravou (chaves repetidas num lote valem uma)', async () => {
    write.mockImplementation((entries) => Promise.resolve(entries.length - 1));

    const output = await useCase.execute({
      records: stream(ibamaRecordFactory.buildMany(10)),
      batch,
    });

    expect(output.written).toBe(9);
  });

  it('não encerra a carga: remover o que o dump não listou é de quem orquestra', async () => {
    await useCase.execute({
      records: stream(ibamaRecordFactory.buildMany(3)),
      batch,
    });

    expect(finish).not.toHaveBeenCalled();
  });

  it('registra o progresso a cada 50 mil registros lidos', async () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    const base = ibamaRecordFactory.build();
    async function* many() {
      for (let i = 0; i < 100_001; i++) yield await Promise.resolve(base);
    }

    await useCase.execute({ records: many(), batch });

    const progress = log.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes('registros lidos'));
    expect(progress).toHaveLength(2);
    expect(progress[0]).toContain('50000 registros');
    expect(progress[1]).toContain('100000 registros');
  }, 30_000);

  it('propaga a falha da gravação, sem seguir lendo', async () => {
    write.mockRejectedValue(new Error('banco fora'));
    let read = 0;
    async function* counting() {
      for (const record of ibamaRecordFactory.buildMany(
        NORMALIZATION_CHUNK_SIZE * 3,
      )) {
        read += 1;
        yield await Promise.resolve(record);
      }
    }

    await expect(
      useCase.execute({ records: counting(), batch }),
    ).rejects.toThrow('banco fora');

    expect(read).toBe(NORMALIZATION_CHUNK_SIZE);
  });

  it('propaga a falha da leitura do dump', async () => {
    async function* failing() {
      yield await Promise.resolve(ibamaRecordFactory.build());
      throw new Error('dump cortado');
    }

    await expect(
      useCase.execute({ records: failing(), batch }),
    ).rejects.toThrow('dump cortado');
  });
});
