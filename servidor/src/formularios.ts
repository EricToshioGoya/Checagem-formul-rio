import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { banco } from './banco';
import {
  contarEtapasAtivas,
  formularioEmBranco,
  validarDefinicao,
  type DefinicaoFormulario,
  type EntradaCatalogo,
} from '../../compartilhado/formulario';

/**
 * Checklists, guardados no servidor e pertencentes a um painel.
 *
 * Antes as definições eram arquivos em `public/forms` e as edições ficavam no
 * IndexedDB de cada aparelho — o que o administrador montava num tablet não
 * chegava a ninguém. Agora quem monta o checklist grava aqui, e todo montador
 * aprovado naquele painel recebe a mesma versão.
 */

interface LinhaFormulario {
  id: string;
  painelId: number;
  painelSlug: string;
  ordem: number;
  ativo: number;
  definicao: string;
  atualizadoEm: number;
}

/** Pasta de onde vêm os checklists já existentes na primeira subida. */
const PASTA_SEMENTE = process.env.FORMS_SEMENTE ?? 'public/forms';

function lerDefinicao(linha: LinhaFormulario): DefinicaoFormulario {
  return validarDefinicao(JSON.parse(linha.definicao));
}

/**
 * A entrada de lista sai da própria definição, e não de colunas paralelas:
 * assim renomear o formulário no editor não deixa um nome velho na listagem.
 */
function entradaDe(linha: LinhaFormulario): EntradaCatalogo {
  const d = lerDefinicao(linha);
  return {
    id: linha.id,
    nome: d.nome,
    tipo: d.tipo,
    linhaProduto: d.linhaProduto,
    painelSlug: linha.painelSlug,
    ativo: linha.ativo === 1,
    etapas: contarEtapasAtivas(d),
    atualizadoEm: linha.atualizadoEm,
  };
}

const SELECT_BASE = `
  SELECT f.id, f.painelId, f.ordem, f.ativo, f.definicao, f.atualizadoEm, p.slug AS painelSlug
    FROM formularios f
    JOIN paineis p ON p.id = f.painelId`;

export function listarEntradasDoPainel(painelSlug: string): EntradaCatalogo[] {
  const linhas = banco
    .prepare(`${SELECT_BASE} WHERE p.slug = ? ORDER BY f.ordem, f.id`)
    .all(painelSlug) as unknown as LinhaFormulario[];
  return linhas.map(entradaDe);
}

export function listarEntradasPorPainelId(painelId: number): EntradaCatalogo[] {
  const linhas = banco
    .prepare(`${SELECT_BASE} WHERE f.painelId = ? ORDER BY f.ordem, f.id`)
    .all(painelId) as unknown as LinhaFormulario[];
  return linhas.map(entradaDe);
}

function linha(id: string): LinhaFormulario | undefined {
  return banco.prepare(`${SELECT_BASE} WHERE f.id = ?`).get(id) as unknown as
    | LinhaFormulario
    | undefined;
}

export function obterDefinicao(id: string): DefinicaoFormulario | null {
  const l = linha(id);
  return l ? lerDefinicao(l) : null;
}

export function obterEntrada(id: string): EntradaCatalogo | null {
  const l = linha(id);
  return l ? entradaDe(l) : null;
}

/** Id estável e livre, derivado do painel e do tipo do checklist. */
function gerarId(painelSlug: string, tipo: 'montagem' | 'rotina'): string {
  const base = `${painelSlug}-${tipo}`;
  let id = base;
  let n = 2;
  while (banco.prepare('SELECT 1 FROM formularios WHERE id = ?').get(id)) {
    id = `${base}-${n++}`;
  }
  return id;
}

/**
 * Cria o checklist em branco de um painel. É chamado quando o painel nasce:
 * quem cadastra o painel já encontra o formulário dele esperando para ser
 * montado, em vez de ter de procurar uma segunda tela.
 */
