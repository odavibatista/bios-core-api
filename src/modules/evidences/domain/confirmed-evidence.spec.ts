import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import { evidenceSourceFactory } from '@test/factories/evidences/evidence.factory.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { faker } from '@test/support/faker.js';
import {
  baseEvidence,
  buildConfirmedEvidence,
  type EvidenceBuildContext,
} from './confirmed-evidence.js';
import { InvalidEvidenceError } from './dtos/errors/evidence.errors.js';

describe('confirmed-evidence', () => {
  const source = evidenceSourceFactory.build({
    slug: 'IBAMA',
    category: EvidenceCategory.INFRACAO_AMBIENTAL,
  });
  const context: EvidenceBuildContext = {
    cnpj: buildCnpj(),
    source,
    collectedAt: faker.date.recent(),
    validUntil: faker.date.soon(),
  };

  describe('baseEvidence', () => {
    it('categoria e ODS vêm da fonte, e o sinal, da categoria', () => {
      expect(baseEvidence(context)).toEqual({
        cnpj: context.cnpj,
        dataSourceId: source.id,
        odsId: source.odsId,
        category: EvidenceCategory.INFRACAO_AMBIENTAL,
        signal: EvidenceSignal.NEGATIVE,
        collectedAt: context.collectedAt,
        validUntil: context.validUntil,
      });
    });
  });

  describe('buildConfirmedEvidence', () => {
    it('é CONFIRMED, com os campos do registro', () => {
      const publishedAt = faker.date.past();

      expect(
        buildConfirmedEvidence(
          {
            reference: ' AI-1 ',
            summary: 'Multa',
            url: 'https://dados.example/ai-1',
            details: { valor: 1 },
            publishedAt,
            rawEvidenceId: 'raw-1',
          },
          context,
        ),
      ).toMatchObject({
        key: `IBAMA:${context.cnpj}:AI-1`,
        state: EvidenceState.CONFIRMED,
        summary: 'Multa',
        sourceReference: 'AI-1',
        sourceUrl: 'https://dados.example/ai-1',
        details: { valor: 1 },
        publishedAt,
        rawEvidenceId: 'raw-1',
      });
    });

    it('sem identidade, a chave usa a referência', () => {
      expect(buildConfirmedEvidence({ reference: '1092-A' }, context).key).toBe(
        `IBAMA:${context.cnpj}:1092-A`,
      );
    });

    it('com identidade, a chave usa a identidade e a referência continua sendo a exibida', () => {
      const evidence = buildConfirmedEvidence(
        { reference: '1092-A', identity: 'AI-691556' },
        context,
      );

      expect(evidence.key).toBe(`IBAMA:${context.cnpj}:AI-691556`);
      expect(evidence.sourceReference).toBe('1092-A');
    });

    it('a mesma referência com identidades diferentes são chaves diferentes', () => {
      const first = buildConfirmedEvidence(
        { reference: '1092-A', identity: 'AI-1' },
        context,
      );
      const second = buildConfirmedEvidence(
        { reference: '1092-A', identity: 'AI-2' },
        context,
      );

      expect(first.key).not.toBe(second.key);
    });

    it('identidade só de espaços vale como ausente', () => {
      expect(
        buildConfirmedEvidence({ reference: 'X-1', identity: '   ' }, context)
          .key,
      ).toBe(`IBAMA:${context.cnpj}:X-1`);
    });

    it('o que o registro não traz fica null', () => {
      expect(
        buildConfirmedEvidence({ reference: 'X-1' }, context),
      ).toMatchObject({
        summary: null,
        sourceUrl: null,
        details: null,
        publishedAt: null,
        rawEvidenceId: null,
      });
    });

    it.each(['', '   '])('recusa a referência vazia ("%s")', (reference) => {
      expect(() => buildConfirmedEvidence({ reference }, context)).toThrow(
        InvalidEvidenceError,
      );
    });

    it('a identidade não substitui a falta de referência', () => {
      expect(() =>
        buildConfirmedEvidence({ reference: '', identity: 'AI-1' }, context),
      ).toThrow(InvalidEvidenceError);
    });
  });
});
