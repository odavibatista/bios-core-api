import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Trava da acentuação dos textos pt-BR expostos pela API (#258): mensagens de erro,
 * descrições do OpenAPI, resumos de evidência e e-mails.
 *
 * Varre os literais de texto do código de produção e reprova a grafia **sem acento** de
 * palavras que, em português, levam acento, til ou cedilha (`invalido`, `nao`, `indice`...).
 * Só entram na lista grafias que não são palavra válida sem o acento: `invalida`
 * (verbo) e `valida` ficam de fora de propósito.
 *
 * Alcance: literais com espaço (frases). Identificadores, nomes de campo das fontes
 * (`MUNICIPIO`), URLs e comentários não são texto da API e não entram. Ao achar uma
 * palavra nova sem acento, acrescente a grafia errada a `UNACCENTED`.
 */
const UNACCENTED = new Set([
  'nao',
  'indice',
  'indices',
  'invalido',
  'invalidos',
  'invalidas',
  'numero',
  'numeros',
  'inventario',
  'inventarios',
  'emissoes',
  'emissao',
  'evidencia',
  'evidencias',
  'informacao',
  'informacoes',
  'validacao',
  'autorizacao',
  'autenticacao',
  'sessao',
  'sessoes',
  'codigo',
  'codigos',
  'orgao',
  'orgaos',
  'acao',
  'acoes',
  'tambem',
  'ultimo',
  'ultima',
  'ultimos',
  'ultimas',
  'periodo',
  'usuario',
  'usuarios',
  'endereco',
  'dominio',
  'dominios',
  'conteudo',
  'requisicao',
  'requisicoes',
  'excecao',
  'excecoes',
  'configuracao',
  'configuracoes',
  'obrigatorio',
  'obrigatoria',
  'obrigatorios',
  'minimo',
  'maximo',
  'publico',
  'publicos',
  'publicas',
  'proximo',
  'proxima',
  'nivel',
  'niveis',
  'pagina',
  'paginas',
  'voce',
  'disponivel',
  'indisponivel',
  'disponiveis',
  'indisponiveis',
  'sustentavel',
  'sustentaveis',
  'aderencia',
  'referencia',
  'referencias',
  'decisao',
  'situacao',
  'conexao',
  'operacao',
  'operacoes',
  'execucao',
  'execucoes',
  'descricao',
  'descricoes',
  'inscricao',
  'identificacao',
  'exclusao',
  'criacao',
  'alteracao',
  'atualizacao',
  'publicacao',
  'ausencia',
  'presenca',
  'tecnica',
  'tecnico',
  'historico',
  'historica',
  'alem',
  'apos',
  'atraves',
  'permissao',
  'permissoes',
  'expiracao',
  'renovacao',
  'revogacao',
  'solicitacao',
  'confirmacao',
  'verificacao',
  'notificacao',
  'recuperacao',
  'redefinicao',
  'unico',
  'unicos',
  'diario',
  'diaria',
  'analise',
  'saude',
  'variavel',
  'variaveis',
  'possivel',
  'impossivel',
  'disponibilidade',
  'responsavel',
  'responsaveis',
  'valido',
  'validos',
  'validas',
  'vigencia',
  'infracao',
  'infracoes',
  'sancao',
  'sancoes',
  'punicao',
  'suspensao',
  'contribuicao',
  'contribuicoes',
  'pontuacao',
  'explicacao',
  'correspondencia',
  'ocorrencia',
  'ocorrencias',
  'gestao',
  'educacao',
  'regiao',
  'regioes',
  'organizacao',
  'organizacoes',
  'classificacao',
  'classificacoes',
  'transparencia',
  'fiscalizacao',
  'poluicao',
  'degradacao',
  'preservacao',
  'conservacao',
  'residuo',
  'residuos',
  'porem',
  'entao',
  'cenario',
  'cenarios',
  'calculo',
  'calculos',
  'relatorio',
  'relatorios',
  'duvida',
  'duvidas',
  'seguranca',
  'servico',
  'servicos',
  'negocio',
  'negocios',
  'municipio',
  'municipios',
  'sequencia',
  'consequencia',
  'frequencia',
  'experiencia',
  'existencia',
  'concorrencia',
  'divergencia',
  'coerencia',
  'inconsistencia',
  'persistencia',
  'transferencia',
  'preferencia',
  'eficiencia',
  'competencia',
  'pendencia',
  'dependencia',
  'independencia',
  'tendencia',
  'resistencia',
  'potencia',
]);

const SOURCE_ROOT = join(process.cwd(), 'src');

function files(
  dir: string,
  extension: RegExp,
  skip: RegExp,
  found: string[] = [],
) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) files(path, extension, skip, found);
    else if (extension.test(entry.name) && !skip.test(entry.name))
      found.push(path);
  }

  return found;
}

