import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();

/** Seletor de idioma, logo abaixo do título de cada página. */
const PORTUGUESE_SELECTOR =
  /^🇧🇷 \*\*Português\*\* · 🇺🇸 \[English\]\(([^)]+)\)$/m;
const ENGLISH_SELECTOR = /^🇧🇷 \[Português\]\(([^)]+)\) · 🇺🇸 \*\*English\*\*$/m;

function markdownIn(dir: string): string[] {
  return readdirSync(join(ROOT, dir))
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(ROOT, dir, name));
}

const PORTUGUESE_PAGES = [join(ROOT, 'README.md'), ...markdownIn('docs')];
const ENGLISH_PAGES = [join(ROOT, 'README.en.md'), ...markdownIn('docs/en')];

/** Texto da página sem os blocos de código, onde `](` não é link. */
function prose(path: string): string {
  return readFileSync(path, 'utf8').replace(/^\s*```[\s\S]*?^\s*```/gm, '');
}

/** Âncora que o GitHub gera para um título. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function anchorsOf(path: string): string[] {
  return [...prose(path).matchAll(/^#{1,6} (.+)$/gm)].map(([, heading]) =>
    slug(heading ?? ''),
  );
}

function linkTarget(page: string, selector: RegExp): string | null {
  const target = selector.exec(prose(page))?.[1];

  return target ? resolve(dirname(page), decodeURI(target)) : null;
}

/** Links relativos da página que não levam a um arquivo ou a uma âncora existente. */
function brokenLinks(page: string, text = prose(page)): string[] {
  const broken: string[] = [];

  for (const [, target = ''] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?|mailto):/.test(target)) continue;

    const [path = '', anchor] = target.split('#');
    const destination = path ? resolve(dirname(page), decodeURI(path)) : page;

    if (!existsSync(destination)) broken.push(`${target} (arquivo)`);
    else if (
      anchor &&
      destination.endsWith('.md') &&
      !anchorsOf(destination).includes(anchor)
    ) {
      broken.push(`${target} (âncora)`);
    }
  }

  return broken;
}

const name = (path: string) => relative(ROOT, path).replaceAll('\\', '/');

describe('documentação em português e inglês', () => {
  it('cada página em português aponta a sua versão em inglês, que aponta de volta', () => {
    const problems = PORTUGUESE_PAGES.flatMap((page) => {
      const english = linkTarget(page, PORTUGUESE_SELECTOR);

      if (!english) return [`${name(page)}: sem seletor de idioma`];
      if (!existsSync(english))
        return [`${name(page)}: ${name(english)} não existe`];
      if (linkTarget(english, ENGLISH_SELECTOR) !== page)
        return [`${name(english)}: o seletor não volta a ${name(page)}`];

      return [];
    });

    expect(problems).toEqual([]);
  });

  it('nenhuma página em inglês fica sem a versão em português', () => {
    const translated = new Set(
      PORTUGUESE_PAGES.map((page) => linkTarget(page, PORTUGUESE_SELECTOR)),
    );

    expect(
      ENGLISH_PAGES.filter((page) => !translated.has(page)).map(name),
    ).toEqual([]);
  });

  it('as duas versões têm os mesmos links entre capítulos e para fora', () => {
    const links = (page: string) =>
      [...prose(page).matchAll(/\]\(([^)\s#]+)/g)].length;

    const problems = PORTUGUESE_PAGES.flatMap((page) => {
      const english = linkTarget(page, PORTUGUESE_SELECTOR);

      return english && links(english) < links(page)
        ? [`${name(english)}: ${links(english)} links, contra ${links(page)}`]
        : [];
    });

    expect(problems).toEqual([]);
  });

  it('todo link relativo leva a um arquivo e a uma âncora que existem', () => {
    const problems = [...PORTUGUESE_PAGES, ...ENGLISH_PAGES].flatMap((page) =>
      brokenLinks(page).map((link) => `${name(page)}: ${link}`),
    );

    expect(problems).toEqual([]);
  });

  it('o verificador enxerga o erro: arquivo e âncora inexistentes são acusados', () => {
    const page = join(ROOT, 'docs', 'README.md');

    expect(
      brokenLinks(page, '[a](01-Como-Rodar.md#scripts) [b](en/README.md)'),
    ).toEqual([]);
    expect(
      brokenLinks(page, '[a](01-Como-Rodar.md#nao-existe) [b](99-Nada.md)'),
    ).toEqual(['01-Como-Rodar.md#nao-existe (âncora)', '99-Nada.md (arquivo)']);
  });
});
