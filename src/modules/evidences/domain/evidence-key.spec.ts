import { buildEvidenceKey, buildPlaceholderKey } from './evidence-key.js';

describe('buildEvidenceKey', () => {
  it('junta a fonte, o CNPJ e a referência', () => {
    expect(buildEvidenceKey('IBAMA', '11222333000181', 'AI-123')).toBe(
      'IBAMA:11222333000181:AI-123',
    );
  });

  it('é determinística: a mesma coleta gera a mesma chave', () => {
    expect(buildEvidenceKey('IBAMA', '11222333000181', 'AI-123')).toBe(
      buildEvidenceKey('IBAMA', '11222333000181', 'AI-123'),
    );
  });

  it('ignora espaços nas pontas da referência', () => {
    expect(buildEvidenceKey('IBAMA', '11222333000181', '  AI-123 ')).toBe(
      buildEvidenceKey('IBAMA', '11222333000181', 'AI-123'),
    );
  });

  it('a mesma referência em empresas diferentes tem chaves diferentes', () => {
    expect(buildEvidenceKey('IBAMA', '11222333000181', 'AI-123')).not.toBe(
      buildEvidenceKey('IBAMA', '00000000000191', 'AI-123'),
    );
  });

  it('a mesma referência em fontes diferentes tem chaves diferentes', () => {
    expect(buildEvidenceKey('CGU_CEIS', '11222333000181', '1')).not.toBe(
      buildEvidenceKey('CGU_CNEP', '11222333000181', '1'),
    );
  });
});

describe('buildPlaceholderKey', () => {
  it('junta a fonte, o CNPJ e o estado', () => {
    expect(buildPlaceholderKey('IBAMA', '11222333000181', 'NOT_FOUND')).toBe(
      'IBAMA:11222333000181#NOT_FOUND',
    );
    expect(buildPlaceholderKey('IBAMA', '11222333000181', 'UNKNOWN')).toBe(
      'IBAMA:11222333000181#UNKNOWN',
    );
  });

  it('nunca colide com a chave de um registro, nem com a referência "NOT_FOUND"', () => {
    expect(
      buildPlaceholderKey('IBAMA', '11222333000181', 'NOT_FOUND'),
    ).not.toBe(buildEvidenceKey('IBAMA', '11222333000181', 'NOT_FOUND'));
  });
});
