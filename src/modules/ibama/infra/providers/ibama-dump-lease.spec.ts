import { buildFakeDump } from '@test/factories/ibama/ibama-fake-dump.factory.js';
import { IbamaResource } from '../../domain/ibama-resource.js';
import { IBAMA_DUMP_REUSE_MS, IbamaDumpLease } from './ibama-dump-lease.js';

describe('IbamaDumpLease', () => {
  let lease: IbamaDumpLease;
  const fresh = () => [
    buildFakeDump(IbamaResource.AUTO_INFRACAO),
    buildFakeDump(IbamaResource.TERMO_EMBARGO),
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    lease = new IbamaDumpLease();
  });
  afterEach(async () => {
    await lease.clear();
    vi.useRealTimers();
  });

  it('baixa uma vez e reaproveita dentro da janela', async () => {
    const download = vi.fn(() => Promise.resolve(fresh()));
    const first = await lease.use(download, (l) => Promise.resolve(l));
    const second = await lease.use(download, (l) => Promise.resolve(l));
    expect(download).toHaveBeenCalledOnce();
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.dumps).toBe(first.dumps);
    expect(second.downloadedAt).toEqual(first.downloadedAt);
  });

  it('pedidos simultâneos esperam o mesmo download em andamento', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const download = vi.fn(async () => {
      await gate;
      return fresh();
    });
    const calls = [1, 2, 3].map(() =>
      lease.use(download, (l) => Promise.resolve(l.reused)),
    );
    release();
    await expect(Promise.all(calls)).resolves.toEqual([false, true, true]);
    expect(download).toHaveBeenCalledOnce();
    expect(lease.stats).toMatchObject({ downloads: 1, peakDownloads: 1 });
  });

  it('depois da janela baixa de novo e apaga os arquivos antigos', async () => {
    const first = fresh();
    const second = fresh();
    const download = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    await lease.use(download, () => Promise.resolve());
    await vi.advanceTimersByTimeAsync(IBAMA_DUMP_REUSE_MS + 1);
    expect(first[0].dispose).toHaveBeenCalledOnce();
    await lease.use(download, () => Promise.resolve());
    expect(download).toHaveBeenCalledTimes(2);
    expect(second[0].dispose).not.toHaveBeenCalled();
  });

  it('não apaga arquivos enquanto alguém lê, e apaga ao terminar', async () => {
    const dumps = fresh();
    let finish!: () => void;
    const reading = new Promise<void>((resolve) => (finish = resolve));
    const pending = lease.use(
      () => Promise.resolve(dumps),
      () => reading,
    );
    await vi.advanceTimersByTimeAsync(IBAMA_DUMP_REUSE_MS + 1);
    expect(dumps[0].dispose).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(dumps[0].dispose).toHaveBeenCalledOnce();
  });

  it('download que falha não fica guardado e a próxima chamada tenta de novo', async () => {
    const error = new Error('fora do ar');
    const download = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(fresh());
    await expect(lease.use(download, () => Promise.resolve())).rejects.toBe(
      error,
    );
    await expect(
      lease.use(download, (l) => Promise.resolve(l.reused)),
    ).resolves.toBe(false);
    expect(lease.stats.activeDownloads).toBe(0);
  });

  it('erro do leitor propaga sem travar os seguintes', async () => {
    const download = vi.fn(() => Promise.resolve(fresh()));
    await expect(
      lease.use(download, () => Promise.reject(new Error('leitura'))),
    ).rejects.toThrow('leitura');
    await expect(
      lease.use(download, () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
  });

  it('descarta no encerramento da aplicação', async () => {
    const dumps = fresh();
    await lease.use(
      () => Promise.resolve(dumps),
      () => Promise.resolve(),
    );
    await lease.onModuleDestroy();
    expect(dumps[1].dispose).toHaveBeenCalledOnce();
  });
});
