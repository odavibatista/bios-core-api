import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import {
  buildApiDocument,
  DEFAULT_SERVER_URL,
  readApiVersion,
} from './api-documentation.config.js';

describe('readApiVersion', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'bios-version-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const fileWith = (content: string) => {
    const path = join(directory, 'package.json');

    writeFileSync(path, content);

    return pathToFileURL(path);
  };

  it('lê a versão do package.json do projeto', () => {
    expect(readApiVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('devolve a versão do arquivo indicado', () => {
    expect(readApiVersion(fileWith('{"version":"2.5.1"}'))).toBe('2.5.1');
  });

  it.each([
    ['arquivo ausente', null],
    ['JSON inválido', '{ isto não é json'],
    ['sem o campo version', '{"name":"bios"}'],
    ['versão vazia', '{"version":""}'],
    ['versão que não é texto', '{"version":3}'],
  ])('%s: usa a versão de reserva, sem lançar', (_label, content) => {
    const url =
      content === null
        ? pathToFileURL(join(directory, 'inexistente.json'))
        : fileWith(content);

    expect(readApiVersion(url)).toBe('0.0.0');
  });
});

describe('buildApiDocument', () => {
  @Controller('exemplos')
  class ExampleController {
    @Get()
    @ApiOperation({ operationId: 'listExamples', summary: 'Lista exemplos' })
    list(): string[] {
      return [];
    }

    @Get('sem-id')
    @ApiOperation({ summary: 'Sem operationId explícito' })
    withoutId(): string[] {
      return [];
    }
  }

  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ExampleController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('publica a URL base informada', () => {
    expect(
      buildApiDocument(app, { serverUrl: 'https://api.exemplo.com.br' })
        .servers,
    ).toEqual([{ url: 'https://api.exemplo.com.br' }]);
  });

  it('sem URL, publica a relativa', () => {
    expect(DEFAULT_SERVER_URL).toBe('/');
    expect(buildApiDocument(app).servers).toEqual([{ url: '/' }]);
  });

  it('a versão informada vale sobre a do package.json', () => {
    expect(buildApiDocument(app, { version: '9.9.9' }).info.version).toBe(
      '9.9.9',
    );
  });

  it('usa a versão do package.json e o título da API', () => {
    const { info } = buildApiDocument(app);

    expect(info.version).toBe(readApiVersion());
    expect(info.title).toBe('BIOS API');
  });

  it('o operationId explícito vale; sem ele, cai no nome da classe (e é isso que o teste do documento proíbe)', () => {
    const { paths } = buildApiDocument(app);

    expect(paths['/exemplos']?.get?.operationId).toBe('listExamples');
    expect(paths['/exemplos/sem-id']?.get?.operationId).toBe(
      'ExampleController_withoutId',
    );
  });

  it('declara os esquemas de autenticação por JWT e por chave de API', () => {
    const { components } = buildApiDocument(app);

    expect(components?.securitySchemes).toMatchObject({
      jwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'api-key': { type: 'apiKey', in: 'header', name: 'x-api-key' },
    });
  });
});
