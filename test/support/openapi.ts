import type { OpenAPIObject } from '@nestjs/swagger';

const COMPONENT_PREFIX = '#/components/schemas/';

/**
 * Devolve o valor com cada `$ref` para um componente substituído pelo schema referenciado,
 * para que os testes leiam o contrato sem depender de onde ele foi nomeado. Uma referência
 * recursiva (como `JsonValue`) é mantida como `$ref` ao reencontrar a si mesma.
 */
export function dereference<T>(
  document: OpenAPIObject,
  value: T,
  ancestors: readonly string[] = [],
): T {
  if (Array.isArray(value)) {
    return value.map((item: unknown) =>
      dereference(document, item, ancestors),
    ) as T;
  }

  if (value && typeof value === 'object') {
    const { $ref, ...rest } = value as Record<string, unknown>;

    if (typeof $ref === 'string' && $ref.startsWith(COMPONENT_PREFIX)) {
      const name = $ref.slice(COMPONENT_PREFIX.length);

      if (ancestors.includes(name)) return value;

      return dereference(document, document.components?.schemas?.[name], [
        ...ancestors,
        name,
      ]) as T;
    }

    return Object.fromEntries(
      Object.entries(rest).map(([key, child]) => [
        key,
        dereference(document, child, ancestors),
      ]),
    ) as T;
  }

  return value;
}
