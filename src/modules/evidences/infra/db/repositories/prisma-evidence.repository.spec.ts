import { Test } from '@nestjs/testing';
import { EvidenceState, Prisma } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { faker } from '@test/support/faker.js';
import type { EvidenceToSave } from '../../../domain/dtos/repositories/evidence.repository.js';
import { PrismaEvidenceRepository } from './prisma-evidence.repository.js';

describe('PrismaEvidenceRepository', () => {
  const upsert = vi.fn();
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
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaEvidenceRepository,
        {
          provide: PrismaService,
          useValue: {
            evidenceNormalized: {
              upsert,
              deleteMany,
              updateMany,
              findFirst,
              findMany,
            },
          },
        },
      ],
    }).compile();

    repository = moduleRef.get(PrismaEvidenceRepository);
  });

  describe('save', () => {
    it('cria ou atualiza pela chave, com todos os campos', async () => {
      upsert.mockResolvedValue({});

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
      expect(upsert).toHaveBeenCalledOnce();
      expect(upsert).toHaveBeenCalledWith({
        where: { evidence_key: evidence.key },
        create: { evidence_key: evidence.key, ...expected },
        update: expected,
      });
    });

    it('o campo que a coleta não traz é gravado como null, e não omitido', async () => {
      upsert.mockResolvedValue({});

      await repository.save({
        ...evidence,
        summary: null,
        sourceUrl: null,
        details: null,
        publishedAt: null,
        rawEvidenceId: null,
      });

      const [{ update }] = upsert.mock.calls[0] as [
        { update: Record<string, unknown> },
      ];
      for (const field of [
        'summary',
        'source_url',
        'details',
        'published_at',
        'evidence_raw_id',
      ]) {
        expect(update).toHaveProperty(field, null);
      }
    });

    it('nunca regrava a data de criação', async () => {
      upsert.mockResolvedValue({});

      await repository.save(evidence);

      const [{ update, create }] = upsert.mock.calls[0] as [
        { update: object; create: object },
      ];
      expect(update).not.toHaveProperty('created_at');
      expect(create).not.toHaveProperty('created_at');
    });

    it('se a criação disputada perde para outra gravação (índice único), tenta de novo', async () => {
      upsert.mockRejectedValueOnce(uniqueViolation()).mockResolvedValue({});

      await expect(repository.save(evidence)).resolves.toBeUndefined();

      expect(upsert).toHaveBeenCalledTimes(2);
    });

    it('não esconde a violação que se repete', async () => {
      upsert.mockRejectedValue(uniqueViolation());

      await expect(repository.save(evidence)).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      expect(upsert).toHaveBeenCalledTimes(2);
    });

    it('propaga qualquer outra falha, sem repetir', async () => {
      upsert.mockRejectedValue(new Error('banco fora'));

      await expect(repository.save(evidence)).rejects.toThrow('banco fora');
      expect(upsert).toHaveBeenCalledOnce();
    });
  });

  describe('deleteOthers', () => {
    it('remove da empresa e da fonte o que não está nas chaves a manter', async () => {
      deleteMany.mockResolvedValue({ count: 4 });
      const cnpj = buildCnpj();
      const sourceId = faker.database.mongodbObjectId();

      await expect(
        repository.deleteOthers(cnpj, sourceId, ['a', 'b']),
      ).resolves.toBe(4);

      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          cnpj,
          data_source_id: sourceId,
          evidence_key: { notIn: ['a', 'b'] },
        },
      });
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
