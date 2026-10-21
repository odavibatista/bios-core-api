import type { IbamaRecord } from './dtos/providers/ibama-dump.dto.js';
import { classifyIbamaDocument, IbamaDiscardReason } from './ibama-document.js';
import type { IbamaResourceDefinition } from './ibama-resource.js';

export type IbamaRowResult =
  | { kind: 'RECORD'; record: IbamaRecord }
  | { kind: 'DISCARD'; reason: IbamaDiscardReason };

/** Colunas que precisam existir no CSV; sem elas, o dump mudou de formato. */
export function requiredColumns(
  definition: IbamaResourceDefinition,
): readonly string[] {
  return [
    definition.documentColumn,
    definition.sequenceColumn,
    definition.numberColumn,
    definition.seriesColumn,
    ...(definition.personTypeColumn ? [definition.personTypeColumn] : []),
  ];
}

/**
 * Número e série do documento no formato público (`1092-A`).
 *
 * Os dumps preenchem os campos com espaços à direita e, nos documentos novos,
 * deixam a série vazia: o resultado é só o número.
 */
function buildReference(number: string, series: string): string {
  const trimmedNumber = number.trim();
  const trimmedSeries = series.trim();

  return trimmedSeries === ''
    ? trimmedNumber
    : `${trimmedNumber}-${trimmedSeries}`;
}

/**
 * Converte uma linha do CSV em registro do BIOS, ou diz por que foi descartada.
 *
 * O documento é conferido **antes** de qualquer leitura do restante da linha, e
 * só uma linha de pessoa jurídica chega a virar `IbamaRecord` (INL02). O
 * registro leva só as colunas permitidas (`payloadColumns`) e sem as vazias; o
 * documento fica fora do payload, pois já está no `cnpj`, já canônico.
 */
export function mapIbamaRow(
  definition: IbamaResourceDefinition,
  row: Readonly<Record<string, string>>,
): IbamaRowResult {
  const verdict = classifyIbamaDocument(
    row[definition.documentColumn] ?? '',
    definition.personTypeColumn ? row[definition.personTypeColumn] : undefined,
  );

  if (verdict.kind === 'DISCARD') {
    return { kind: 'DISCARD', reason: verdict.reason };
  }

  const reference = buildReference(
    row[definition.numberColumn] ?? '',
    row[definition.seriesColumn] ?? '',
  );

  // Sem referência não há como identificar a evidência entre coletas.
  if (reference === '') {
    return { kind: 'DISCARD', reason: IbamaDiscardReason.REGISTRO_MALFORMADO };
  }

  const payload: Record<string, string> = {};

  for (const column of definition.payloadColumns) {
    const value = row[column]?.trim();

    if (value) payload[column] = value;
  }

  const sequence = row[definition.sequenceColumn]?.trim();

  return {
    kind: 'RECORD',
    record: {
      resource: definition.resource,
      cnpj: verdict.cnpj,
      reference,
      sequence: sequence ? sequence : null,
      payload,
    },
  };
}
