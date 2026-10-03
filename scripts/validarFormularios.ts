/**
 * Valida os JSON de `public/forms` contra o schema Zod do motor.
 *
 * Desde que os checklists passaram a morar no servidor, esta pasta é apenas a
 * semente: o que o servidor importa para o banco na primeira subida. Continua
 * valendo validá-la no build — uma semente quebrada é um painel que nasce sem
 * checklist e ninguém percebe até o montador abrir.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  definicaoFormularioSchema,
  descreverErro,
} from '../compartilhado/formulario';

/** Formato do índice das sementes; é lido pelo servidor, não pelo cliente. */
const indiceSchema = z.object({
  formularios: z
    .array(
      z.object({
        id: z.string().min(1),
        arquivo: z.string().min(1),
        paineis: z.array(z.string().min(1)).optional().default([]),
      }),
    )
    .min(1),
});

const pasta = join(process.cwd(), 'public', 'forms');
let falhas = 0;

function ler(arquivo: string): unknown {
  return JSON.parse(readFileSync(join(pasta, arquivo), 'utf-8'));
}

const indice = indiceSchema.safeParse(ler('index.json'));
if (!indice.success) {
  console.error('index.json inválido:\n' + descreverErro(indice.error));
  process.exit(1);
}

const arquivosNoDisco = readdirSync(pasta).filter((f) => f.endsWith('.json') && f !== 'index.json');

for (const entrada of indice.data.formularios) {
  const analise = definicaoFormularioSchema.safeParse(ler(entrada.arquivo));
  if (!analise.success) {
    console.error(`\n${entrada.arquivo} inválido:\n${descreverErro(analise.error)}`);
    falhas += 1;
    continue;
  }
  const definicao = analise.data;
  if (definicao.id !== entrada.id) {
    console.error(`\n${entrada.arquivo}: id "${definicao.id}" difere do índice ("${entrada.id}").`);
    falhas += 1;
    continue;
  }
  if (entrada.paineis.length === 0) {
    console.warn(`\n${entrada.arquivo}: sem painel no índice — não será importado.`);
  }

  const ids = new Set<string>();
  for (const secao of definicao.secoes) {
    for (const etapa of secao.etapas) {
      if (ids.has(etapa.id)) {
        console.error(`\n${entrada.arquivo}: etapa duplicada "${etapa.id}".`);
        falhas += 1;
      }
      ids.add(etapa.id);
      if (etapa.tipoResposta === 'selecao' && !etapa.opcoes?.length) {
        console.error(`\n${entrada.arquivo}: etapa "${etapa.id}" é seleção e não tem opções.`);
        falhas += 1;
      }
      if (etapa.tipoResposta === 'grade_numerica' && !etapa.grade) {
        console.error(`\n${entrada.arquivo}: etapa "${etapa.id}" é grade e não tem configuração.`);
        falhas += 1;
      }
    }
  }

  const pendentes = definicao.secoes
    .flatMap((s) => s.etapas)
    .filter((e) => e.pendenteTranscricao)
    .map((e) => e.id);

  console.log(
    `${entrada.arquivo}: ${ids.size} etapas em ${definicao.secoes.length} seções — OK` +
      (pendentes.length ? `\n  pendentes de conferência: ${pendentes.join(', ')}` : ''),
  );
}

const orfaos = arquivosNoDisco.filter(
  (f) => !indice.data.formularios.some((e) => e.arquivo === f),
);
if (orfaos.length) {
  console.warn(`\nArquivos fora do índice (não serão importados): ${orfaos.join(', ')}`);
}

if (falhas > 0) {
  console.error(`\n${falhas} problema(s) encontrado(s).`);
  process.exit(1);
}
console.log('\nTodas as sementes são válidas.');
