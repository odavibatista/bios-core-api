import { buildPassword } from '@test/factories/shared/password.factory.js';
import { faker } from '@test/support/faker.js';
import {
  ChangeEmailRequestSchema,
  DeleteAccountRequestSchema,
  UpdateAccountRequestSchema,
} from './account-management.dto.js';
import { AddressSchema, BRAZILIAN_STATES } from './address.dto.js';

function buildAddress(overrides: Record<string, unknown> = {}) {
  return {
    postal_code: '01310-100',
    street: faker.location.street(),
    number: '1578',
    neighborhood: faker.location.county(),
    city: faker.location.city(),
    state: 'SP',
    ...overrides,
  };
}

function invalidFields(
  schema: {
    safeParse(input: unknown): {
      success: boolean;
      error?: { issues: { path: PropertyKey[] }[] };
    };
  },
  input: unknown,
): string[] {
  const result = schema.safeParse(input);

  return result.success
    ? []
    : (result.error?.issues ?? []).map(({ path }) => path.join('.'));
}

describe('AddressSchema', () => {
  it('aceita um endereço completo', () => {
    expect(AddressSchema.safeParse(buildAddress()).success).toBe(true);
  });

  it('aceita o complemento, que é opcional', () => {
    expect(
      AddressSchema.safeParse(buildAddress({ complement: 'Apto 12' })).success,
    ).toBe(true);
  });

  it.each(['01310-100', '01310100'])('aceita o CEP %s', (postal_code) => {
    expect(AddressSchema.safeParse(buildAddress({ postal_code })).success).toBe(
      true,
    );
  });

  it.each(['1310100', '013101000', '0131-0100', 'abcdefgh', ''])(
    'recusa o CEP "%s"',
    (postal_code) => {
      expect(
        invalidFields(AddressSchema, buildAddress({ postal_code })),
      ).toEqual(['postal_code']);
    },
  );

  it.each(BRAZILIAN_STATES)('aceita a UF %s', (state) => {
    expect(AddressSchema.safeParse(buildAddress({ state })).success).toBe(true);
  });

  it.each(['XX', 'sp', 'S', 'SPP', ''])('recusa a UF "%s"', (state) => {
    expect(invalidFields(AddressSchema, buildAddress({ state }))).toEqual([
      'state',
    ]);
  });

  it.each(['street', 'number', 'neighborhood', 'city', 'state', 'postal_code'])(
    'exige o campo %s',
    (field) => {
      const address: Record<string, unknown> = buildAddress();
      delete address[field];

      expect(invalidFields(AddressSchema, address)).toEqual([field]);
    },
  );

  it.each([
    ['street', 151],
    ['number', 21],
    ['complement', 61],
    ['neighborhood', 101],
    ['city', 101],
  ])('recusa %s com %i caracteres', (field, length) => {
    expect(
      invalidFields(
        AddressSchema,
        buildAddress({ [field]: 'a'.repeat(length) }),
      ),
    ).toEqual([field]);
  });
});

describe('UpdateAccountRequestSchema', () => {
  it('aceita só o nome', () => {
    expect(
      UpdateAccountRequestSchema.safeParse({ name: 'Maria Souza' }).success,
    ).toBe(true);
  });

  it('aceita só o endereço', () => {
    expect(
      UpdateAccountRequestSchema.safeParse({ address: buildAddress() }).success,
    ).toBe(true);
  });

  it('aceita address nulo, que remove o endereço', () => {
    expect(
      UpdateAccountRequestSchema.safeParse({ address: null }).success,
    ).toBe(true);
  });

  it('exige ao menos um campo', () => {
    const result = UpdateAccountRequestSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/ao menos um campo/);
  });

  it('remove espaços nas bordas do nome', () => {
    const parsed = UpdateAccountRequestSchema.parse({
      name: '  Maria Souza  ',
    });

    expect(parsed.name).toBe('Maria Souza');
  });

  it.each([
    ['curto demais', 'A'],
    ['só espaços', '   '],
    ['longo demais', 'a'.repeat(101)],
  ])('recusa nome %s', (_case, name) => {
    expect(invalidFields(UpdateAccountRequestSchema, { name })).toEqual([
      'name',
    ]);
  });

  it('aponta o campo do endereço inválido', () => {
    expect(
      invalidFields(UpdateAccountRequestSchema, {
        address: buildAddress({ state: 'XX' }),
      }),
    ).toEqual(['address.state']);
  });
});

describe('ChangeEmailRequestSchema', () => {
  it('aceita o novo e-mail e a senha atual', () => {
    expect(
      ChangeEmailRequestSchema.safeParse({
        new_email: faker.internet.email(),
        current_password: buildPassword(),
      }).success,
    ).toBe(true);
  });

  it.each(['', 'sem-arroba', 'a@'])('recusa o e-mail "%s"', (new_email) => {
    expect(
      invalidFields(ChangeEmailRequestSchema, {
        new_email,
        current_password: buildPassword(),
      }),
    ).toEqual(['new_email']);
  });

  it('exige a senha atual', () => {
    expect(
      invalidFields(ChangeEmailRequestSchema, {
        new_email: faker.internet.email(),
      }),
    ).toEqual(['current_password']);
  });

  it('recusa e-mail acima de 254 caracteres', () => {
    expect(
      invalidFields(ChangeEmailRequestSchema, {
        new_email: `${'a'.repeat(250)}@x.com`,
        current_password: buildPassword(),
      }),
    ).toEqual(['new_email']);
  });
});

describe('DeleteAccountRequestSchema', () => {
  it('aceita a senha', () => {
    expect(
      DeleteAccountRequestSchema.safeParse({ password: buildPassword() })
        .success,
    ).toBe(true);
  });

  it.each([{}, { password: '' }, { password: 'a'.repeat(129) }])(
    'recusa %j',
    (body) => {
      expect(DeleteAccountRequestSchema.safeParse(body).success).toBe(false);
    },
  );
});
