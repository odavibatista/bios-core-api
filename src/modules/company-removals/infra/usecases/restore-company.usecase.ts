import { Injectable } from '@nestjs/common';
import { InvalidCnpjException } from '@modules/companies/domain/dtos/errors/invalid-cnpj.exception.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import { CompanyRemovalNotFoundException } from '../../domain/dtos/errors/company-removal.errors.js';
import { CompanyRemovalRepository } from '../../domain/dtos/repositories/company-removal.repository.js';

/**
 * Tira um CNPJ da lista, por engano ou porque o titular desistiu. O cadastro volta na próxima
 * consulta, coletado de novo nas fontes.
 */
@Injectable()
export class RestoreCompanyUseCase extends UseCase<string, void> {
  constructor(private readonly removals: CompanyRemovalRepository) {
    super();
  }

  override async execute(input: string): Promise<void> {
    const cnpj = parseCnpj(input);

    if (!cnpj) throw new InvalidCnpjException();
    if (!(await this.removals.restore(cnpj))) {
      throw new CompanyRemovalNotFoundException();
    }
  }
}
