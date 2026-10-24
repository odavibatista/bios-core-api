import { Logger } from '@nestjs/common';
import {
  IBAMA_CNPJ,
  IBAMA_OTHER_CNPJ,
} from '@test/factories/ibama/ibama-dump.factory.js';
import { Test } from '@nestjs/testing';
import { RequestScoreRecalculationBatchUseCase } from '@modules/scoring/infra/usecases/request-score-recalculation-batch.usecase.js';
import { IngestionRunStatus, RequestTrigger } from '@prisma/client';
import {
  type SourceLookupResult,
  type SourceUnavailableReason,
} from '@modules/data-sources/domain/data-source.interface.js';
import { SourceOutcome } from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import { FindLastSucceededIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/find-last-succeeded-ingestion-run.usecase.js';
import { FinishIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/finish-ingestion-run.usecase.js';
import { OpenIngestionRunUseCase } from '@modules/data-sources/infra/usecases/ingestion/open-ingestion-run.usecase.js';
import type { EvidenceBatch } from '@modules/evidences/domain/dtos/providers/evidence-batch.dto.js';
import { OpenEvidenceBatchUseCase } from '@modules/evidences/infra/usecases/open-evidence-batch.usecase.js';
import { RenewSourceEvidencesUseCase } from '@modules/evidences/infra/usecases/renew-source-evidences.usecase.js';
import { ingestionRunFactory } from '@test/factories/data-sources/ingestion-run.factory.js';
import {
  buildFakeDump,
  buildReadStats,
  type FakeIbamaDump,
} from '@test/factories/ibama/ibama-fake-dump.factory.js';
import { faker } from '@test/support/faker.js';
import {
  IbamaDumpUnavailableError,
  IbamaSourceDisabledError,
} from '../../domain/dtos/errors/ibama-ingestion.errors.js';
import {
  IbamaDumpFormatError,
  type IbamaDump,
} from '../../domain/dtos/providers/ibama-dump.dto.js';
import { IbamaDiscardReason } from '../../domain/ibama-document.js';
import { combineDumpChecksums } from '../../domain/ibama-dump-checksum.js';
import { IbamaResource } from '../../domain/ibama-resource.js';
import { IbamaDataSource } from '../providers/ibama.data-source.js';
import { IngestIbamaDumpsUseCase } from './ingest-ibama-dumps.usecase.js';
import { NormalizeIbamaRecordsUseCase } from './normalize-ibama-records.usecase.js';

const { AUTO_INFRACAO, TERMO_EMBARGO } = IbamaResource;

describe('IngestIbamaDumpsUseCase', () => {
  const ibamaDataSource = { download: vi.fn<IbamaDataSource['download']>() };
  const openRun = { execute: vi.fn<OpenIngestionRunUseCase['execute']>() };
  const finishRun = { execute: vi.fn<FinishIngestionRunUseCase['execute']>() };
  const findLast = {
    execute: vi.fn<FindLastSucceededIngestionRunUseCase['execute']>(),
  };
  const openBatch = { execute: vi.fn<OpenEvidenceBatchUseCase['execute']>() };
  const normalize = {
    execute: vi.fn<NormalizeIbamaRecordsUseCase['execute']>(),
  };
  const renew = { execute: vi.fn<RenewSourceEvidencesUseCase['execute']>() };
  const requestScores = {
    execute: vi.fn<RequestScoreRecalculationBatchUseCase['execute']>(),
  };
  const affected = [IBAMA_CNPJ, IBAMA_OTHER_CNPJ];
  const batch = {
    sourceSlug: 'IBAMA',
    write: vi.fn<EvidenceBatch['write']>(),
    finish: vi.fn<EvidenceBatch['finish']>(),
  };

  let useCase: IngestIbamaDumpsUseCase;
  let calls: string[];
  let autos: FakeIbamaDump;
  let embargos: FakeIbamaDump;
  let downloads: Record<IbamaResource, SourceLookupResult<IbamaDump>>;
  let normalized: Record<
    IbamaResource,
    { read: number; annulled: number; written: number }
  >;

  const jobId = `repeat:ibama-daily-ingestion:${faker.number.int()}`;
  const run = ingestionRunFactory.build({ status: IngestionRunStatus.RUNNING });

  function found(dump: IbamaDump): SourceLookupResult<IbamaDump> {
    return { status: 'FOUND', data: dump };
  }

  function unavailable(
    message: string,
    reason: SourceUnavailableReason = SourceOutcome.FAILURE,
  ): SourceLookupResult<IbamaDump> {
    return { status: 'UNAVAILABLE', reason, message };
  }

  function resourceOf(records: unknown): IbamaResource {
    return records === autos.stream ? AUTO_INFRACAO : TERMO_EMBARGO;
  }

  beforeEach(async () => {
    calls = [];
    autos = buildFakeDump(AUTO_INFRACAO);
    embargos = buildFakeDump(TERMO_EMBARGO);
    downloads = { AUTO_INFRACAO: found(autos), TERMO_EMBARGO: found(embargos) };
    normalized = {
      AUTO_INFRACAO: { read: 10, annulled: 0, written: 10 },
      TERMO_EMBARGO: { read: 5, annulled: 0, written: 5 },
    };

    openRun.execute.mockImplementation(() => {
      calls.push('abre a execução');

      return Promise.resolve(run);
    });
    ibamaDataSource.download.mockImplementation((resource) => {
      calls.push(`baixa ${resource}`);

      return Promise.resolve(downloads[resource]);
    });
    findLast.execute.mockImplementation(() => {
      calls.push('busca a última bem-sucedida');

      return Promise.resolve(null);
    });
    openBatch.execute.mockImplementation(() => {
      calls.push('abre a carga');

      return Promise.resolve(batch);
    });
    normalize.execute.mockImplementation(({ records }) => {
      const resource = resourceOf(records);
      calls.push(`normaliza ${resource}`);

      return Promise.resolve(normalized[resource]);
    });
    batch.finish.mockImplementation(() => {
      calls.push('encerra a carga');

      return Promise.resolve({ removed: 4, affectedCnpjs: affected });
    });
    requestScores.execute.mockImplementation(() => {
      calls.push('pede o recálculo dos índices');

      return Promise.resolve({ requested: affected.length, degraded: 0 });
    });
    finishRun.execute.mockImplementation(({ status }) => {
      calls.push(`encerra a execução ${status}`);

      return Promise.resolve();
    });
    renew.execute.mockImplementation(() => {
      calls.push('renova a validade');

      return Promise.resolve(321);
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        IngestIbamaDumpsUseCase,
        { provide: IbamaDataSource, useValue: ibamaDataSource },
        { provide: OpenIngestionRunUseCase, useValue: openRun },
        { provide: FinishIngestionRunUseCase, useValue: finishRun },
        { provide: FindLastSucceededIngestionRunUseCase, useValue: findLast },
        { provide: OpenEvidenceBatchUseCase, useValue: openBatch },
        { provide: NormalizeIbamaRecordsUseCase, useValue: normalize },
        { provide: RenewSourceEvidencesUseCase, useValue: renew },
        {
          provide: RequestScoreRecalculationBatchUseCase,
          useValue: requestScores,
        },
      ],
    }).compile();

    useCase = moduleRef.get(IngestIbamaDumpsUseCase);
  });

  describe('dump novo', () => {
    it('segue a ordem: abre a execução, baixa os dois, compara, abre a carga, normaliza os dois, encerra a carga e a execução', async () => {
      await useCase.execute({ jobId });

      expect(calls).toEqual([
        'abre a execução',
        'baixa AUTO_INFRACAO',
        'baixa TERMO_EMBARGO',
        'busca a última bem-sucedida',
        'abre a carga',
        'normaliza AUTO_INFRACAO',
        'normaliza TERMO_EMBARGO',
        'encerra a carga',
        'pede o recálculo dos índices',
        'encerra a execução SUCCEEDED',
      ]);
    });

    it('pede o recálculo só das empresas que a carga alterou (gravadas e removidas), antes de encerrar a execução', async () => {
      await useCase.execute({ jobId });

      expect(requestScores.execute).toHaveBeenCalledExactlyOnceWith(affected);
    });

    it('fila sem aceitar alguns pedidos não derruba a ingestão: avisa e encerra bem-sucedida', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      requestScores.execute.mockResolvedValue({ requested: 1, degraded: 1 });

      const result = await useCase.execute({ jobId });

      expect(result.outcome).toBe('SUCCEEDED');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('1 empresa(s) sem recálculo'),
      );
    });

    it('abre a execução do job na fonte IBAMA e dá a ela o início como data de coleta da carga', async () => {
      await useCase.execute({ jobId });

      const [{ sourceSlug, jobId: openedJob, startedAt }] =
        openRun.execute.mock.calls[0];
      expect(sourceSlug).toBe('IBAMA');
      expect(openedJob).toBe(jobId);
      expect(openBatch.execute).toHaveBeenCalledWith({
        sourceSlug: 'IBAMA',
        collectedAt: startedAt,
        ingestionRunId: run.id,
      });
    });

    it('baixa os dois recursos como job agendado, ligando cada chamada à execução', async () => {
      await useCase.execute({ jobId });

      const context = {
        trigger: RequestTrigger.SCHEDULED_JOB,
        ingestionRunId: run.id,
      };
      expect(ibamaDataSource.download).toHaveBeenCalledWith(
        AUTO_INFRACAO,
        context,
      );
      expect(ibamaDataSource.download).toHaveBeenCalledWith(
        TERMO_EMBARGO,
        context,
      );
    });

    it('normaliza o fluxo de cada dump na mesma carga', async () => {
      await useCase.execute({ jobId });

      expect(normalize.execute).toHaveBeenCalledWith({
        records: autos.stream,
        batch,
      });
      expect(normalize.execute).toHaveBeenCalledWith({
        records: embargos.stream,
        batch,
      });
    });

    it('registra o checksum combinado e as contagens: lidas, gravadas e descartadas mais anuladas', async () => {
      autos.stats = buildReadStats({
        rows: 100,
        kept: 70,
        discarded: {
          [IbamaDiscardReason.PESSOA_FISICA]: 20,
          [IbamaDiscardReason.SEM_DOCUMENTO]: 5,
          [IbamaDiscardReason.DOCUMENTO_INVALIDO]: 0,
          [IbamaDiscardReason.REGISTRO_MALFORMADO]: 5,
        },
      });
      embargos.stats = buildReadStats({
        rows: 40,
        kept: 37,
        discarded: {
          [IbamaDiscardReason.PESSOA_FISICA]: 3,
          [IbamaDiscardReason.SEM_DOCUMENTO]: 0,
          [IbamaDiscardReason.DOCUMENTO_INVALIDO]: 0,
          [IbamaDiscardReason.REGISTRO_MALFORMADO]: 0,
        },
      });
      normalized = {
        AUTO_INFRACAO: { read: 70, annulled: 7, written: 60 },
        TERMO_EMBARGO: { read: 37, annulled: 2, written: 35 },
      };

      const result = await useCase.execute({ jobId });

      // Descartes: 20 + 5 + 5 + 3 pelas regras do dump, mais 7 + 2 anulados.
      const expected = {
        runId: run.id,
        status: IngestionRunStatus.SUCCEEDED,
        dumpChecksum: combineDumpChecksums([autos, embargos]),
        recordsRead: 140,
        recordsUpserted: 95,
        recordsDiscarded: 42,
      };
      expect(finishRun.execute).toHaveBeenCalledWith(expected);
      expect(result).toEqual({
        outcome: 'SUCCEEDED',
        ingestionRunId: run.id,
        dumpChecksum: expected.dumpChecksum,
        recordsRead: 140,
        recordsUpserted: 95,
        recordsDiscarded: 42,
        removed: 4,
        renewed: 0,
      });
    });

    it('compara com a última execução bem-sucedida da fonte', async () => {
      await useCase.execute({ jobId });

      expect(findLast.execute).toHaveBeenCalledWith('IBAMA');
    });

    it('processa um dump diferente do da última execução bem-sucedida', async () => {
      findLast.execute.mockResolvedValue(
        ingestionRunFactory.build({
          dumpChecksum: combineDumpChecksums([autos, embargos]),
        }),
      );
      embargos.checksum = faker.string.hexadecimal({
        length: 64,
        casing: 'lower',
        prefix: '',
      });

      const result = await useCase.execute({ jobId });

      expect(result.outcome).toBe('SUCCEEDED');
      expect(normalize.execute).toHaveBeenCalledTimes(2);
      expect(renew.execute).not.toHaveBeenCalled();
    });

    it('processa na primeira execução, quando a fonte nunca teve uma bem-sucedida', async () => {
      findLast.execute.mockResolvedValue(null);

      await expect(useCase.execute({ jobId })).resolves.toMatchObject({
        outcome: 'SUCCEEDED',
      });
    });
  });

  describe('dump idêntico ao da última execução', () => {
    beforeEach(() => {
      findLast.execute.mockImplementation(() => {
        calls.push('busca a última bem-sucedida');

        return Promise.resolve(
          ingestionRunFactory.build({
            dumpChecksum: combineDumpChecksums([autos, embargos]),
          }),
        );
      });
    });

    it('encerra como SKIPPED_UNCHANGED sem normalizar nem encerrar carga', async () => {
      const result = await useCase.execute({ jobId });

      expect(calls).toEqual([
        'abre a execução',
        'baixa AUTO_INFRACAO',
        'baixa TERMO_EMBARGO',
        'busca a última bem-sucedida',
        'renova a validade',
        'encerra a execução SKIPPED_UNCHANGED',
      ]);
      expect(openBatch.execute).not.toHaveBeenCalled();
      expect(normalize.execute).not.toHaveBeenCalled();
      expect(batch.finish).not.toHaveBeenCalled();
      // Dump idêntico: nada mudou além da validade, então não há o que recalcular.
      expect(requestScores.execute).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        outcome: 'SKIPPED_UNCHANGED',
        recordsRead: 0,
        recordsUpserted: 0,
        recordsDiscarded: 0,
        removed: 0,
        renewed: 321,
      });
    });

    it('renova a validade das evidências com o início desta execução', async () => {
      await useCase.execute({ jobId });

      const [{ startedAt }] = openRun.execute.mock.calls[0];
      expect(renew.execute).toHaveBeenCalledWith({
        sourceSlug: 'IBAMA',
        collectedAt: startedAt,
      });
    });

    it('registra o checksum e as contagens zeradas', async () => {
      await useCase.execute({ jobId });

      expect(finishRun.execute).toHaveBeenCalledWith({
        runId: run.id,
        status: IngestionRunStatus.SKIPPED_UNCHANGED,
        dumpChecksum: combineDumpChecksums([autos, embargos]),
        recordsRead: 0,
        recordsUpserted: 0,
        recordsDiscarded: 0,
      });
    });
  });

  describe('dump que não pôde ser baixado', () => {
    it('um recurso indisponível falha o job, sem encerrar a carga, e apaga o que já baixou', async () => {
      downloads.TERMO_EMBARGO = unavailable('HTTP 503');

      await expect(useCase.execute({ jobId })).rejects.toThrow(
        IbamaDumpUnavailableError,
      );

      expect(batch.finish).not.toHaveBeenCalled();
      expect(openBatch.execute).not.toHaveBeenCalled();
      expect(finishRun.execute).not.toHaveBeenCalled();
      expect(autos.dispose).toHaveBeenCalledOnce();
    });

    it('tenta os dois recursos antes de desistir, e a mensagem diz qual falhou e por quê', async () => {
      downloads.AUTO_INFRACAO = unavailable('HTTP 503');

      const failure = await useCase.execute({ jobId }).catch((e: unknown) => e);

      expect(ibamaDataSource.download).toHaveBeenCalledTimes(2);
      expect(failure).toBeInstanceOf(IbamaDumpUnavailableError);
      expect((failure as Error).message).toContain('AUTO_INFRACAO: HTTP 503');
      expect((failure as Error).message).not.toContain('TERMO_EMBARGO');
      expect(embargos.dispose).toHaveBeenCalledOnce();
    });

    it('os dois indisponíveis: a mensagem traz os dois motivos', async () => {
      downloads.AUTO_INFRACAO = unavailable('HTTP 503');
      downloads.TERMO_EMBARGO = unavailable(
        'tempo esgotado',
        SourceOutcome.TIMEOUT,
      );

      await expect(useCase.execute({ jobId })).rejects.toThrow(
        'AUTO_INFRACAO: HTTP 503; TERMO_EMBARGO: tempo esgotado',
      );
    });

    it('sem mensagem da fonte, o motivo é o resultado da chamada', async () => {
      downloads.AUTO_INFRACAO = {
        status: 'UNAVAILABLE',
        reason: SourceOutcome.RATE_LIMITED,
      };

      await expect(useCase.execute({ jobId })).rejects.toThrow(
        'AUTO_INFRACAO: RATE_LIMITED',
      );
    });

    it('um recurso "não encontrado" também falha o job', async () => {
      downloads.TERMO_EMBARGO = { status: 'NOT_FOUND' };

      await expect(useCase.execute({ jobId })).rejects.toThrow(
        'TERMO_EMBARGO: dump não encontrado',
      );
    });

    it('fonte desabilitada falha sem repetição útil e nem tenta o segundo recurso', async () => {
      downloads.AUTO_INFRACAO = {
        status: 'UNAVAILABLE',
        reason: SourceOutcome.DISABLED,
      };

      await expect(useCase.execute({ jobId })).rejects.toBeInstanceOf(
        IbamaSourceDisabledError,
      );

      expect(ibamaDataSource.download).toHaveBeenCalledTimes(1);
      expect(openBatch.execute).not.toHaveBeenCalled();
    });

    it('fonte desabilitada no segundo recurso apaga o primeiro', async () => {
      downloads.TERMO_EMBARGO = {
        status: 'UNAVAILABLE',
        reason: SourceOutcome.DISABLED,
      };

      await expect(useCase.execute({ jobId })).rejects.toBeInstanceOf(
        IbamaSourceDisabledError,
      );

      expect(autos.dispose).toHaveBeenCalledOnce();
    });
  });

  describe('falha no meio da carga', () => {
    it('erro ao normalizar o segundo recurso: a carga não é encerrada e os dois dumps são apagados', async () => {
      normalize.execute.mockImplementation(({ records }) => {
        if (resourceOf(records) === TERMO_EMBARGO) {
          return Promise.reject(new IbamaDumpFormatError('coluna ausente'));
        }

        return Promise.resolve(normalized.AUTO_INFRACAO);
      });

      await expect(useCase.execute({ jobId })).rejects.toThrow(
        IbamaDumpFormatError,
      );

      expect(batch.finish).not.toHaveBeenCalled();
      expect(finishRun.execute).not.toHaveBeenCalled();
      expect(autos.dispose).toHaveBeenCalledOnce();
      expect(embargos.dispose).toHaveBeenCalledOnce();
    });

    it('erro ao normalizar o primeiro recurso não toca o segundo', async () => {
      normalize.execute.mockRejectedValue(new Error('banco fora'));

      await expect(useCase.execute({ jobId })).rejects.toThrow('banco fora');

      expect(normalize.execute).toHaveBeenCalledOnce();
      expect(batch.finish).not.toHaveBeenCalled();
    });

    it('erro ao encerrar a carga não registra sucesso', async () => {
      batch.finish.mockRejectedValue(new Error('banco fora'));

      await expect(useCase.execute({ jobId })).rejects.toThrow('banco fora');

      expect(finishRun.execute).not.toHaveBeenCalled();
    });

    it('erro ao renovar a validade no skip não registra o skip', async () => {
      findLast.execute.mockResolvedValue(
        ingestionRunFactory.build({
          dumpChecksum: combineDumpChecksums([autos, embargos]),
        }),
      );
      renew.execute.mockRejectedValue(new Error('banco fora'));

      await expect(useCase.execute({ jobId })).rejects.toThrow('banco fora');

      expect(finishRun.execute).not.toHaveBeenCalled();
      expect(autos.dispose).toHaveBeenCalledOnce();
    });

    it('erro ao abrir a execução não baixa nada', async () => {
      openRun.execute.mockRejectedValue(new Error('banco fora'));

      await expect(useCase.execute({ jobId })).rejects.toThrow('banco fora');

      expect(ibamaDataSource.download).not.toHaveBeenCalled();
    });
  });

  describe('arquivos temporários', () => {
    it('são apagados depois de um lote bem-sucedido', async () => {
      await useCase.execute({ jobId });

      expect(autos.dispose).toHaveBeenCalledOnce();
      expect(embargos.dispose).toHaveBeenCalledOnce();
    });

    it('são apagados depois de um skip', async () => {
      findLast.execute.mockResolvedValue(
        ingestionRunFactory.build({
          dumpChecksum: combineDumpChecksums([autos, embargos]),
        }),
      );

      await useCase.execute({ jobId });

      expect(autos.dispose).toHaveBeenCalledOnce();
      expect(embargos.dispose).toHaveBeenCalledOnce();
    });

    it('apagar um dump que falha não impede de apagar o outro nem mascara o resultado', async () => {
      autos.dispose.mockRejectedValue(new Error('disco cheio'));

      await expect(useCase.execute({ jobId })).resolves.toMatchObject({
        outcome: 'SUCCEEDED',
      });

      expect(embargos.dispose).toHaveBeenCalledOnce();
    });

    it('só são apagados depois de a carga terminar', async () => {
      batch.finish.mockImplementation(() => {
        expect(autos.dispose).not.toHaveBeenCalled();
        expect(embargos.dispose).not.toHaveBeenCalled();

        return Promise.resolve({ removed: 0, affectedCnpjs: [] });
      });

      await useCase.execute({ jobId });

      expect(autos.dispose).toHaveBeenCalledOnce();
    });
  });
});
