import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';

/** Por que um registro do IBAMA foi descartado em vez de virar dado do BIOS. */
export const IbamaDiscardReason = {
  /** O autuado é pessoa física (CPF): o BIOS só guarda pessoa jurídica (INL02). */
  PESSOA_FISICA: 'PESSOA_FISICA',
  /** O registro não traz documento: não há empresa a quem atribuí-lo. */
  SEM_DOCUMENTO: 'SEM_DOCUMENTO',
  /** O documento não é um CNPJ válido nem parece um CPF. */
  DOCUMENTO_INVALIDO: 'DOCUMENTO_INVALIDO',
  /** A linha não tem o formato do CSV ou falta a referência do registro. */
  REGISTRO_MALFORMADO: 'REGISTRO_MALFORMADO',
} as const;

export type IbamaDiscardReason =
  (typeof IbamaDiscardReason)[keyof typeof IbamaDiscardReason];

export type IbamaDocumentVerdict =
  | { kind: 'CNPJ'; cnpj: string }
  | {
      kind: 'DISCARD';
      reason: Exclude<IbamaDiscardReason, 'REGISTRO_MALFORMADO'>;
    };

/** Quantidade de dígitos de um CPF. */
const CPF_DIGITS = 11;

/**
 * Decide se o registro é de uma empresa (CNPJ) ou deve ser descartado (INL02).
 *
 * É a barreira que mantém pessoa física fora do BIOS: roda em cada linha do dump,
 * **antes** de qualquer persistência, inclusive na camada bruta. Por isso erra
 * para o lado do descarte:
 *
 *  - **o documento decide, não só o rótulo.** O dump traz o tipo de pessoa
 *    (`PF`/`PJ`), mas há linhas rotuladas `PJ` com um CPF (formatado ou não) no
 *    campo do documento. Só entra o que é um CNPJ válido (formato e dígitos
 *    verificadores, numérico ou alfanumérico);
 *  - **rótulo `PF` descarta mesmo com documento que parece CNPJ**: a divergência
 *    é motivo para não guardar;
 *  - **11 dígitos são tratados como CPF**, com ou sem pontuação;
 *  - **documento ausente ou que não é nem CNPJ nem CPF** é descartado à parte
 *    (`SEM_DOCUMENTO`, `DOCUMENTO_INVALIDO`), para o total descartado de cada
 *    execução mostrar o que houve.
 *
 * O CNPJ volta na forma canônica (14 caracteres, sem pontuação).
 */
export function classifyIbamaDocument(
  document: string,
  personType?: string,
): IbamaDocumentVerdict {
  const text = document.trim();

  if (personType?.trim().toUpperCase() === 'PF') {
    return { kind: 'DISCARD', reason: IbamaDiscardReason.PESSOA_FISICA };
  }

  if (text === '') {
    return { kind: 'DISCARD', reason: IbamaDiscardReason.SEM_DOCUMENTO };
  }

  const cnpj = parseCnpj(text);

  if (cnpj !== null) return { kind: 'CNPJ', cnpj };

  const digits = text.replace(/\D/g, '');

  return {
    kind: 'DISCARD',
    reason:
      digits.length === CPF_DIGITS
        ? IbamaDiscardReason.PESSOA_FISICA
        : IbamaDiscardReason.DOCUMENTO_INVALIDO,
  };
}
