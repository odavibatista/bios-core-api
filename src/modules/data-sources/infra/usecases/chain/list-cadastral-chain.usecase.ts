import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';

/**
 * Ordem da cadeia de fallback cadastral, lida do catálogo (RF03).
 *
 * Devolve os slugs das fontes cadastrais habilitadas, da prioridade 1 em
 * diante. O catálogo é a fonte da ordem: reordenar a cadeia ou desabilitar um
 * provedor é uma alteração em `data_sources`, que vale na consulta seguinte,
 * sem novo deploy.
 */
@Injectable()
export class ListCadastralChainUseCase extends UseCase<void, string[]> {
  constructor(private readonly dataSourceRepository: DataSourceRepository) {
    super();
  }

  override execute(): Promise<string[]> {
    return this.dataSourceRepository.findCadastralChain();
  }
}
