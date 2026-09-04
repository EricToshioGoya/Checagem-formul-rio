/**
 * Valida os arquivos de dados de `public/` contra os schemas Zod do motor:
 * formulários, catálogo de painéis e templates de certificado.
 * Roda no terminal (`npm run validar-formularios`) e no build, para que um
 * arquivo quebrado nunca chegue ao dispositivo do montador.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { catalogoSchema, definicaoFormularioSchema, descreverErro } from '../src/core/forms/schema';
import { catalogoPaineisSchema } from '../src/core/paineis/schema';
import { templateCertificadoSchema } from '../src/core/certificado/schema';

const raiz = join(process.cwd(), 'public');
const pasta = join(raiz, 'forms');
let falhas = 0;

function ler(arquivo: string): unknown {
  return JSON.parse(readFileSync(join(pasta, arquivo), 'utf-8'));
}

function lerDe(...partes: string[]): unknown {
  return JSON.parse(readFileSync(join(raiz, ...partes), 'utf-8'));
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

  // A etapa apontada por `exibirSe` precisa existir e ser de seleção com as
  // opções esperadas; do contrário a etapa condicional nunca apareceria.
  const porId = new Map(
    definicao.secoes.flatMap((s) => s.etapas).map((e) => [e.id, e] as const),
  );
  for (const etapa of porId.values()) {
    const condicao = etapa.exibirSe;
    if (!condicao) continue;
    const alvo = porId.get(condicao.etapaId);
    if (!alvo) {
      console.error(
        `\n${entrada.arquivo}: etapa "${etapa.id}" depende de "${condicao.etapaId}", que não existe.`,
      );
      falhas += 1;
      continue;
    }
    const faltando = condicao.igualA.filter((v) => !(alvo.opcoes ?? []).includes(v));
    if (faltando.length) {
      console.error(
        `\n${entrada.arquivo}: etapa "${etapa.id}" espera de "${alvo.id}" o valor ` +
          `${faltando.map((v) => `"${v}"`).join(', ')}, fora das opções declaradas.`,
      );
      falhas += 1;
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

// ---- catálogo de painéis e templates de certificado ----

const paineis = catalogoPaineisSchema.safeParse(lerDe('paineis', 'index.json'));
if (!paineis.success) {
  console.error('\npaineis/index.json inválido:\n' + descreverErro(paineis.error));
  process.exit(1);
}

for (const painel of paineis.data.paineis) {
  for (const formId of painel.formularios) {
    if (!catalogo.data.formularios.some((f) => f.id === formId)) {
      console.error(
        `\npaineis/index.json: painel "${painel.id}" aponta para o formulário ` +
          `"${formId}", que não consta em forms/index.json.`,
      );
      falhas += 1;
    }
  }

  if (!painel.certificado) continue;
  const caminho = join(raiz, 'certificados', `${painel.certificado}.json`);
  if (!existsSync(caminho)) {
    console.error(
      `\npaineis/index.json: painel "${painel.id}" aponta para o template ` +
        `"${painel.certificado}", que não existe em certificados/.`,
    );
    falhas += 1;
    continue;
  }
  const template = templateCertificadoSchema.safeParse(
    lerDe('certificados', `${painel.certificado}.json`),
  );
  if (!template.success) {
    console.error(
      `\ncertificados/${painel.certificado}.json inválido:\n${descreverErro(template.error)}`,
    );
    falhas += 1;
    continue;
  }
  console.log(
    `certificados/${painel.certificado}.json: ${template.data.blocos.length} blocos — OK`,
  );
}

console.log(
  `paineis/index.json: ${paineis.data.paineis.length} painéis, ` +
    `${paineis.data.camposPadrao.length} campos padrão — OK`,
);

if (falhas > 0) {
  console.error(`\n${falhas} problema(s) encontrado(s).`);
  process.exit(1);
}
console.log('\nTodos os arquivos de dados são válidos.');
