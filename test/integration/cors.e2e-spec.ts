import {
  Controller,
  Get,
  type INestApplication,
  StreamableFile,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { buildCorsOptions } from '@shared/config/cors.config.js';
import request from 'supertest';

const FRONT_ORIGIN = 'http://localhost:4200';

/** Rota de arquivo como a da exportação: corpo binário e nome no Content-Disposition. */
@Controller('file')
class FileController {
  @Get()
  file(): StreamableFile {
    return new StreamableFile(Buffer.from('xlsx'), {
      disposition: 'attachment; filename="empresas.xlsx"',
    });
  }
}

/**
 * CORS como o `main.ts` o aplica, no adaptador HTTP real (Express): o front em outra origem
 * lê o nome do arquivo exportado e o prazo do 429, que o navegador esconderia sem a exposição.
 */
describe('CORS (e2e)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  async function start(origins: true | string[]): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      controllers: [FileController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableCors(buildCorsOptions(origins));
    await app.init();
  }

  it('expõe Content-Disposition e Retry-After à origem do front', async () => {
    await start([FRONT_ORIGIN]);

    const response = await request(app.getHttpServer())
      .get('/file')
      .set('Origin', FRONT_ORIGIN)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(FRONT_ORIGIN);
    expect(response.headers['access-control-expose-headers']).toBe(
      'Content-Disposition,Retry-After',
    );
    expect(response.headers['content-disposition']).toContain('empresas.xlsx');
  });

  it('origem fora da lista não recebe permissão', async () => {
    await start([FRONT_ORIGIN]);

    const response = await request(app.getHttpServer())
      .get('/file')
      .set('Origin', 'https://outra.example')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('com "*", reflete a origem de quem chama', async () => {
    await start(true);

    const response = await request(app.getHttpServer())
      .get('/file')
      .set('Origin', 'https://qualquer.example')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(
      'https://qualquer.example',
    );
  });
});
