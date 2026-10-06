import { PDFDocument, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { quebrarLimitado, quebrarLinhas, truncar } from './texto';
import {
  BASE_CONTEUDO,
  COR,
  LARGURA_UTIL,
  MARGEM,
  PAGINA,
  TOPO_CONTEUDO,
  incorporarFontes,
  type BytesFontes,
  type Fontes,
} from './tema';
import {
  alturaMaiuscula,
  anelProgresso,
  barraProgresso,
  comRecorte,
  escrever,
  escreverDireita,
  iconeDocumento,
  larguraTexto,
  retangulo,
  selo,
  type EstiloSelo,
  type EstiloTexto,
} from './desenho';
import { etapaRespondida, etapasAtivas, type Progresso } from '../../forms/progresso';
import type { Dossie, FormularioDoDossie } from '../dossie';
import type { CampoCabecalho, Etapa, Secao, ValorGrade } from '../../forms/tipos';
import type { Midia } from '../../db/tipos';
import { dataBr } from '../../../shared/utils/texto';

const DIREITA = MARGEM.x + LARGURA_UTIL;

/** Colunas da tabela de etapas. A soma fecha a largura útil da folha. */
const COLUNAS = [
  { titulo: 'Etapa', largura: 40 },
  { titulo: 'Descrição', largura: 209 },
  { titulo: 'Aferido', largura: 72 },
  { titulo: 'Status', largura: 78 },
  { titulo: 'Data', largura: 54 },
  { titulo: 'Operador', largura: 62 },
] as const;
const X_COLUNA = COLUNAS.map((_, i) =>
  COLUNAS.slice(0, i).reduce((soma, c) => soma + c.largura, MARGEM.x),
);
const RECUO = 7;

const SELO_VERIFICADO: EstiloSelo = {
  fundo: COR.sucessoFundo,
  texto: COR.sucesso,
  ponto: COR.sucessoPonto,
};
const SELO_PENDENTE: EstiloSelo = {
  fundo: COR.pendenteFundo,
  texto: COR.pendente,
  ponto: COR.pendentePonto,
};
const SELO_NEUTRO: EstiloSelo = {
  fundo: COR.superficieForte,
  texto: COR.suave,
  ponto: COR.apagado,
};

interface Estilos {
  sobretitulo: EstiloTexto;
  sobretituloMarca: EstiloTexto;
  tituloBloco: EstiloTexto;
  corpo: EstiloTexto;
  corpoSuave: EstiloTexto;
  celula: EstiloTexto;
  celulaApagada: EstiloTexto;
  rotulo: EstiloTexto;
}

function criarEstilos(f: Fontes): Estilos {
  return {
    sobretitulo: { fonte: f.seminegrito, tamanho: 6.3, cor: COR.suave, espacamento: 0.55 },
    sobretituloMarca: { fonte: f.seminegrito, tamanho: 7.2, cor: COR.marca, espacamento: 1.1 },
    tituloBloco: { fonte: f.seminegrito, tamanho: 11, cor: COR.tinta },
    corpo: { fonte: f.regular, tamanho: 8.5, cor: COR.tinta },
    corpoSuave: { fonte: f.regular, tamanho: 7.5, cor: COR.suave },
    celula: { fonte: f.regular, tamanho: 8, cor: COR.texto },
    celulaApagada: { fonte: f.regular, tamanho: 8, cor: COR.apagado },
    rotulo: { fonte: f.regular, tamanho: 7, cor: COR.suave },
  };
}

/** Linha de base que centraliza as maiúsculas de `estilo` na altura `yCentro`. */
function baseCentrada(yCentro: number, estilo: Pick<EstiloTexto, 'tamanho'>): number {
  return yCentro - alturaMaiuscula(estilo) / 2;
}

function maiusculas(valor: string): string {
  return valor.toLocaleUpperCase('pt-BR');
}

class Folha {
  pagina!: PDFPage;
  y = 0;
  readonly estilos: Estilos;
  /** Contexto impresso à direita do cabeçalho de página. */
  contexto = '';
  /** Redesenha o cabeçalho da tabela corrente quando ela continua na página seguinte. */
  aoContinuar?: () => void;

  constructor(
    readonly doc: PDFDocument,
    readonly fontes: Fontes,
    readonly titulo: string,
  ) {
    this.estilos = criarEstilos(fontes);
  }

  novaPagina(): void {
    this.pagina = this.doc.addPage([PAGINA.largura, PAGINA.altura]);
    this.desenharCabecalho();
    this.y = TOPO_CONTEUDO;
  }

  /** Garante `altura` livre; quebra a página e retoma a tabela corrente se preciso. */
  espaco(altura: number): boolean {
    if (this.y - altura >= BASE_CONTEUDO) return false;
    this.novaPagina();
    this.aoContinuar?.();
    return true;
  }

  /** Filete na cor da marca, logotipo, título do documento e contexto. */
  private desenharCabecalho(): void {
    const { pagina, fontes } = this;
    retangulo(
      pagina,
      { x: 0, topo: PAGINA.altura, largura: PAGINA.largura, altura: 4 },
      {
        cor: COR.marca,
      },
    );
    const base = PAGINA.altura - MARGEM.topo - 4;
    const marca: EstiloTexto = { fonte: fontes.negrito, tamanho: 15, cor: COR.marca };
    const larguraMarca = escrever(pagina, 'ABB', MARGEM.x, base, marca);
    const centro = base + alturaMaiuscula(marca) / 2;

    const xDivisor = MARGEM.x + larguraMarca + 10;
    pagina.drawLine({
      start: { x: xDivisor, y: centro - 6 },
      end: { x: xDivisor, y: centro + 6 },
      thickness: 0.75,
      color: COR.linha,
    });
    const titulo: EstiloTexto = { fonte: fontes.seminegrito, tamanho: 8, cor: COR.tinta };
    const larguraTitulo = escrever(
      pagina,
      this.titulo,
      xDivisor + 10,
      baseCentrada(centro, titulo),
      titulo,
    );

    const contexto: EstiloTexto = { fonte: fontes.regular, tamanho: 8, cor: COR.suave };
    const espacoContexto = DIREITA - (xDivisor + 10 + larguraTitulo) - 24;
    escreverDireita(
      pagina,
      truncar(this.contexto, fontes.regular, 8, espacoContexto),
      DIREITA,
      baseCentrada(centro, contexto),
      contexto,
    );

    pagina.drawLine({
      start: { x: MARGEM.x, y: base - 14 },
      end: { x: DIREITA, y: base - 14 },
      thickness: 0.75,
      color: COR.linha,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Formatação                                                          */
/* ------------------------------------------------------------------ */

/** Números saem no formato brasileiro, com vírgula decimal. */
function formatarNumero(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

/** Datas ISO (AAAA-MM-DD) dos formulários saem como DD/MM/AAAA. */
function formatarData(valor: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : valor;
}

function valorCabecalho(campo: CampoCabecalho, valor: string | undefined): string {
  const limpo = (valor ?? '').trim();
  if (!limpo) return '';
  if (campo.tipo === 'data') return formatarData(limpo);
  return campo.unidade ? `${limpo} ${campo.unidade}` : limpo;
}

function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

interface Aferido {
  principal: string;
  /** Complemento discreto na mesma linha (quantidade de fotos). */
  complemento?: string;
  vazio: boolean;
}

function valorAferido(etapa: Etapa, formulario: FormularioDoDossie): Aferido {
  const resposta = formulario.respostas[etapa.id];
  const fotos = formulario.midiasPorEtapa[etapa.id]?.length ?? 0;
  const vazio: Aferido = { principal: '—', vazio: true };
  switch (etapa.tipoResposta) {
    case 'check':
      return resposta?.valor === true ? { principal: 'Sim', vazio: false } : vazio;
    case 'check_com_foto':
      return resposta?.valor === true
        ? {
            principal: 'Sim',
            complemento: fotos ? plural(fotos, 'foto', 'fotos') : 'sem foto',
            vazio: false,
          }
        : vazio;
    case 'foto':
      return fotos ? { principal: plural(fotos, 'foto', 'fotos'), vazio: false } : vazio;
    case 'anexo_pdf':
      return fotos ? { principal: plural(fotos, 'anexo', 'anexos'), vazio: false } : vazio;
    case 'numero':
      return typeof resposta?.valor === 'number'
        ? {
            principal: `${formatarNumero(resposta.valor)}${etapa.unidade ? ` ${etapa.unidade}` : ''}`,
            vazio: false,
          }
        : vazio;
    case 'texto':
    case 'selecao':
      return typeof resposta?.valor === 'string' && resposta.valor.trim()
        ? { principal: resposta.valor, vazio: false }
        : vazio;
    case 'grade_numerica':
      return resposta?.valor ? { principal: 'Ver tabela', vazio: false } : vazio;
    default:
      return vazio;
  }
}

function somarProgresso(dossie: Dossie): Progresso {
  let total = 0;
  let respondidas = 0;
  for (const tag of dossie.tags) {
    for (const formulario of tag.formularios) {
      total += formulario.progresso.total;
      respondidas += formulario.progresso.respondidas;
    }
  }
  return {
    total,
    respondidas,
    pendentes: total - respondidas,
    percentual: total === 0 ? 0 : Math.round((respondidas / total) * 100),
  };
}

function seloProgresso(progresso: Progresso): { rotulo: string; estilo: EstiloSelo } {
  if (progresso.total > 0 && progresso.pendentes === 0) {
    return { rotulo: 'Completo', estilo: SELO_VERIFICADO };
  }
  if (progresso.respondidas === 0) return { rotulo: 'Não iniciado', estilo: SELO_NEUTRO };
  return { rotulo: 'Pendente', estilo: SELO_PENDENTE };
}

function corProgresso(progresso: Progresso): RGB {
  return progresso.pendentes === 0 && progresso.total > 0 ? COR.sucessoPonto : COR.pendentePonto;
}

/* ------------------------------------------------------------------ */
/* Blocos comuns                                                       */
/* ------------------------------------------------------------------ */

function tituloBloco(folha: Folha, titulo: string, complemento?: string): void {
  const { pagina, estilos } = folha;
  const base = folha.y - 11;
  const largura = escrever(pagina, titulo, MARGEM.x, base, estilos.tituloBloco);
  if (complemento) {
    escrever(pagina, complemento, MARGEM.x + largura + 8, base, estilos.corpoSuave);
  }
  folha.y -= 24;
}

/** Faixa de cabeçalho de tabela: fundo suave, rótulos em versalete. */
function faixaCabecalho(
  folha: Folha,
  colunas: { titulo: string; x: number; largura: number; direita?: boolean }[],
): void {
  const altura = 20;
  retangulo(
    folha.pagina,
    { x: MARGEM.x, topo: folha.y, largura: LARGURA_UTIL, altura },
    {
      raio: 5,
      cor: COR.superficie,
    },
  );
  const estilo = folha.estilos.sobretitulo;
  const base = baseCentrada(folha.y - altura / 2, estilo);
  for (const coluna of colunas) {
    const rotulo = maiusculas(coluna.titulo);
    if (coluna.direita) {
      escreverDireita(folha.pagina, rotulo, coluna.x + coluna.largura - RECUO - 2, base, estilo);
    } else {
      escrever(folha.pagina, rotulo, coluna.x + RECUO, base, estilo);
    }
  }
  folha.y -= altura;
}

function filete(folha: Folha, y: number, x = MARGEM.x, largura = LARGURA_UTIL): void {
  folha.pagina.drawLine({
    start: { x, y },
    end: { x: x + largura, y },
    thickness: 0.6,
    color: COR.linhaSuave,
  });
}

/* ------------------------------------------------------------------ */
/* Capa                                                                */
/* ------------------------------------------------------------------ */

function desenharCapa(folha: Folha, dossie: Dossie, tituloTipo: string): void {
  const { pagina, fontes: f, estilos } = folha;
  const geral = somarProgresso(dossie);

  let base = folha.y - 34;
  escrever(
    pagina,
    'PROTOCOLO DE VERIFICAÇÃO DE MONTAGEM',
    MARGEM.x,
    base,
    estilos.sobretituloMarca,
  );
  base -= 36;
  for (const linha of quebrarLimitado(tituloTipo, f.negrito, 30, LARGURA_UTIL, 2)) {
    escrever(pagina, linha, MARGEM.x, base, { fonte: f.negrito, tamanho: 30, cor: COR.tinta });
    base -= 34;
  }
  base += 8;
  const subtitulo = `${dossie.projeto.empresa}  ·  ${dossie.projeto.nomeProjeto}`;
  escrever(pagina, truncar(subtitulo, f.regular, 13, LARGURA_UTIL), MARGEM.x, base, {
    fonte: f.regular,
    tamanho: 13,
    cor: COR.texto,
  });
  folha.y = base - 30;

  // Ficha do projeto: grade de 3 colunas sobre fundo suave.
  const dados: [string, string][] = [
    ['Empresa', dossie.projeto.empresa],
    ['Projeto', dossie.projeto.nomeProjeto],
    ['Operador', dossie.projeto.operador],
    ['Número do pedido', dossie.projeto.numeroPedido ?? ''],
    ['TAGs no documento', String(dossie.tags.length)],
    ['Documento gerado em', dataBr(dossie.geradoEm)],
  ];
  desenharFicha(folha, dados, 3);
  folha.y -= 34;

  // Visão geral: quatro indicadores.
  tituloBloco(folha, 'Visão geral');
  const lacuna = 10;
  const larguraCartao = (LARGURA_UTIL - lacuna * 3) / 4;
  const alturaCartao = 70;
  const indicadores: { rotulo: string; valor: string; nota: string; cor?: RGB; barra?: boolean }[] =
    [
      {
        rotulo: 'Etapas',
        valor: String(geral.total),
        nota: `em ${plural(dossie.tags.length, 'TAG', 'TAGs')}`,
      },
      {
        rotulo: 'Verificadas',
        valor: String(geral.respondidas),
        nota: `${geral.percentual}% do total`,
        cor: geral.respondidas ? COR.sucesso : COR.tinta,
      },
      {
        rotulo: 'Não verificadas',
        valor: String(geral.pendentes),
        nota: geral.pendentes ? 'aguardando registro' : 'nenhuma pendência',
        cor: geral.pendentes ? COR.pendente : COR.tinta,
      },
      { rotulo: 'Conclusão', valor: `${geral.percentual}%`, nota: '', barra: true },
    ];
  indicadores.forEach((indicador, i) => {
    const x = MARGEM.x + i * (larguraCartao + lacuna);
    const topo = folha.y;
    retangulo(
      pagina,
      { x, topo, largura: larguraCartao, altura: alturaCartao },
      {
        raio: 8,
        cor: COR.branco,
        borda: COR.linha,
      },
    );
    escrever(pagina, maiusculas(indicador.rotulo), x + 12, topo - 18, estilos.sobretitulo);
    escrever(pagina, indicador.valor, x + 12, topo - 44, {
      fonte: f.negrito,
      tamanho: 22,
      cor: indicador.cor ?? COR.tinta,
    });
    if (indicador.barra) {
      barraProgresso(
        pagina,
        x + 12,
        topo - 57,
        larguraCartao - 24,
        geral.total ? geral.respondidas / geral.total : 0,
        corProgresso(geral),
        COR.superficieForte,
      );
    } else {
      escrever(pagina, indicador.nota, x + 12, topo - 59, estilos.corpoSuave);
    }
  });
  folha.y -= alturaCartao + 34;

  desenharResumoTags(folha, dossie);
  desenharAviso(folha);
}

/** Pares rótulo/valor em grade, sobre um cartão de fundo suave. */
function desenharFicha(folha: Folha, dados: [string, string][], colunas: number): void {
  const { pagina, fontes: f, estilos } = folha;
  const recuo = 16;
  const larguraColuna = (LARGURA_UTIL - recuo * 2) / colunas;
  const larguraCampo = larguraColuna - 14;
  const lacunaLinhas = 13;
  const alturaLinhaValor = 12;

  const linhas: { rotulo: string; valor: string[]; vazio: boolean }[][] = [];
  for (let i = 0; i < dados.length; i += colunas) {
    linhas.push(
      dados.slice(i, i + colunas).map(([rotulo, valor]) => {
        const vazio = !valor.trim();
        return {
          rotulo: truncar(rotulo, f.regular, 7, larguraCampo),
          valor: vazio ? ['—'] : quebrarLimitado(valor, f.medio, 9.5, larguraCampo, 2),
          vazio,
        };
      }),
    );
  }
  const alturas = linhas.map(
    (linha) => 22 + (Math.max(...linha.map((c) => c.valor.length)) - 1) * alturaLinhaValor,
  );
  const alturaCartao =
    recuo * 2 + alturas.reduce((s, a) => s + a, 0) + lacunaLinhas * (linhas.length - 1);

  folha.espaco(alturaCartao);
  retangulo(
    pagina,
    { x: MARGEM.x, topo: folha.y, largura: LARGURA_UTIL, altura: alturaCartao },
    {
      raio: 8,
      cor: COR.superficie,
    },
  );

  let topoLinha = folha.y - recuo;
  linhas.forEach((linha, i) => {
    linha.forEach((celula, j) => {
      const x = MARGEM.x + recuo + j * larguraColuna;
      escrever(pagina, celula.rotulo, x, topoLinha - 5, estilos.rotulo);
      celula.valor.forEach((texto, k) => {
        escrever(pagina, texto, x, topoLinha - 18 - k * alturaLinhaValor, {
          fonte: f.medio,
          tamanho: 9.5,
          cor: celula.vazio ? COR.apagado : COR.tinta,
        });
      });
    });
    topoLinha -= alturas[i] + lacunaLinhas;
  });
  folha.y -= alturaCartao;
}

function desenharResumoTags(folha: Folha, dossie: Dossie): void {
  const { fontes: f } = folha;
  const larguras = [80, 150, 105, 60, 56, 64];
  const titulos = ['TAG', 'Formulário', 'Progresso', 'Verificadas', 'Pendentes', 'Situação'];
  const xs = larguras.map((_, i) => larguras.slice(0, i).reduce((s, l) => s + l, MARGEM.x));
  const colunas = titulos.map((titulo, i) => ({
    titulo,
    x: xs[i],
    largura: larguras[i],
    direita: i === 3 || i === 4,
  }));

  const linhas = dossie.tags.flatMap((tag) =>
    tag.formularios.map((formulario) => ({
      tag: tag.tag.nome,
      formulario,
      nome: quebrarLimitado(formulario.definicao.nome, f.regular, 8, larguras[1] - RECUO * 2, 2),
    })),
  );
  const alturaLinha = (n: number) => Math.max(30, 18 + n * 10.5);

  folha.espaco(24 + 20 + alturaLinha(linhas[0]?.nome.length ?? 1));
  tituloBloco(folha, 'Resumo por TAG', plural(linhas.length, 'formulário', 'formulários'));
  faixaCabecalho(folha, colunas);
  folha.aoContinuar = () => {
    tituloBloco(folha, 'Resumo por TAG', '(continuação)');
    faixaCabecalho(folha, colunas);
  };

  for (const linha of linhas) {
    const altura = alturaLinha(linha.nome.length);
    folha.espaco(altura);
    const { pagina } = folha;
    const topo = folha.y;
    const centro = topo - altura / 2;
    const progresso = linha.formulario.progresso;

    escrever(
      pagina,
      truncar(linha.tag, f.seminegrito, 8.5, larguras[0] - RECUO * 2),
      xs[0] + RECUO,
      baseCentrada(centro, { tamanho: 8.5 }),
      { fonte: f.seminegrito, tamanho: 8.5, cor: COR.tinta },
    );

    const primeiraBase = centro + ((linha.nome.length - 1) * 10.5) / 2;
    linha.nome.forEach((texto, i) => {
      escrever(
        pagina,
        texto,
        xs[1] + RECUO,
        baseCentrada(primeiraBase - i * 10.5, { tamanho: 8 }),
        {
          fonte: f.regular,
          tamanho: 8,
          cor: COR.texto,
        },
      );
    });

    const larguraBarra = larguras[2] - RECUO * 2 - 30;
    barraProgresso(
      pagina,
      xs[2] + RECUO,
      centro,
      larguraBarra,
      progresso.total ? progresso.respondidas / progresso.total : 0,
      corProgresso(progresso),
      COR.superficieForte,
    );
    escreverDireita(
      pagina,
      `${progresso.percentual}%`,
      xs[2] + larguras[2] - RECUO,
      baseCentrada(centro, { tamanho: 7.5 }),
      { fonte: f.seminegrito, tamanho: 7.5, cor: COR.tinta },
    );

    const numero: EstiloTexto = { fonte: f.regular, tamanho: 8.5, cor: COR.tinta };
    escreverDireita(
      pagina,
      String(progresso.respondidas),
      xs[3] + larguras[3] - RECUO - 2,
      baseCentrada(centro, numero),
      numero,
    );
    escreverDireita(
      pagina,
      String(progresso.pendentes),
      xs[4] + larguras[4] - RECUO - 2,
      baseCentrada(centro, numero),
      { ...numero, cor: progresso.pendentes ? COR.pendente : COR.apagado },
    );

    const situacao = seloProgresso(progresso);
    selo(pagina, situacao.rotulo, xs[5] + RECUO, centro + 6.5, f.seminegrito, situacao.estilo);

    filete(folha, topo - altura);
    folha.y -= altura;
  }
  folha.aoContinuar = undefined;
}

/** Nota sobre o significado de "Não verificado", ao pé da capa. */
function desenharAviso(folha: Folha): void {
  const { fontes: f } = folha;
  const texto =
    'Etapas sem resposta são impressas como “Não verificado”. O julgamento de conformidade é feito pelo inspetor da ABB, fora deste sistema.';
  const recuo = 12;
  const linhas = quebrarLinhas(texto, f.regular, 7.5, LARGURA_UTIL - recuo * 2 - 22);
  const altura = recuo * 2 + linhas.length * 10.5;

  folha.y -= 24;
  folha.espaco(altura);
  // Na capa, o aviso assenta no pé da página.
  const topo = Math.min(folha.y, BASE_CONTEUDO + altura);
  const { pagina } = folha;
  retangulo(
    pagina,
    { x: MARGEM.x, topo, largura: LARGURA_UTIL, altura },
    {
      raio: 8,
      cor: COR.superficie,
    },
  );
  const xIcone = MARGEM.x + recuo + 6;
  const yIcone = topo - recuo - 5;
  pagina.drawCircle({ x: xIcone, y: yIcone, size: 5.5, borderColor: COR.suave, borderWidth: 0.8 });
  const i: EstiloTexto = { fonte: f.negrito, tamanho: 6.5, cor: COR.suave };
  escrever(pagina, 'i', xIcone - larguraTexto('i', i) / 2, baseCentrada(yIcone, i), i);
  linhas.forEach((linha, n) => {
    escrever(pagina, linha, MARGEM.x + recuo + 20, topo - recuo - 7.5 - n * 10.5, {
      fonte: f.regular,
      tamanho: 7.5,
      cor: COR.texto,
    });
  });
  folha.y = topo - altura;
}

/* ------------------------------------------------------------------ */
/* Abertura da TAG                                                     */
/* ------------------------------------------------------------------ */

function desenharAberturaTag(folha: Folha, nomeTag: string, formulario: FormularioDoDossie): void {
  const { pagina, fontes: f, estilos } = folha;
  const progresso = formulario.progresso;
  const larguraBloco = LARGURA_UTIL - 170;

  let base = folha.y - 12;
  escrever(pagina, 'TAG', MARGEM.x, base, estilos.sobretituloMarca);
  base -= 28;
  escrever(pagina, truncar(nomeTag, f.negrito, 24, larguraBloco), MARGEM.x, base, {
    fonte: f.negrito,
    tamanho: 24,
    cor: COR.tinta,
  });
  const centroAnel = base + 9;
  base -= 19;
  for (const linha of quebrarLimitado(formulario.definicao.nome, f.regular, 10, larguraBloco, 2)) {
    escrever(pagina, linha, MARGEM.x, base, { fonte: f.regular, tamanho: 10, cor: COR.texto });
    base -= 13;
  }

  // Anel de progresso à direita.
  const raio = 25;
  const cx = DIREITA - raio - 3;
  anelProgresso(
    pagina,
    cx,
    centroAnel,
    raio,
    5.5,
    progresso.total ? progresso.respondidas / progresso.total : 0,
    corProgresso(progresso),
    COR.superficieForte,
  );
  const pct: EstiloTexto = { fonte: f.negrito, tamanho: 11, cor: COR.tinta };
  const textoPct = `${progresso.percentual}%`;
  escrever(
    pagina,
    textoPct,
    cx - larguraTexto(textoPct, pct) / 2,
    baseCentrada(centroAnel, pct),
    pct,
  );
  const xLegenda = cx - raio - 14;
  escreverDireita(
    pagina,
    `${progresso.respondidas} de ${progresso.total}`,
    xLegenda,
    centroAnel + 1,
    {
      fonte: f.seminegrito,
      tamanho: 11,
      cor: COR.tinta,
    },
  );
  escreverDireita(pagina, 'etapas verificadas', xLegenda, centroAnel - 11, estilos.corpoSuave);

  folha.y = base - 14;

  const definicao = formulario.definicao;
  desenharFicha(
    folha,
    [
      ['Linha de produto', definicao.linhaProduto],
      [
        'Revisão do formulário',
        `${formulario.formRevisao} · ${formatarData(definicao.dataRevisao)}`,
      ],
      ['Emitido por', definicao.emitidoPor ?? ''],
      ...definicao.cabecalho.map(
        (campo) =>
          [campo.rotulo, valorCabecalho(campo, formulario.cabecalho[campo.id])] as [string, string],
      ),
    ],
    3,
  );
  folha.y -= 30;
}

/* ------------------------------------------------------------------ */
/* Seções e etapas                                                     */
/* ------------------------------------------------------------------ */

const ALTURA_TITULO_SECAO = 27;
const ALTURA_CABECALHO_TABELA = 20;

function desenharTituloSecao(
  folha: Folha,
  secao: Secao,
  respondidas: number,
  total: number,
  continuacao: boolean,
): void {
  const { pagina, fontes: f } = folha;
  const topo = folha.y;
  const altura = 17;
  const centro = topo - altura / 2;

  const id: EstiloTexto = { fonte: f.negrito, tamanho: 8, cor: COR.branco };
  const larguraId = Math.max(larguraTexto(secao.id, id) + 12, altura + 4);
  retangulo(
    pagina,
    { x: MARGEM.x, topo, largura: larguraId, altura },
    { raio: 4.5, cor: COR.marca },
  );
  escrever(
    pagina,
    secao.id,
    MARGEM.x + (larguraId - larguraTexto(secao.id, id)) / 2,
    baseCentrada(centro, id),
    id,
  );

  const contador = `${respondidas} de ${total} verificadas`;
  const estiloContador: EstiloTexto = { fonte: f.medio, tamanho: 7.5, cor: COR.suave };
  const larguraContador = larguraTexto(contador, estiloContador);
  escreverDireita(pagina, contador, DIREITA, baseCentrada(centro, estiloContador), estiloContador);
  pagina.drawCircle({
    x: DIREITA - larguraContador - 7,
    y: centro,
    size: 2.6,
    color: respondidas === total ? COR.sucessoPonto : COR.pendentePonto,
  });

  const titulo: EstiloTexto = { fonte: f.seminegrito, tamanho: 11.5, cor: COR.tinta };
  const xTitulo = MARGEM.x + larguraId + 9;
  const espacoTitulo = DIREITA - larguraContador - 24 - xTitulo;
  const larguraTitulo = escrever(
    pagina,
    truncar(secao.titulo, f.seminegrito, 11.5, espacoTitulo - (continuacao ? 70 : 0)),
    xTitulo,
    baseCentrada(centro, titulo),
    titulo,
  );
  if (continuacao) {
    escrever(pagina, '(continuação)', xTitulo + larguraTitulo + 6, baseCentrada(centro, titulo), {
      fonte: f.regular,
      tamanho: 8.5,
      cor: COR.apagado,
    });
  }
  folha.y -= ALTURA_TITULO_SECAO;
}

function desenharCabecalhoEtapas(folha: Folha): void {
  faixaCabecalho(
    folha,
    COLUNAS.map((coluna, i) => ({
      titulo: coluna.titulo,
      x: X_COLUNA[i],
      largura: coluna.largura,
    })),
  );
}

interface MedidaEtapa {
  descricao: string[];
  detalhes: string[][];
  observacao: string[];
  aferido: Aferido;
  linhasAferido: string[];
  operador: string[];
  respondida: boolean;
  alturaGrade: number;
  altura: number;
}

const LINHA_DESCRICAO = 12;
const LINHA_DETALHE = 10.5;
const LINHA_OBSERVACAO = 10.5;
const RECUO_LINHA = 6;

function medirEtapa(folha: Folha, etapa: Etapa, formulario: FormularioDoDossie): MedidaEtapa {
  const { fontes: f } = folha;
  const resposta = formulario.respostas[etapa.id];
  const fotos = formulario.midiasPorEtapa[etapa.id]?.length ?? 0;
  const larguraDescricao = COLUNAS[1].largura - RECUO * 2;

  const descricao = quebrarLinhas(etapa.descricao, f.regular, 8.5, larguraDescricao);
  const detalhes = (etapa.detalhes ?? []).map((d) =>
    quebrarLinhas(d, f.regular, 7.5, larguraDescricao - 9),
  );
  const observacao = resposta?.observacao?.trim()
    ? quebrarLinhas(resposta.observacao, f.regular, 7.5, larguraDescricao - 16)
    : [];
  const aferido = valorAferido(etapa, formulario);
  const linhasAferido = aferido.complemento
    ? [aferido.principal]
    : quebrarLimitado(aferido.principal, f.medio, 8, COLUNAS[2].largura - RECUO * 2, 3);

  const respondida = etapaRespondida(etapa, resposta, fotos);
  const operador =
    respondida && formulario.operador.trim()
      ? quebrarLimitado(formulario.operador, f.regular, 8, COLUNAS[5].largura - RECUO * 2, 2)
      : ['—'];

  const alturaGrade =
    etapa.tipoResposta === 'grade_numerica' && resposta?.valor && etapa.grade
      ? 20 + etapa.grade.linhas.length * 15
      : 0;

  let conteudo = RECUO_LINHA + descricao.length * LINHA_DESCRICAO;
  const totalDetalhes = detalhes.reduce((s, d) => s + d.length, 0);
  if (totalDetalhes) conteudo += 2 + totalDetalhes * LINHA_DETALHE;
  if (observacao.length) conteudo += 6 + alturaObservacao(observacao.length);
  if (alturaGrade) conteudo += 8 + alturaGrade;
  conteudo += RECUO_LINHA + 2;

  const linhasCelulas = Math.max(linhasAferido.length, operador.length);
  const colunasLaterais = RECUO_LINHA * 2 + 2 + linhasCelulas * LINHA_DESCRICAO;
  return {
    descricao,
    detalhes,
    observacao,
    aferido,
    linhasAferido,
    operador,
    respondida,
    alturaGrade,
    altura: Math.max(conteudo, colunasLaterais, 26),
  };
}

function alturaObservacao(linhas: number): number {
  return 8 + 9 + linhas * LINHA_OBSERVACAO + 4;
}

function desenharEtapa(
  folha: Folha,
  etapa: Etapa,
  formulario: FormularioDoDossie,
  medida: MedidaEtapa,
): void {
  folha.espaco(medida.altura);
  const { pagina, fontes: f, estilos } = folha;
  const topo = folha.y;

  if (!medida.respondida) {
    retangulo(
      pagina,
      { x: MARGEM.x, topo, largura: LARGURA_UTIL, altura: medida.altura },
      {
        cor: COR.pendenteLinha,
      },
    );
  }

  // Centro das maiúsculas da primeira linha: referência de alinhamento da linha.
  const centro = topo - RECUO_LINHA - LINHA_DESCRICAO / 2;
  const celula = (estilo: EstiloTexto) => baseCentrada(centro, estilo);

  const id: EstiloTexto = { fonte: f.seminegrito, tamanho: 8, cor: COR.tinta };
  escrever(pagina, etapa.id, X_COLUNA[0] + RECUO, celula(id), id);

  // Descrição, detalhes e observação.
  const xDescricao = X_COLUNA[1] + RECUO;
  let cursor = topo - RECUO_LINHA;
  for (const linha of medida.descricao) {
    escrever(
      pagina,
      linha,
      xDescricao,
      baseCentrada(cursor - LINHA_DESCRICAO / 2, estilos.corpo),
      estilos.corpo,
    );
    cursor -= LINHA_DESCRICAO;
  }
  if (medida.detalhes.length) cursor -= 2;
  for (const detalhe of medida.detalhes) {
    detalhe.forEach((linha, i) => {
      const base = baseCentrada(cursor - LINHA_DETALHE / 2, estilos.corpoSuave);
      if (i === 0) {
        pagina.drawCircle({
          x: xDescricao + 2,
          y: cursor - LINHA_DETALHE / 2,
          size: 1.3,
          color: COR.apagado,
        });
      }
      escrever(pagina, linha, xDescricao + 9, base, estilos.corpoSuave);
      cursor -= LINHA_DETALHE;
    });
  }
  if (medida.observacao.length) {
    cursor -= 6;
    const altura = alturaObservacao(medida.observacao.length);
    const largura = COLUNAS[1].largura - RECUO * 2;
    retangulo(
      pagina,
      { x: xDescricao, topo: cursor, largura, altura },
      {
        raio: 4,
        cor: COR.superficie,
      },
    );
    retangulo(
      pagina,
      { x: xDescricao, topo: cursor, largura: 2.2, altura },
      {
        raio: [4, 0, 0, 4],
        cor: COR.apagado,
      },
    );
    escrever(pagina, 'OBSERVAÇÃO', xDescricao + 9, cursor - 8 - 4.5, {
      ...estilos.sobretitulo,
      tamanho: 5.8,
    });
    medida.observacao.forEach((linha, i) => {
      escrever(pagina, linha, xDescricao + 9, cursor - 17 - i * LINHA_OBSERVACAO - 7.2, {
        fonte: f.regular,
        tamanho: 7.5,
        cor: COR.texto,
      });
    });
    cursor -= altura;
  }

  // Aferido.
  const xAferido = X_COLUNA[2] + RECUO;
  const principal: EstiloTexto = {
    fonte: f.medio,
    tamanho: 8,
    cor: medida.aferido.vazio ? COR.apagado : COR.tinta,
  };
  if (medida.aferido.complemento) {
    const largura = escrever(
      pagina,
      medida.aferido.principal,
      xAferido,
      celula(principal),
      principal,
    );
    escrever(pagina, ` · ${medida.aferido.complemento}`, xAferido + largura, celula(principal), {
      fonte: f.regular,
      tamanho: 7.5,
      cor: COR.suave,
    });
  } else {
    medida.linhasAferido.forEach((linha, i) => {
      escrever(pagina, linha, xAferido, celula(principal) - i * LINHA_DESCRICAO, principal);
    });
  }

  // Status.
  selo(
    pagina,
    medida.respondida ? 'Verificado' : 'Não verificado',
    X_COLUNA[3] + RECUO,
    centro + 6.5,
    f.seminegrito,
    medida.respondida ? SELO_VERIFICADO : SELO_PENDENTE,
  );

  // Data e operador.
  const estiloCelula = medida.respondida ? estilos.celula : estilos.celulaApagada;
  escrever(
    pagina,
    medida.respondida ? dataBr(formulario.atualizadoEm) : '—',
    X_COLUNA[4] + RECUO,
    celula(estiloCelula),
    estiloCelula,
  );
  medida.operador.forEach((linha, i) => {
    escrever(
      pagina,
      linha,
      X_COLUNA[5] + RECUO,
      celula(estiloCelula) - i * LINHA_DESCRICAO,
      estiloCelula,
    );
  });

  if (medida.alturaGrade) {
    cursor -= 8;
    desenharGrade(
      folha,
      xDescricao,
      cursor,
      etapa,
      formulario.respostas[etapa.id]?.valor as ValorGrade,
    );
  }

  filete(folha, topo - medida.altura);
  folha.y -= medida.altura;
}

/** Tabela de valores dos ensaios (torque, isolamento), aninhada na etapa. */
function desenharGrade(
  folha: Folha,
  x: number,
  topo: number,
  etapa: Etapa,
  valor: ValorGrade,
): void {
  const grade = etapa.grade;
  if (!grade) return;
  const { pagina, fontes: f } = folha;
  const disponivel = DIREITA - x - RECUO;
  const larguraRotulo = 112;
  const larguraColuna = Math.min(104, (disponivel - larguraRotulo) / grade.colunas.length);
  const largura = larguraRotulo + larguraColuna * grade.colunas.length;
  const alturaCabecalho = 20;
  const alturaLinha = 15;
  const altura = alturaCabecalho + grade.linhas.length * alturaLinha;

  retangulo(pagina, { x, topo, largura, altura }, { raio: 6, cor: COR.branco });
  retangulo(
    pagina,
    { x, topo, largura, altura: alturaCabecalho },
    {
      raio: [6, 6, 0, 0],
      cor: COR.superficie,
    },
  );

  const cabecalho: EstiloTexto = { fonte: f.seminegrito, tamanho: 6.8, cor: COR.suave };
  const baseCabecalho = baseCentrada(topo - alturaCabecalho / 2, cabecalho);
  escrever(pagina, 'Ponto', x + 9, baseCabecalho, cabecalho);
  grade.colunas.forEach((coluna, i) => {
    const rotulo = `${coluna.rotulo}${coluna.unidade ? ` (${coluna.unidade})` : ''}`;
    escreverDireita(
      pagina,
      truncar(rotulo, f.seminegrito, 6.8, larguraColuna - 14),
      x + larguraRotulo + larguraColuna * (i + 1) - 9,
      baseCabecalho,
      cabecalho,
    );
  });

  grade.linhas.forEach((linha, i) => {
    const topoLinha = topo - alturaCabecalho - i * alturaLinha;
    const ultima = i === grade.linhas.length - 1;
    if (i % 2 === 1) {
      retangulo(
        pagina,
        { x, topo: topoLinha, largura, altura: alturaLinha },
        {
          raio: ultima ? [0, 0, 6, 6] : 0,
          cor: COR.zebra,
        },
      );
    }
    const centro = topoLinha - alturaLinha / 2;
    const rotulo: EstiloTexto = { fonte: f.medio, tamanho: 7.5, cor: COR.texto };
    escrever(
      pagina,
      truncar(linha.rotulo, f.medio, 7.5, larguraRotulo - 14),
      x + 9,
      baseCentrada(centro, rotulo),
      rotulo,
    );
    grade.colunas.forEach((coluna, j) => {
      const v = valor?.[linha.id]?.[coluna.id];
      const preenchido = typeof v === 'number' && Number.isFinite(v);
      const estilo: EstiloTexto = {
        fonte: preenchido ? f.medio : f.regular,
        tamanho: 7.8,
        cor: preenchido ? COR.tinta : COR.apagado,
      };
      escreverDireita(
        pagina,
        preenchido ? formatarNumero(v) : '—',
        x + larguraRotulo + larguraColuna * (j + 1) - 9,
        baseCentrada(centro, estilo),
        estilo,
      );
    });
  });

  retangulo(pagina, { x, topo, largura, altura }, { raio: 6, borda: COR.linha, espessura: 0.7 });
}

function desenharSecao(folha: Folha, secao: Secao, formulario: FormularioDoDossie): void {
  const etapas = secao.etapas.filter((e) => e.ativa !== false);
  if (!etapas.length) return;
  const medidas = etapas.map((etapa) => medirEtapa(folha, etapa, formulario));
  const respondidas = medidas.filter((m) => m.respondida).length;

  // Título da seção nunca fica órfão no pé da página.
  folha.espaco(ALTURA_TITULO_SECAO + ALTURA_CABECALHO_TABELA + medidas[0].altura);
  desenharTituloSecao(folha, secao, respondidas, etapas.length, false);
  desenharCabecalhoEtapas(folha);
  folha.aoContinuar = () => {
    desenharTituloSecao(folha, secao, respondidas, etapas.length, true);
    desenharCabecalhoEtapas(folha);
  };
  etapas.forEach((etapa, i) => desenharEtapa(folha, etapa, formulario, medidas[i]));
  folha.aoContinuar = undefined;
  folha.y -= 26;
}

/* ------------------------------------------------------------------ */
/* Registro fotográfico                                                */
/* ------------------------------------------------------------------ */

async function incorporarImagem(doc: PDFDocument, midia: Midia): Promise<PDFImage | null> {
  try {
    const bytes = new Uint8Array(await midia.blob.arrayBuffer());
    return midia.mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

async function desenharFotos(
  folha: Folha,
  formulario: FormularioDoDossie,
  nomeTag: string,
): Promise<void> {
  const etapas = etapasAtivas(formulario.definicao);
  const ordem = new Map(etapas.map((e, i) => [e.id, i]));
  const descricoes = new Map(etapas.map((e) => [e.id, e.descricao]));
  const itens = Object.entries(formulario.midiasPorEtapa)
    .filter(([, lista]) => lista.length > 0)
    .sort(([a], [b]) => (ordem.get(a) ?? Infinity) - (ordem.get(b) ?? Infinity))
    .flatMap(([etapaId, lista]) =>
      lista.map((midia, i) => ({ etapaId, midia, indice: i + 1, total: lista.length })),
    );
  if (!itens.length) return;

  const porLinha = 3;
  const lacuna = 12;
  const larguraCartao = (LARGURA_UTIL - lacuna * (porLinha - 1)) / porLinha;
  const recuo = 5;
  const alturaImagem = 158;
  const alturaLegenda = 42;
  const alturaCartao = recuo + alturaImagem + alturaLegenda;
  const alturaAbertura = 84;

  // Continua na mesma página quando cabem a abertura e uma linha de fotos.
  if (folha.y - 12 - alturaAbertura - alturaCartao < BASE_CONTEUDO) {
    folha.novaPagina();
  } else {
    folha.y -= 12;
  }
  const { fontes: f, estilos } = folha;
  let base = folha.y - 12;
  escrever(folha.pagina, 'REGISTRO FOTOGRÁFICO', MARGEM.x, base, estilos.sobretituloMarca);
  base -= 26;
  escrever(
    folha.pagina,
    truncar(`TAG ${nomeTag}`, f.negrito, 20, LARGURA_UTIL - 140),
    MARGEM.x,
    base,
    {
      fonte: f.negrito,
      tamanho: 20,
      cor: COR.tinta,
    },
  );
  const etapasComFoto = new Set(itens.map((item) => item.etapaId)).size;
  escreverDireita(
    folha.pagina,
    `${plural(itens.length, 'arquivo', 'arquivos')} · ${plural(etapasComFoto, 'etapa', 'etapas')}`,
    DIREITA,
    base,
    { fonte: f.medio, tamanho: 8, cor: COR.suave },
  );
  base -= 17;
  escrever(
    folha.pagina,
    truncar(formulario.definicao.nome, f.regular, 9.5, LARGURA_UTIL),
    MARGEM.x,
    base,
    { fonte: f.regular, tamanho: 9.5, cor: COR.texto },
  );
  folha.y = base - 22;

  for (let i = 0; i < itens.length; i += 1) {
    const coluna = i % porLinha;
    if (coluna === 0) {
      if (i > 0) folha.y -= alturaCartao + lacuna;
      folha.espaco(alturaCartao);
    }
    const item = itens[i];
    const { pagina } = folha;
    const x = MARGEM.x + coluna * (larguraCartao + lacuna);
    const topo = folha.y;
    retangulo(
      pagina,
      { x, topo, largura: larguraCartao, altura: alturaCartao },
      {
        raio: 8,
        cor: COR.branco,
        borda: COR.linha,
      },
    );
    const area = {
      x: x + recuo,
      topo: topo - recuo,
      largura: larguraCartao - recuo * 2,
      altura: alturaImagem,
    };
    retangulo(pagina, area, { raio: 5, cor: COR.superficie });

    if (item.midia.mime === 'application/pdf') {
      const larguraIcone = 26;
      const xIcone = area.x + (area.largura - larguraIcone) / 2;
      const topoIcone = area.topo - area.altura / 2 + 26;
      iconeDocumento(pagina, xIcone, topoIcone, larguraIcone, COR.apagado, COR.branco);
      const rotuloPdf: EstiloTexto = { fonte: f.negrito, tamanho: 6, cor: COR.marca };
      escrever(
        pagina,
        'PDF',
        xIcone + (larguraIcone - larguraTexto('PDF', rotuloPdf)) / 2,
        topoIcone - 24,
        rotuloPdf,
      );
      const estiloNome: EstiloTexto = { fonte: f.medio, tamanho: 7.5, cor: COR.texto };
      quebrarLimitado(
        item.midia.nomeOriginal ?? 'documento.pdf',
        f.medio,
        7.5,
        area.largura - 20,
        2,
      ).forEach((linha, n) => {
        escrever(
          pagina,
          linha,
          area.x + (area.largura - larguraTexto(linha, estiloNome)) / 2,
          topoIcone - larguraIcone * 1.3 - 16 - n * 10,
          estiloNome,
        );
      });
    } else {
      const imagem = await incorporarImagem(folha.doc, item.midia);
      if (imagem) {
        const escala = Math.min(area.largura / imagem.width, area.altura / imagem.height);
        const largura = imagem.width * escala;
        const altura = imagem.height * escala;
        const caixa = {
          x: area.x + (area.largura - largura) / 2,
          topo: area.topo - (area.altura - altura) / 2,
          largura,
          altura,
        };
        comRecorte(pagina, caixa, 5, () => {
          pagina.drawImage(imagem, {
            x: caixa.x,
            y: caixa.topo - altura,
            width: largura,
            height: altura,
          });
        });
      } else {
        const aviso = 'Imagem não pôde ser incorporada';
        const estiloAviso = estilos.corpoSuave;
        escrever(
          pagina,
          aviso,
          area.x + (area.largura - larguraTexto(aviso, estiloAviso)) / 2,
          area.topo - area.altura / 2,
          estiloAviso,
        );
      }
    }

    const baseLegenda = topo - recuo - alturaImagem - 14;
    const etapa: EstiloTexto = { fonte: f.seminegrito, tamanho: 8, cor: COR.tinta };
    const larguraEtapa = escrever(pagina, item.etapaId, x + 9, baseLegenda, etapa);
    escrever(
      pagina,
      item.total > 1 ? `  ·  ${item.indice} de ${item.total}` : '',
      x + 9 + larguraEtapa,
      baseLegenda,
      { fonte: f.regular, tamanho: 7.5, cor: COR.suave },
    );
    quebrarLimitado(
      descricoes.get(item.etapaId) ?? '',
      f.regular,
      7,
      larguraCartao - 18,
      2,
    ).forEach((linha, n) => {
      escrever(pagina, linha, x + 9, baseLegenda - 12 - n * 9, {
        fonte: f.regular,
        tamanho: 7,
        cor: COR.suave,
      });
    });
  }
  folha.y -= alturaCartao + lacuna;
}

/* ------------------------------------------------------------------ */
/* Rodapé                                                              */
/* ------------------------------------------------------------------ */

function numerarPaginas(doc: PDFDocument, fontes: Fontes, rodape: string): void {
  const paginas = doc.getPages();
  const base = MARGEM.base - 12;
  const estilo: EstiloTexto = { fonte: fontes.regular, tamanho: 7, cor: COR.suave };
  const destaque: EstiloTexto = { fonte: fontes.seminegrito, tamanho: 7, cor: COR.tinta };
  paginas.forEach((pagina, i) => {
    pagina.drawLine({
      start: { x: MARGEM.x, y: MARGEM.base },
      end: { x: DIREITA, y: MARGEM.base },
      thickness: 0.75,
      color: COR.linha,
    });
    escrever(pagina, truncar(rodape, fontes.regular, 7, LARGURA_UTIL - 90), MARGEM.x, base, estilo);
    const numero = `${i + 1} de ${paginas.length}`;
    const larguraNumero = larguraTexto(numero, destaque);
    escreverDireita(pagina, numero, DIREITA, base, destaque);
    escreverDireita(pagina, 'Página ', DIREITA - larguraNumero, base, estilo);
  });
}

/* ------------------------------------------------------------------ */
/* Documento                                                           */
/* ------------------------------------------------------------------ */

export interface OpcoesPdf {
  incluirFotos: boolean;
  /** Título do tipo de verificação impresso na capa. */
  tituloTipo: string;
  /** Família tipográfica do documento. Sem ela, o PDF sai em Helvetica. */
  fontes?: BytesFontes;
}

/**
 * Monta um único PDF com todas as TAGs do projeto: capa com indicadores,
 * abertura por TAG, tabelas de etapas por seção e registro fotográfico.
 */
export async function gerarPdf(dossie: Dossie, opcoes: OpcoesPdf): Promise<Blob> {
  const doc = await PDFDocument.create();
  const fontes = await incorporarFontes(doc, opcoes.fontes);
  const { empresa, nomeProjeto } = dossie.projeto;

  doc.setTitle(`${opcoes.tituloTipo} — ${empresa} — ${nomeProjeto}`);
  doc.setSubject('Protocolo de verificação de montagem');
  doc.setLanguage('pt-BR');
  doc.setProducer('Sistema de Verificação de Montagem de Painéis');
  doc.setCreator('Sistema de Verificação de Montagem de Painéis');
  doc.setCreationDate(dossie.geradoEm);

  const contexto = `${empresa} · ${nomeProjeto}`;
  const folha = new Folha(doc, fontes, opcoes.tituloTipo);
  folha.contexto = `Gerado em ${dataBr(dossie.geradoEm)}`;
  folha.novaPagina();
  desenharCapa(folha, dossie, opcoes.tituloTipo);

  for (const tag of dossie.tags) {
    for (const formulario of tag.formularios) {
      folha.contexto = `${contexto} · TAG ${tag.tag.nome}`;
      folha.novaPagina();
      desenharAberturaTag(folha, tag.tag.nome, formulario);
      for (const secao of formulario.definicao.secoes) {
        desenharSecao(folha, secao, formulario);
      }
      if (opcoes.incluirFotos) {
        await desenharFotos(folha, formulario, tag.tag.nome);
      }
    }
  }

  numerarPaginas(doc, fontes, `${contexto} · gerado em ${dataBr(dossie.geradoEm)}`);

  const bytes = await doc.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}
