import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Arquivos `.ts` de produção (sem os testes) sob `directory`. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

/**
 * Isolamento das iscas (RF21, NFSE07, #87/#88): o `@Honeypot()` bloqueia o IP de quem chama
 * para sempre, então só pode estar nas rotas isca, e as iscas não leem dado real.
 */
describe('isolamento do honeypot', () => {
  const sources = sourceFiles(join(process.cwd(), 'src')).map((path) => ({
    path: relative(process.cwd(), path).split(sep).join('/'),
    text: readFileSync(path, 'utf8'),
  }));

  it('nenhuma rota real usa o @Honeypot(): só o módulo das iscas', () => {
    // O uso como decorator (linha própria), e não a menção em comentário.
    const users = sources
      .filter(({ text }) => /^\s*@Honeypot\(\)\s*$/m.test(text))
      .map(({ path }) => path);

    expect(users.length).toBeGreaterThan(0);
    expect(
      users.filter((path) => !path.startsWith('src/modules/honeypot/')),
    ).toEqual([]);
  });

  it('as iscas não leem banco, cache nem fontes', () => {
    const decoys = sources.filter(({ path }) =>
      path.startsWith('src/modules/honeypot/'),
    );

    expect(decoys.length).toBeGreaterThan(0);
    for (const { path, text } of decoys) {
      expect(text, `${path} não pode depender de dado real`).not.toMatch(
        /PrismaService|CacheProvider|Repository|DataSource|@prisma\/client/,
      );
    }
  });
});
