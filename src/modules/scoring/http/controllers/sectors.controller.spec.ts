import type { GetSectorEvolutionUseCase } from '../../infra/usecases/get-sector-evolution.usecase.js';
import type { ListSectorsUseCase } from '../../infra/usecases/list-sectors.usecase.js';
import {
  SectorEvolutionParamsSchema,
  SectorEvolutionQuerySchema,
} from '../../domain/dtos/requests/sector-evolution.dto.js';
import { SectorsController } from './sectors.controller.js';

describe('SectorsController (#90)', () => {
  const list = vi.fn<ListSectorsUseCase['execute']>();
  const execute = vi.fn<GetSectorEvolutionUseCase['execute']>();
  const controller = new SectorsController(
    { execute: list } as unknown as ListSectorsUseCase,
    { execute } as unknown as GetSectorEvolutionUseCase,
  );

  it('converte o CNAE na divisão e repassa o ODS', async () => {
    const params = SectorEvolutionParamsSchema.parse({ cnae: '6201-5/01' });
    const query = SectorEvolutionQuerySchema.parse({ ods: '15' });

    await controller.evolution(params, query);

    expect(execute).toHaveBeenCalledWith({ cnaeDivision: '62', odsNumber: 15 });
  });

  it('lista os setores pelo caso de uso', async () => {
    const sectors = { data: [{ cnae_division: '62', description: 'TI' }] };
    list.mockResolvedValue(sectors);

    await expect(controller.listSectors()).resolves.toBe(sectors);
  });

  it.each(['04', '98', '041', '04.11-1/00'])(
    'divisão que não existe na CNAE 2.3 (%j) é recusada',
    (cnae) => {
      const result = SectorEvolutionParamsSchema.safeParse({ cnae });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('não existe');
    },
  );

  it.each(['6', '6201', 'abc', '00'])(
    'código que não é CNAE (%j) é recusado sem consultar a tabela',
    (cnae) => {
      const result = SectorEvolutionParamsSchema.safeParse({ cnae });

      expect(result.error?.issues[0]?.message).toContain('informe a divisão');
    },
  );

  it.each([{}, { ods: '0' }, { ods: '18' }, { ods: 'x' }])(
    'ODS ausente ou fora de 1 a 17 (%j) é recusado',
    (query) => {
      expect(SectorEvolutionQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});
