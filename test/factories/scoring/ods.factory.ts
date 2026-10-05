import type { Ods } from '@prisma/client';
import { faker } from '../../support/faker.js';
import { defineFactory, timestamps } from '../factory.js';

/** ODS (`ods`), com número oficial entre 1 e 17 da Agenda 2030. */
export const odsFactory = defineFactory<Ods>(() => ({
  id_ods: faker.database.mongodbObjectId(),
  ods_number: faker.number.int({ min: 1, max: 17 }),
  title: faker.lorem.words({ min: 2, max: 5 }),
  description: faker.lorem.paragraph(),
  is_active: true,
  ...timestamps(),
}));