/**
 * Literais de texto de um arquivo TypeScript, sem comentários e sem o código das
 * interpolações dos templates (que pode conter outros literais, tratados à parte).
 *
 * Um tokenizador pequeno, e não uma expressão regular: templates aninhados
 * (uma interpolação com outro template dentro) desalinhariam qualquer regex de aspas.
 */
function textLiterals(source: string): string[] {
  const found: string[] = [];
  let index = 0;

  const skipString = (quote: string): string => {
    let text = '';

    index += 1;
    while (index < source.length && source[index] !== quote) {
      if (source[index] === '\\') index += 1;
      text += source[index] ?? '';
      index += 1;
    }
    index += 1;

    return text;
  };

  const template = (): string => {
    let text = '';

    index += 1;
    while (index < source.length && source[index] !== '`') {
      if (source[index] === '\\') {
        index += 2;
      } else if (source[index] === '$' && source[index + 1] === '{') {
        index += 2;
        code(true);
        text += ' ';
      } else {
        text += source[index];
        index += 1;
      }
    }
    index += 1;

    return text;
  };

  function code(untilClosingBrace: boolean): void {
    let depth = 0;

    while (index < source.length) {
      const char = source[index];
      const next = source[index + 1];

      if (char === '/' && next === '/') {
        while (index < source.length && source[index] !== '\n') index += 1;
      } else if (char === '/' && next === '*') {
        const close = source.indexOf('*/', index + 2);

        index = close < 0 ? source.length : close + 2;
      } else if (char === "'" || char === '"') {
        found.push(skipString(char));
      } else if (char === '`') {
        found.push(template());
      } else if (char === '{') {
        depth += 1;
        index += 1;
      } else if (char === '}') {
        index += 1;
        if (untilClosingBrace && depth === 0) return;
        depth -= 1;
      } else {
        index += 1;
      }
    }
  }

  code(false);

  return found;
}

function unaccentedIn(text: string): string[] {
  const words = (text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((word) =>
    UNACCENTED.has(word),
  );

  return [...new Set(words)];
}

function findings(path: string, source: string): string[] {
  const found: string[] = [];

  for (const content of textLiterals(source)) {
    if (!/\s/.test(content) || /^https?:/.test(content.trim())) continue;

    const words = unaccentedIn(content);

    if (words.length > 0) {
      found.push(
        `${relative(process.cwd(), path)}: [${words.join(', ')}] "${content.trim().slice(0, 80)}"`,
      );
    }
  }

  return found;
}

describe('acentuação dos textos pt-BR da API (#258)', () => {
  it('nenhum texto do código de produção traz palavra sem acento', () => {
    const offenders = files(SOURCE_ROOT, /\.ts$/, /\.spec\.ts$/).flatMap(
      (path) => findings(path, readFileSync(path, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });

  it('nenhum e-mail transacional traz palavra sem acento', () => {
    const offenders = files(SOURCE_ROOT, /\.hbs$/, /^$/).flatMap((path) => {
      const words = unaccentedIn(readFileSync(path, 'utf8'));

      return words.length > 0
        ? [`${relative(process.cwd(), path)}: [${words.join(', ')}]`]
        : [];
    });

    expect(offenders).toEqual([]);
  });

  it('o detector enxerga o erro: texto sem acento é acusado, e o acentuado passa', () => {
    const wrong = "const a = 'CNPJ invalido para consultar evidencias.';";
    const right = "const a = 'CNPJ inválido para consultar evidências.';";

    expect(findings('x.ts', wrong)).toHaveLength(1);
    expect(findings('x.ts', right)).toEqual([]);
    expect(
      findings('x.ts', 'const a = `Inventario de emissoes: ano 1.`;'),
    ).toHaveLength(1);
  });

  it('entende template aninhado: texto dentro e fora da interpolação', () => {
    const nested =
      'const a = `Auto ${cond ? `sem pontuacao` : ""} da empresa`;';

    expect(findings('x.ts', nested)).toHaveLength(1);
    expect(
      findings(
        'x.ts',
        'const a = `Auto ${cond ? `sem pontuação` : ""} da empresa`;',
      ),
    ).toEqual([]);
  });

  it('não acusa o que não é texto da API: identificador, URL, campo da fonte e comentário', () => {
    const source = [
      'const field = payload.MUNICIPIO;',
      "const url = 'https://dados.example/fiscalizacao-auto-de-infracao';",
      "const word = 'municipio';",
      '// Projecao sem pontuacao: comentário, não é texto da API.',
      '/* Inventario sem acento em comentário de bloco */',
      'const msg = `Valor ${payload.indice} recebido`;',
    ].join('\n');

    expect(findings('x.ts', source)).toEqual([]);
  });
});
