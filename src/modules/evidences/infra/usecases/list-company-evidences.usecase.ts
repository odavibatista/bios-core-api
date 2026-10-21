import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import {
  EvidenceRepository,
  type StoredEvidence,
} from '../../domain/dtos/repositories/evidence.repository.js';
import { resolveEvidenceState } from '../../domain/evidence-rules.js';

/**
 * Lista as evidências de uma empresa com o estado que cada uma tem agora
 * (RF08): a que passou da validade volta como `OUTDATED`, ainda que o banco
 * guarde o estado da coleta. Quem consome (perfil ambiental, cálculo do índice)
 * deve ler por aqui, e não direto do repositório, para nunca tratar como
 * vigente uma evidência vencida.
 *
 * Empresa sem nenhuma evidência devolve lista vazia, e isso quer dizer que
 * nenhuma fonte foi consultada ainda — não que ela esteja limpa (IND02).
 */
@Injectable()
export class ListCompanyEvidencesUseCase extends UseCase<
  string,
  StoredEvidence[]
> {
  constructor(private readonly evidenceRepository: EvidenceRepository) {
    super();
  }

  override async execute(cnpj: string): Promise<StoredEvidence[]> {
    const now = new Date();
    const evidences = await this.evidenceRepository.findByCnpj(cnpj);

    return evidences.map((evidence) => ({
      ...evidence,
      state: resolveEvidenceState(evidence.state, evidence.validUntil, now),
    }));
  }
}
