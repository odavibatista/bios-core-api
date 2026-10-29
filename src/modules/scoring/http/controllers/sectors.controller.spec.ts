import type { GetSectorEvolutionUseCase } from '../../infra/usecases/get-sector-evolution.usecase.js';
import {
  SectorEvolutionParamsSchema,
  SectorEvolutionQuerySchema,
} from '../../domain/dtos/requests/sector-evolution.dto.js';
import { SectorsController } from './sectors.controller.js';

describe('SectorsController (#90)', () => {
  it('converte o CNAE na divisão e repassa o ODS', async () => {
    const execute = vi.fn<GetSectorEvolutionUseCase['execute']>();
    const controller = new SectorsController({
      execute,
    } as unknown as GetSectorEvolutionUseCase);
    const params = SectorEvolutionParamsSchema.parse({ cnae: '6201-5/01' });
    const query = SectorEvolutionQuerySchema.parse({ ods: '15' });

    await controller.evolution(params, query);

    expect(execute).toHaveBeenCalledWith({ cnaeDivision: '62', odsNumber: 15 });
  });

  it.each([{}, { ods: '0' }, { ods: '18' }, { ods: 'x' }])(
    'ODS ausente ou fora de 1 a 17 (%j) é recusado',
    (query) => {
      expect(SectorEvolutionQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});
