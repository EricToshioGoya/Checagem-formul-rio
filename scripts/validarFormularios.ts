/**
 * Valida os JSON de `public/forms` contra o schema Zod do motor.
 * Roda no terminal (`npm run validar-formularios`) e no build, para que um
 * formulário quebrado nunca chegue ao dispositivo do montador.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { catalogoSchema, definicaoFormularioSchema, descreverErro } from '../src/core/forms/schema';

const pasta = join(process.cwd(), 'public', 'forms');
let falhas = 0;

function ler(arquivo: string): unknown {
  return JSON.parse(readFileSync(join(pasta, arquivo), 'utf-8'));
}

const catalogo = catalogoSchema.safeParse(ler('index.json'));
if (!catalogo.success) {
  console.error('index.json inválido:\n' + descreverErro(catalogo.error));
  process.exit(1);
}

const arquivosNoDisco = readdirSync(pasta).filter((f) => f.endsWith('.json') && f !== 'index.json');

for (const entrada of catalogo.data.formularios) {
  const analise = definicaoFormularioSchema.safeParse(ler(entrada.arquivo));
  if (!analise.success) {
    console.error(`\n${entrada.arquivo} inválido:\n${descreverErro(analise.error)}`);
    falhas += 1;
    continue;
  }
  const definicao = analise.data;
  if (definicao.id !== entrada.id) {
    console.error(`\n${entrada.arquivo}: id "${definicao.id}" difere do catálogo ("${entrada.id}").`);
    falhas += 1;
    continue;
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
  (f) => !catalogo.data.formularios.some((e) => e.arquivo === f),
);
if (orfaos.length) {
  console.warn(`\nArquivos fora do catálogo (não serão carregados): ${orfaos.join(', ')}`);
}

if (falhas > 0) {
  console.error(`\n${falhas} problema(s) encontrado(s).`);
  process.exit(1);
}
console.log('\nTodos os formulários são válidos.');
