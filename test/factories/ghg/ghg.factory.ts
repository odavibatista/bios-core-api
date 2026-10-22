import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';
import { buildCnpj } from '../companies/company-profile.factory.js';
export const ghgInventoryFactory = defineFactory(() => ({
  cnpj: buildCnpj(),
  organizationId: faker.number.int({ min: 1, max: 9999 }),
  cycleId: faker.number.int({ min: 1, max: 30 }),
  year: faker.number.int({ min: 2020, max: 2025 }),
}));
export function ghgEnvelope(result: unknown) {
  return {
    result,
    success: true,
    error: null,
    unAuthorizedRequest: false,
    __abp: true,
  };
}
/** PDF sintetico minimo, sem rede/fontes externas; texto relevante gerado pelo cenario. */
export function ghgPdf(cnpj: string, year: number, extra = ''): Buffer {
  const text = `BT /F1 12 Tf 20 760 Td (Ano inventariado: ${year}) Tj 0 -20 Td (CNPJ: ${cnpj}) Tj 0 -20 Td (${extra}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