export function criarParaPainel(entrada: {
  painelId: number;
  painelSlug: string;
  painelNome: string;
  tipo?: 'montagem' | 'rotina';
  nome?: string;
}): EntradaCatalogo {
  const tipo = entrada.tipo ?? 'montagem';
  const id = gerarId(entrada.painelSlug, tipo);
  const definicao = formularioEmBranco({
    id,
    nome: entrada.nome ?? `Checklist de ${tipo === 'rotina' ? 'Rotina' : 'Montagem'} — ${entrada.painelNome}`,
    linhaProduto: entrada.painelNome,
    tipo,
  });

  const proxima = banco
    .prepare('SELECT COALESCE(MAX(ordem), -1) + 1 AS n FROM formularios WHERE painelId = ?')
    .get(entrada.painelId) as { n: number };

  banco
    .prepare(
      `INSERT INTO formularios (id, painelId, ordem, ativo, definicao, atualizadoEm)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run(id, entrada.painelId, Number(proxima.n), JSON.stringify(definicao), Date.now());

  return obterEntrada(id)!;
}

/**
 * Grava a definição inteira. O `id` da URL manda: um JSON importado com outro
 * id é reetiquetado, e não cria um formulário solto nem sobrescreve o vizinho.
 */
export function salvarDefinicao(id: string, bruta: unknown): EntradaCatalogo {
  const definicao = validarDefinicao({ ...(bruta as object), id });
  const info = banco
    .prepare('UPDATE formularios SET definicao = ?, atualizadoEm = ? WHERE id = ?')
    .run(JSON.stringify(definicao), Date.now(), id);
  if (Number(info.changes) === 0) throw new Error('Formulário não encontrado.');
  return obterEntrada(id)!;
}

export function definirAtivo(id: string, ativo: boolean): void {
  banco.prepare('UPDATE formularios SET ativo = ?, atualizadoEm = ? WHERE id = ?').run(
    ativo ? 1 : 0,
    Date.now(),
    id,
  );
}

export function excluir(id: string): boolean {
  return Number(banco.prepare('DELETE FROM formularios WHERE id = ?').run(id).changes) > 0;
}

export function existe(id: string): boolean {
  return banco.prepare('SELECT 1 FROM formularios WHERE id = ?').get(id) !== undefined;
}

interface EntradaSemente {
  id: string;
  arquivo: string;
  paineis?: string[];
}

/**
 * Traz para o banco os checklists que vinham como arquivo em `public/forms`.
 *
 * Roda só quando a tabela está vazia. Sem isto, a primeira subida depois da
 * mudança apagaria da vista as 38 etapas do SEN Plus, que existem e estão
 * corretas — elas passam a ser linha do banco e seguem editáveis.
 */
export function semearFormularios(): void {
  const { n } = banco.prepare('SELECT COUNT(*) AS n FROM formularios').get() as { n: number };
  if (n > 0) return;

  const indice = join(PASTA_SEMENTE, 'index.json');
  if (!existsSync(indice)) {
    console.log('Nenhum catálogo de sementes em %s; os painéis começam sem checklist.', PASTA_SEMENTE);
    return;
  }

  let entradas: EntradaSemente[];
  try {
    entradas = (JSON.parse(readFileSync(indice, 'utf8')) as { formularios: EntradaSemente[] })
      .formularios;
  } catch (erro) {
    console.error('Catálogo de sementes ilegível; seguindo sem ele.', erro);
    return;
  }

  const inserir = banco.prepare(
    `INSERT INTO formularios (id, painelId, ordem, ativo, definicao, atualizadoEm)
     VALUES (?, ?, ?, 1, ?, ?)`,
  );
  const agora = Date.now();
  let importados = 0;

  for (const entrada of entradas) {
    const caminho = join(PASTA_SEMENTE, entrada.arquivo);
    if (!existsSync(caminho)) continue;
    let original: DefinicaoFormulario;
    try {
      original = validarDefinicao(JSON.parse(readFileSync(caminho, 'utf8')));
    } catch (erro) {
      console.error(`Semente "${entrada.arquivo}" inválida; ignorada.`, erro);
      continue;
    }

    // Um mesmo arquivo pode servir a vários painéis — os ensaios de rotina da
    // NBR IEC 61439 são idênticos em SPEE, SPEP e SAFR. Cada painel recebe a
    // sua cópia, porque no banco o checklist pertence a um painel só e é
    // editado ali: o primeiro fica com o id do arquivo, os demais ganham o
    // slug do painel no id.
    for (const [i, slug] of (entrada.paineis ?? []).entries()) {
      const painel = banco.prepare('SELECT id FROM paineis WHERE slug = ?').get(slug) as
        | { id: number }
        | undefined;
      if (!painel) continue;
      const id = i === 0 ? original.id : `${original.id}-${slug}`;
      const definicao = { ...original, id };
      const proxima = banco
        .prepare('SELECT COALESCE(MAX(ordem), -1) + 1 AS n FROM formularios WHERE painelId = ?')
        .get(painel.id) as { n: number };
      inserir.run(id, painel.id, Number(proxima.n), JSON.stringify(definicao), agora);
      importados++;
    }
  }

  console.log(`${importados} checklist(s) importado(s) dos arquivos para o banco.`);
}

/**
 * Garante um checklist em branco para painéis que ainda não têm nenhum.
 * Vale para os painéis semeados no primeiro boot, que nascem antes de existir
 * a rota que cria o formulário junto.
 */
export function garantirFormularioPorPainel(): void {
  const orfaos = banco
    .prepare(
      `SELECT p.id, p.slug, p.nome FROM paineis p
        WHERE NOT EXISTS (SELECT 1 FROM formularios f WHERE f.painelId = p.id)`,
    )
    .all() as Array<{ id: number; slug: string; nome: string }>;

  for (const p of orfaos) {
    criarParaPainel({ painelId: p.id, painelSlug: p.slug, painelNome: p.nome });
  }
  if (orfaos.length > 0) {
    console.log(`${orfaos.length} painel(is) receberam checklist em branco.`);
  }
}
