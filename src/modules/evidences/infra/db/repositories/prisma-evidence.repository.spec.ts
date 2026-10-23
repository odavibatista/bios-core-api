import { Test } from '@nestjs/testing';
import { EvidenceState, Prisma } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { faker } from '@test/support/faker.js';
import type { EvidenceToSave } from '../../../domain/dtos/repositories/evidence.repository.js';
import { PrismaEvidenceRepository } from './prisma-evidence.repository.js';

describe('PrismaEvidenceRepository', () => {
  const upsert = vi.fn();
  const create = vi.fn();
  const findUnique = vi.fn();
  const clockFindUnique = vi.fn();
  const clockUpsert = vi.fn();
  const clockUpdateMany = vi.fn();
  const clockCreate = vi.fn();
  const deleteMany = vi.fn();
  const updateMany = vi.fn();
  const findFirst = vi.fn();
  const findMany = vi.fn();
  let repository: PrismaEvidenceRepository;

  const evidence: EvidenceToSave = {
    key: 'IBAMA:11222333000181:AI-1',
    cnpj: '11222333000181',
    dataSourceId: faker.database.mongodbObjectId(),
    odsId: faker.database.mongodbObjectId(),
    category: 'INFRACAO_AMBIENTAL',
    state: 'CONFIRMED',
    signal: 'NEGATIVE',
    summary: 'Multa',
    sourceReference: 'AI-1',
    sourceUrl: 'https://dados.example/ai-1',
    details: { valor: 10 },
    publishedAt: new Date('2025-03-01T00:00:00.000Z'),
    collectedAt: new Date('2026-10-20T00:00:00.000Z'),
    validUntil: new Date('2026-10-22T00:00:00.000Z'),
    rawEvidenceId: faker.database.mongodbObjectId(),
  };

  function uniqueViolation() {
    return new Prisma.PrismaClientKnownRequestError('duplicada', {
      code: 'P2002',
      clientVersion: 'test',
    });
  }

  beforeEach(async () => {
    const prismaMock = {
      evidenceNormalized: {
        upsert,
        create,
        findUnique,
        deleteMany,
        updateMany,
        findFirst,
        findMany,
      },
      evidenceCollectionClock: {
        findUnique: clockFindUnique,
        upsert: clockUpsert,
        updateMany: clockUpdateMany,
        create: clockCreate,
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaEvidenceRepository,
        {
          provide: PrismaService,
          useValue: {
            ...prismaMock,
            $transaction: (
              callback: (tx: typeof prismaMock) => Promise<unknown>,
            ) => callback(prismaMock),
          },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaEvidenceRepository);
    clockFindUnique.mockResolvedValue(null);
    clockUpsert.mockResolvedValue({});
    clockUpdateMany.mockResolvedValue({ count: 0 });
    clockCreate.mockResolvedValue({});
    findUnique.mockResolvedValue(null);
    updateMany.mockResolvedValue({ count: 0 });
    create.mockResolvedValue({});
    upsert.mockResolvedValue({});
    deleteMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue(null);
  });

  describe('save', () => {
    it.each(['empresa', 'dump completo'])(
      'ignora linha do lote anterior ao relógio da %s',
      async (scope) => {
        clockFindUnique.mockImplementation(
          ({ where }: { where: { scope_key: string } }) =>
            Promise.resolve(
              where.scope_key.endsWith(
                scope === 'empresa' ? evidence.cnpj : ':*',
              )
                ? { collected_at: new Date(evidence.collectedAt.getTime() + 1) }
                : null,
            ),
        );
        await repository.save(evidence);
        expect(clockUpsert).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
      },
    );

    it('atualiza chave existente somente até a data da coleta', async () => {
      updateMany.mockResolvedValue({ count: 1 });
      await repository.save(evidence);
      expect(create).not.toHaveBeenCalled();
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            evidence_key: evidence.key,
            collected_at: { lte: evidence.collectedAt },
          },
        }),
      );
    });

    it('não recria chave existente mais nova', async () => {
      findUnique.mockResolvedValue({ id_evidence: 'mais-nova' });
      await repository.save(evidence);
      expect(create).not.toHaveBeenCalled();
    });
    it('cria ou atualiza pela chave, com todos os campos', async () => {
      await repository.save(evidence);

      const expected = {
        cnpj: evidence.cnpj,
        data_source_id: evidence.dataSourceId,
        ods_id: evidence.odsId,
        category: 'INFRACAO_AMBIENTAL',
        state: 'CONFIRMED',
        signal: 'NEGATIVE',
        summary: 'Multa',
        source_reference: 'AI-1',
        source_url: 'https://dados.example/ai-1',
        details: { valor: 10 },
        published_at: evidence.publishedAt,
        collected_at: evidence.collectedAt,
        valid_until: evidence.validUntil,
        evidence_raw_id: evidence.rawEvidenceId,
      };
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          evidence_key: evidence.key,
          collected_at: { lte: evidence.collectedAt },
        },
        data: expected,
      });
      expect(create).toHaveBeenCalledWith({
        data: { evidence_key: evidence.key, ...expected },
      });
    });

    it('o campo que a coleta não traz é gravado como null, e não omitido', async () => {
      await repository.save({
        ...evidence,
        summary: null,
        sourceUrl: null,
        details: null,
        publishedAt: null,
        rawEvidenceId: null,
      });

      const [{ data }] = updateMany.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      for (const field of [
        'summary',
        'source_url',
        'details',
        'published_at',
        'evidence_raw_id',
      ]) {
        expect(data).toHaveProperty(field, null);
      }
    });

    it('nunca regrava a data de criação', async () => {
      await repository.save(evidence);

      const [{ data }] = updateMany.mock.calls[0] as [{ data: object }];
      expect(data).not.toHaveProperty('created_at');
      expect(create.mock.calls[0][0].data).not.toHaveProperty('created_at');
    });

    it('se a criação disputada perde para outra gravação (índice único), tenta de novo', async () => {
      create.mockRejectedValueOnce(uniqueViolation());

      await expect(repository.save(evidence)).resolves.toBeUndefined();

      expect(create).toHaveBeenCalledTimes(2);
    });

    it('não esconde falha na repetição após disputa de criação', async () => {
      create.mockRejectedValue(uniqueViolation());

      await expect(repository.save(evidence)).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      expect(create).toHaveBeenCalledTimes(12);
    });

    it('propaga qualquer outra falha, sem repetir', async () => {
      create.mockRejectedValue(new Error('banco fora'));

      await expect(repository.save(evidence)).rejects.toThrow('banco fora');
      expect(create).toHaveBeenCalledOnce();
    });
  });

  describe('replaceSnapshot', () => {
    it('ignora retrato anterior ao relógio sem modificar o banco', async () => {
      clockFindUnique.mockResolvedValue({
        collected_at: new Date(evidence.collectedAt.getTime() + 1),
      });
      await expect(
        repository.replaceSnapshot(
          evidence.cnpj,
          evidence.dataSourceId,
          evidence.collectedAt,
          [evidence],
        ),
      ).resolves.toEqual({ saved: 0, removed: 0 });
      expect(upsert).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it('grava e remove um retrato na mesma transação e avança o relógio', async () => {
      deleteMany.mockResolvedValue({ count: 2 });
      await expect(
        repository.replaceSnapshot(
          evidence.cnpj,
          evidence.dataSourceId,
          evidence.collectedAt,
          [evidence],
        ),
      ).resolves.toEqual({ saved: 1, removed: 2 });
      expect(clockUpsert).toHaveBeenCalledOnce();
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { evidence_key: evidence.key } }),
      );
      expect(deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            cnpj: evidence.cnpj,
            data_source_id: evidence.dataSourceId,
          }),
        }),
      );
    });

    it('não troca resposta confirmada por UNKNOWN', async () => {
      findFirst.mockResolvedValue({ id_evidence: 'respondida' });
      await expect(
        repository.replaceSnapshot(
          evidence.cnpj,
          evidence.dataSourceId,
          evidence.collectedAt,
          [evidence],
          true,
        ),
      ).resolves.toEqual({ saved: 0, removed: 0 });
      expect(clockUpsert).not.toHaveBeenCalled();
    });

    it('UNKNOWN não avança a versão de uma resposta da fonte', async () => {
      await repository.replaceSnapshot(
        evidence.cnpj,
        evidence.dataSourceId,
        evidence.collectedAt,
        [evidence],
        true,
      );
      expect(clockUpsert).not.toHaveBeenCalled();
      expect(deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ collected_at: { lte: evidence.collectedAt } }],
          }),
        }),
      );
    });

    it('repete disputa de criação do relógio e reavalia o retrato', async () => {
      clockUpsert.mockRejectedValueOnce(uniqueViolation());
      await expect(
        repository.replaceSnapshot(
          evidence.cnpj,
          evidence.dataSourceId,
          evidence.collectedAt,
          [evidence],
        ),
      ).resolves.toEqual({ saved: 1, removed: 0 });
      expect(clockUpsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('findCnpjsNotCollectedSince (#80)', () => {
    it('devolve os CNPJs distintos da fonte com evidência coletada antes do corte', async () => {
      findMany.mockResolvedValue([
        { cnpj: '00000000000191' },
        { cnpj: '11222333000181' },
      ]);
      const sourceId = faker.database.mongodbObjectId();
      const before = faker.date.recent();

      await expect(
        repository.findCnpjsNotCollectedSince(sourceId, before),
      ).resolves.toEqual(['00000000000191', '11222333000181']);

      expect(findMany).toHaveBeenCalledWith({
        where: { data_source_id: sourceId, collected_at: { lt: before } },
        select: { cnpj: true },
        distinct: ['cnpj'],
      });
    });

    it('usa o mesmo filtro de deleteNotCollectedSince: lê o que ele removeria', async () => {
      findMany.mockResolvedValue([]);
      deleteMany.mockResolvedValue({ count: 0 });
      const sourceId = faker.database.mongodbObjectId();
      const before = faker.date.recent();

      await repository.findCnpjsNotCollectedSince(sourceId, before);
      await repository.deleteNotCollectedSince(sourceId, before);

      const [{ where: found }] = findMany.mock.calls.at(-1) as [
        { where: object },
      ];
      const [{ where: removed }] = deleteMany.mock.calls.at(-1) as [
        { where: object },
      ];
      expect(found).toEqual(removed);
    });
  });

  describe('deleteNotCollectedSince', () => {
    it('remove da fonte, de qualquer empresa, o que foi coletado antes do corte', async () => {
      deleteMany.mockResolvedValue({ count: 7 });
      const sourceId = faker.database.mongodbObjectId();
      const before = faker.date.recent();

      await expect(
        repository.deleteNotCollectedSince(sourceId, before),
      ).resolves.toBe(7);

      expect(deleteMany).toHaveBeenCalledWith({
        where: { data_source_id: sourceId, collected_at: { lt: before } },
      });
    });

    it('não filtra por empresa', async () => {
      deleteMany.mockResolvedValue({ count: 0 });

      await repository.deleteNotCollectedSince(
        faker.database.mongodbObjectId(),
        faker.date.recent(),
      );

      const [{ where }] = deleteMany.mock.calls[0] as [{ where: object }];
      expect(where).not.toHaveProperty('cnpj');
    });
  });

  describe('renewValidity', () => {
    it('renova a coleta e a validade só das evidências que ainda respondem, da fonte', async () => {
      updateMany.mockResolvedValue({ count: 12 });
      const sourceId = faker.database.mongodbObjectId();
      const collectedAt = faker.date.recent();
      const validUntil = faker.date.soon();

      await expect(
        repository.renewValidity(sourceId, collectedAt, validUntil),
      ).resolves.toBe(12);

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          data_source_id: sourceId,
          state: { in: [EvidenceState.CONFIRMED, EvidenceState.NOT_FOUND] },
          collected_at: { lte: collectedAt },
        },
        data: { collected_at: collectedAt, valid_until: validUntil },
      });
    });

    it('não filtra por empresa: a renovação vale para a fonte inteira', async () => {
      updateMany.mockResolvedValue({ count: 0 });

      await repository.renewValidity(
        faker.database.mongodbObjectId(),
        faker.date.recent(),
        faker.date.soon(),
      );

      const [{ where }] = updateMany.mock.calls[0] as [{ where: object }];
      expect(where).not.toHaveProperty('cnpj');
    });
  });

  describe('hasAnsweredCollection', () => {
    it('procura CONFIRMED ou NOT_FOUND da empresa e da fonte (UNKNOWN não conta)', async () => {
      findFirst.mockResolvedValue({ id_evidence: 'x' });
      const cnpj = buildCnpj();
      const sourceId = faker.database.mongodbObjectId();

      await repository.hasAnsweredCollection(cnpj, sourceId);

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          cnpj,
          data_source_id: sourceId,
          state: { in: [EvidenceState.CONFIRMED, EvidenceState.NOT_FOUND] },
        },
        select: { id_evidence: true },
      });
    });

    it('verdadeiro quando existe, falso quando não', async () => {
      findFirst.mockResolvedValueOnce({ id_evidence: 'x' });
      await expect(repository.hasAnsweredCollection('a', 'b')).resolves.toBe(
        true,
      );

      findFirst.mockResolvedValueOnce(null);
      await expect(repository.hasAnsweredCollection('a', 'b')).resolves.toBe(
        false,
      );
    });
  });

  describe('findByCnpj', () => {
    function buildDocument(overrides: Record<string, unknown> = {}) {
      return {
        id_evidence: faker.database.mongodbObjectId(),
        evidence_key: 'IBAMA:11222333000181:AI-1',
        cnpj: '11222333000181',
        data_source_id: faker.database.mongodbObjectId(),
        evidence_raw_id: faker.database.mongodbObjectId(),
        ods_id: faker.database.mongodbObjectId(),
        category: 'INFRACAO_AMBIENTAL',
        state: 'CONFIRMED',
        signal: 'NEGATIVE',
        summary: 'Multa',
        source_reference: 'AI-1',
        source_url: 'https://dados.example/ai-1',
        details: { valor: 10 },
        published_at: new Date('2025-03-01T00:00:00.000Z'),
        collected_at: new Date('2026-10-20T00:00:00.000Z'),
        valid_until: new Date('2026-10-22T00:00:00.000Z'),
        created_at: new Date(),
        updated_at: new Date(),
        data_source: { slug: 'IBAMA', name: 'IBAMA — Dados Abertos' },
        ods: { ods_number: 15 },
        ...overrides,
      };
    }

    it('procura pelo CNPJ, trazendo o slug da fonte e o número do ODS', async () => {
      findMany.mockResolvedValue([]);
      const cnpj = buildCnpj();

      await repository.findByCnpj(cnpj);

      expect(findMany).toHaveBeenCalledWith({
        where: { cnpj },
        include: {
          data_source: { select: { slug: true, name: true } },
          ods: { select: { ods_number: true } },
        },
        orderBy: [{ collected_at: 'desc' }, { evidence_key: 'asc' }],
      });
    });

    it('devolve as evidências no formato do domínio', async () => {
      const document = buildDocument();
      findMany.mockResolvedValue([document]);

      await expect(repository.findByCnpj('11222333000181')).resolves.toEqual([
        {
          id: document.id_evidence,
          key: 'IBAMA:11222333000181:AI-1',
          cnpj: '11222333000181',
          sourceSlug: 'IBAMA',
          sourceName: 'IBAMA — Dados Abertos',
          category: 'INFRACAO_AMBIENTAL',
          odsNumber: 15,
          state: 'CONFIRMED',
          signal: 'NEGATIVE',
          summary: 'Multa',
          sourceReference: 'AI-1',
          sourceUrl: 'https://dados.example/ai-1',
          details: { valor: 10 },
          publishedAt: document.published_at,
          collectedAt: document.collected_at,
          validUntil: document.valid_until,
          rawEvidenceId: document.evidence_raw_id,
        },
      ]);
    });

    it('campo ausente no documento (MongoDB) volta como null', async () => {
      const document: Record<string, unknown> = buildDocument();
      for (const field of [
        'summary',
        'source_reference',
        'source_url',
        'details',
        'published_at',
        'evidence_raw_id',
      ]) {
        delete document[field];
      }
      findMany.mockResolvedValue([document]);

      const [stored] = await repository.findByCnpj('11222333000181');

      expect(stored).toMatchObject({
        summary: null,
        sourceReference: null,
        sourceUrl: null,
        details: null,
        publishedAt: null,
        rawEvidenceId: null,
      });
    });

    it('sem evidências, devolve a lista vazia', async () => {
      findMany.mockResolvedValue([]);

      await expect(repository.findByCnpj('11222333000181')).resolves.toEqual(
        [],
      );
    });
  });
});
