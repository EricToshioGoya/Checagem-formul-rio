import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { quebrarLinhas, sanitizar, truncar } from './texto';
import { etapaRespondida, etapaVisivel } from '../../forms/progresso';
import type { Dossie, FormularioDoDossie } from '../dossie';
import type { Etapa, ValorGrade } from '../../forms/tipos';
import { dataBr } from '../../../shared/utils/texto';

const PAGINA = { largura: 595.28, altura: 841.89 };
const MARGEM = 30;
const LARGURA_UTIL = PAGINA.largura - MARGEM * 2;

const VERMELHO = rgb(1, 0, 0.06);
const PRETO = rgb(0.12, 0.12, 0.12);
const CINZA = rgb(0.42, 0.42, 0.42);
const CINZA_CLARO = rgb(0.85, 0.85, 0.85);
const FUNDO_CABECALHO = rgb(0.93, 0.93, 0.93);
const VERDE = rgb(0.05, 0.42, 0.16);

/** Colunas do formulário impresso ABB. A soma fecha a largura útil da folha. */
const COLUNAS = [
  { chave: 'etapa', titulo: 'Etapa', largura: 42 },
  { chave: 'descricao', titulo: 'Descrição', largura: 231 },
  { chave: 'aferido', titulo: 'Aferido', largura: 72 },
  { chave: 'status', titulo: 'Status', largura: 70 },
  { chave: 'data', titulo: 'Data', largura: 52 },
  { chave: 'operador', titulo: 'Operador', largura: 68 },
] as const;

interface Fontes {
  normal: PDFFont;
  negrito: PDFFont;
  italico: PDFFont;
}

class Folha {
  doc: PDFDocument;
  fontes: Fontes;
  pagina!: PDFPage;
  y = 0;
  tituloCorrente = '';

  constructor(doc: PDFDocument, fontes: Fontes) {
    this.doc = doc;
    this.fontes = fontes;
    this.novaPagina();
  }

  novaPagina(): void {
    this.pagina = this.doc.addPage([PAGINA.largura, PAGINA.altura]);
    this.y = PAGINA.altura - MARGEM;
    this.desenharTopo();
  }

  /** Faixa superior com a marca e o título do documento. */
  private desenharTopo(): void {
    const alturaFaixa = 26;
    this.pagina.drawRectangle({
      x: MARGEM,
      y: this.y - alturaFaixa,
      width: LARGURA_UTIL,
      height: alturaFaixa,
      color: rgb(1, 1, 1),
      borderColor: CINZA_CLARO,
      borderWidth: 0.7,
    });
    this.pagina.drawText('ABB', {
      x: MARGEM + 8,
      y: this.y - 19,
      size: 16,
      font: this.fontes.negrito,
      color: VERMELHO,
    });
    if (this.tituloCorrente) {
      this.pagina.drawText(
        truncar(this.tituloCorrente, this.fontes.normal, 9, LARGURA_UTIL - 70),
        {
          x: MARGEM + 52,
          y: this.y - 17,
          size: 9,
          font: this.fontes.normal,
          color: CINZA,
        },
      );
    }
    this.y -= alturaFaixa + 12;
  }

  espaco(altura: number): void {
    if (this.y - altura < MARGEM + 24) this.novaPagina();
  }

  linha(altura = 8): void {
    this.y -= altura;
  }

  texto(
    valor: string,
    opcoes: { tamanho?: number; negrito?: boolean; cor?: typeof PRETO; x?: number } = {},
  ): void {
    const tamanho = opcoes.tamanho ?? 10;
    const fonte = opcoes.negrito ? this.fontes.negrito : this.fontes.normal;
    const linhas = quebrarLinhas(valor, fonte, tamanho, LARGURA_UTIL);
    for (const linha of linhas) {
      this.espaco(tamanho + 4);
      this.pagina.drawText(linha, {
        x: opcoes.x ?? MARGEM,
        y: this.y - tamanho,
        size: tamanho,
        font: fonte,
        color: opcoes.cor ?? PRETO,
      });
      this.y -= tamanho + 3;
    }
  }

  titulo(valor: string, tamanho = 14): void {
    this.espaco(tamanho + 14);
    this.texto(valor, { tamanho, negrito: true });
    this.y -= 4;
  }

  /** Cabeçalho de seção destacado, como no formulário impresso. */
  faixaSecao(valor: string): void {
    const altura = 20;
    this.espaco(altura + 8);
    this.pagina.drawRectangle({
      x: MARGEM,
      y: this.y - altura,
      width: LARGURA_UTIL,
      height: altura,
      color: VERMELHO,
    });
    this.pagina.drawText(truncar(valor, this.fontes.negrito, 11, LARGURA_UTIL - 12), {
      x: MARGEM + 6,
      y: this.y - altura + 6,
      size: 11,
      font: this.fontes.negrito,
      color: rgb(1, 1, 1),
    });
    this.y -= altura + 6;
  }

  /** Tabela simples de duas colunas (dados do projeto e do painel). */
  tabelaDados(linhas: [string, string][]): void {
    const alturaLinha = 16;
    const larguraRotulo = 150;
    for (const [rotulo, valor] of linhas) {
      this.espaco(alturaLinha);
      this.pagina.drawRectangle({
        x: MARGEM,
        y: this.y - alturaLinha,
        width: larguraRotulo,
        height: alturaLinha,
        color: FUNDO_CABECALHO,
        borderColor: CINZA_CLARO,
        borderWidth: 0.7,
      });
      this.pagina.drawRectangle({
        x: MARGEM + larguraRotulo,
        y: this.y - alturaLinha,
        width: LARGURA_UTIL - larguraRotulo,
        height: alturaLinha,
        borderColor: CINZA_CLARO,
        borderWidth: 0.7,
      });
      this.pagina.drawText(truncar(rotulo, this.fontes.negrito, 9, larguraRotulo - 8), {
        x: MARGEM + 4,
        y: this.y - alturaLinha + 5,
        size: 9,
        font: this.fontes.negrito,
        color: PRETO,
      });
      this.pagina.drawText(
        truncar(valor || '—', this.fontes.normal, 9, LARGURA_UTIL - larguraRotulo - 8),
        {
          x: MARGEM + larguraRotulo + 4,
          y: this.y - alturaLinha + 5,
          size: 9,
          font: this.fontes.normal,
          color: PRETO,
        },
      );
      this.y -= alturaLinha;
    }
    this.y -= 8;
  }
}

/** Números saem no formato brasileiro, com vírgula decimal. */
function formatarNumero(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function valorAferido(etapa: Etapa, formulario: FormularioDoDossie): string {
  const resposta = formulario.respostas[etapa.id];
  const fotos = formulario.midiasPorEtapa[etapa.id]?.length ?? 0;
  switch (etapa.tipoResposta) {
    case 'check':
      return resposta?.valor === true ? 'Sim' : '—';
    case 'check_com_foto':
      return resposta?.valor === true ? `Sim (${fotos} foto${fotos === 1 ? '' : 's'})` : '—';
    case 'foto':
      return fotos ? `${fotos} foto${fotos === 1 ? '' : 's'}` : '—';
    case 'anexo_pdf':
      return fotos ? `${fotos} anexo${fotos === 1 ? '' : 's'}` : '—';
    case 'numero':
      return typeof resposta?.valor === 'number'
        ? `${formatarNumero(resposta.valor)}${etapa.unidade ? ` ${etapa.unidade}` : ''}`
        : '—';
    case 'texto':
    case 'selecao':
      return typeof resposta?.valor === 'string' && resposta.valor ? resposta.valor : '—';
    case 'grade_numerica':
      return resposta?.valor ? 'Ver tabela' : '—';
    default:
      return '—';
  }
}

function desenharCabecalhoTabela(folha: Folha): void {
  const altura = 18;
  folha.espaco(altura + 20);
  let x = MARGEM;
  for (const coluna of COLUNAS) {
    folha.pagina.drawRectangle({
      x,
      y: folha.y - altura,
      width: coluna.largura,
      height: altura,
      color: FUNDO_CABECALHO,
      borderColor: CINZA_CLARO,
      borderWidth: 0.7,
    });
    folha.pagina.drawText(coluna.titulo, {
      x: x + 3,
      y: folha.y - altura + 6,
      size: 8.5,
      font: folha.fontes.negrito,
      color: PRETO,
    });
    x += coluna.largura;
  }
  folha.y -= altura;
}

function desenharGrade(folha: Folha, etapa: Etapa, valor: ValorGrade): void {
  const grade = etapa.grade;
  if (!grade) return;
  const larguraRotulo = 110;
  const larguraColuna = (LARGURA_UTIL - larguraRotulo - 20) / grade.colunas.length;
  const alturaLinha = 13;

  folha.espaco(alturaLinha * (grade.linhas.length + 1) + 10);
  let x = MARGEM + 20;
  folha.pagina.drawText('Ponto', {
    x: x + 3,
    y: folha.y - alturaLinha + 4,
    size: 7.5,
    font: folha.fontes.negrito,
    color: PRETO,
  });
  x += larguraRotulo;
  for (const coluna of grade.colunas) {
    folha.pagina.drawText(
      truncar(
        `${coluna.rotulo}${coluna.unidade ? ` (${coluna.unidade})` : ''}`,
        folha.fontes.negrito,
        7.5,
        larguraColuna - 4,
      ),
      { x: x + 3, y: folha.y - alturaLinha + 4, size: 7.5, font: folha.fontes.negrito, color: PRETO },
    );
    x += larguraColuna;
  }
  folha.y -= alturaLinha;

  for (const linha of grade.linhas) {
    folha.espaco(alturaLinha);
    let cx = MARGEM + 20;
    folha.pagina.drawRectangle({
      x: cx,
      y: folha.y - alturaLinha,
      width: larguraRotulo + larguraColuna * grade.colunas.length,
      height: alturaLinha,
      borderColor: CINZA_CLARO,
      borderWidth: 0.5,
    });
    folha.pagina.drawText(truncar(linha.rotulo, folha.fontes.normal, 7.5, larguraRotulo - 6), {
      x: cx + 3,
      y: folha.y - alturaLinha + 4,
      size: 7.5,
      font: folha.fontes.normal,
      color: PRETO,
    });
    cx += larguraRotulo;
    for (const coluna of grade.colunas) {
      const v = valor?.[linha.id]?.[coluna.id];
      folha.pagina.drawText(
        typeof v === 'number' && Number.isFinite(v) ? formatarNumero(v) : '—',
        { x: cx + 3, y: folha.y - alturaLinha + 4, size: 7.5, font: folha.fontes.normal, color: PRETO },
      );
      cx += larguraColuna;
    }
    folha.y -= alturaLinha;
  }
  folha.y -= 6;
}

function desenharEtapa(folha: Folha, etapa: Etapa, formulario: FormularioDoDossie): void {
  const resposta = formulario.respostas[etapa.id];
  const fotos = formulario.midiasPorEtapa[etapa.id]?.length ?? 0;
  const respondida = etapaRespondida(etapa, resposta, fotos);
  const operador = formulario.operador ?? '';

  const colDescricao = COLUNAS[1].largura - 6;
  const linhasDescricao = quebrarLinhas(etapa.descricao, folha.fontes.normal, 8.5, colDescricao);
  const linhasDetalhe = (etapa.detalhes ?? []).flatMap((d) =>
    quebrarLinhas(`- ${d}`, folha.fontes.normal, 7, colDescricao),
  );
  const linhasObs = resposta?.observacao
    ? quebrarLinhas(`Obs.: ${resposta.observacao}`, folha.fontes.italico, 7.5, colDescricao)
    : [];

  const alturaConteudo =
    linhasDescricao.length * 10 + linhasDetalhe.length * 8 + linhasObs.length * 9 + 8;
  const altura = Math.max(alturaConteudo, 22);
  folha.espaco(altura + 6);

  let x = MARGEM;
  for (const coluna of COLUNAS) {
    folha.pagina.drawRectangle({
      x,
      y: folha.y - altura,
      width: coluna.largura,
      height: altura,
      borderColor: CINZA_CLARO,
      borderWidth: 0.7,
    });
    x += coluna.largura;
  }

  const topo = folha.y - 11;
  folha.pagina.drawText(sanitizar(etapa.id), {
    x: MARGEM + 3,
    y: topo,
    size: 8.5,
    font: folha.fontes.negrito,
    color: PRETO,
  });

  let yTexto = topo;
  const xDescricao = MARGEM + COLUNAS[0].largura + 3;
  for (const linha of linhasDescricao) {
    folha.pagina.drawText(linha, {
      x: xDescricao,
      y: yTexto,
      size: 8.5,
      font: folha.fontes.normal,
      color: PRETO,
    });
    yTexto -= 10;
  }
  for (const linha of linhasDetalhe) {
    folha.pagina.drawText(linha, {
      x: xDescricao,
      y: yTexto,
      size: 7,
      font: folha.fontes.normal,
      color: CINZA,
    });
    yTexto -= 8;
  }
  for (const linha of linhasObs) {
    folha.pagina.drawText(linha, {
      x: xDescricao,
      y: yTexto,
      size: 7.5,
      font: folha.fontes.italico,
      color: PRETO,
    });
    yTexto -= 9;
  }

  const xAferido = MARGEM + COLUNAS[0].largura + COLUNAS[1].largura + 3;
  folha.pagina.drawText(
    truncar(valorAferido(etapa, formulario), folha.fontes.normal, 8, COLUNAS[2].largura - 6),
    { x: xAferido, y: topo, size: 8, font: folha.fontes.normal, color: PRETO },
  );

  const xStatus = xAferido + COLUNAS[2].largura;
  folha.pagina.drawText(respondida ? 'Verificado' : 'Não verificado', {
    x: xStatus,
    y: topo,
    size: 8,
    font: folha.fontes.negrito,
    color: respondida ? VERDE : VERMELHO,
  });

  const xData = xStatus + COLUNAS[3].largura;
  folha.pagina.drawText(respondida ? dataBr(formulario.atualizadoEm) : '—', {
    x: xData,
    y: topo,
    size: 8,
    font: folha.fontes.normal,
    color: PRETO,
  });

  const xOperador = xData + COLUNAS[4].largura;
  folha.pagina.drawText(
    truncar(respondida ? operador : '—', folha.fontes.normal, 8, COLUNAS[5].largura - 6),
    { x: xOperador, y: topo, size: 8, font: folha.fontes.normal, color: PRETO },
  );

  folha.y -= altura;

  if (etapa.tipoResposta === 'grade_numerica' && resposta?.valor) {
    desenharGrade(folha, etapa, resposta.valor as ValorGrade);
  }
}

async function desenharFotos(
  folha: Folha,
  formulario: FormularioDoDossie,
  nomeTag: string,
): Promise<void> {
  const etapasComFoto = Object.entries(formulario.midiasPorEtapa).filter(
    ([, lista]) => lista.length > 0,
  );
  if (!etapasComFoto.length) return;

  folha.novaPagina();
  folha.titulo(`Registro fotográfico — ${nomeTag}`, 12);
  folha.texto(formulario.definicao.nome, { tamanho: 9, cor: CINZA });
  folha.linha(6);

  const largura = (LARGURA_UTIL - 12) / 2;
  const alturaMax = 150;

  for (const [etapaId, lista] of etapasComFoto) {
    folha.espaco(24);
    folha.texto(`Etapa ${etapaId}`, { tamanho: 10, negrito: true });
    let coluna = 0;
    let alturaLinhaAtual = 0;
    for (let i = 0; i < lista.length; i += 1) {
      const midia = lista[i];
      if (midia.mime === 'application/pdf') {
        folha.texto(`Anexo em PDF: ${midia.nomeOriginal ?? 'documento.pdf'}`, {
          tamanho: 8,
          cor: CINZA,
        });
        continue;
      }
      const bytes = new Uint8Array(await midia.blob.arrayBuffer());
      let imagem;
      try {
        imagem = midia.mime === 'image/png'
          ? await folha.doc.embedPng(bytes)
          : await folha.doc.embedJpg(bytes);
      } catch {
        folha.texto(`Foto ${i + 1} não pôde ser incorporada.`, { tamanho: 8, cor: CINZA });
        continue;
      }
      const escala = Math.min(largura / imagem.width, alturaMax / imagem.height, 1);
      const larguraFinal = imagem.width * escala;
      const alturaFinal = imagem.height * escala;

      if (coluna === 0) {
        folha.espaco(alturaFinal + 26);
        alturaLinhaAtual = alturaFinal;
      } else {
        alturaLinhaAtual = Math.max(alturaLinhaAtual, alturaFinal);
      }

      const x = MARGEM + coluna * (largura + 12);
      folha.pagina.drawImage(imagem, {
        x,
        y: folha.y - alturaFinal,
        width: larguraFinal,
        height: alturaFinal,
      });
      folha.pagina.drawText(sanitizar(`${nomeTag} — ${etapaId} — foto ${i + 1}`), {
        x,
        y: folha.y - alturaFinal - 10,
        size: 7.5,
        font: folha.fontes.normal,
        color: CINZA,
      });

      coluna += 1;
      if (coluna === 2) {
        coluna = 0;
        folha.y -= alturaLinhaAtual + 22;
      }
    }
    if (coluna === 1) folha.y -= alturaLinhaAtual + 22;
    folha.linha(4);
  }
}

function desenharCapa(folha: Folha, dossie: Dossie, tituloTipo: string): void {
  folha.titulo('Protocolo de verificação de montagem', 16);
  folha.texto(tituloTipo, { tamanho: 12, negrito: true, cor: VERMELHO });
  folha.linha(10);

  folha.tabelaDados([
    ['Empresa', dossie.projeto.empresa],
    ['Projeto', dossie.projeto.nomeProjeto],
    ['Operador', dossie.projeto.operador],
    ['Número do pedido', dossie.projeto.numeroPedido ?? ''],
    ['Quantidade de TAGs', String(dossie.tags.length)],
    ['Documento gerado em', dataBr(dossie.geradoEm)],
  ]);

  folha.titulo('Resumo de pendências por TAG', 12);

  const colunas: [string, number][] = [
    ['TAG', 150],
    ['Formulário', 175],
    ['Respondidas', 70],
    ['Pendentes', 65],
    ['%', 75],
  ];
  const alturaLinha = 16;

  folha.espaco(alturaLinha);
  let x = MARGEM;
  for (const [titulo, largura] of colunas) {
    folha.pagina.drawRectangle({
      x,
      y: folha.y - alturaLinha,
      width: largura,
      height: alturaLinha,
      color: FUNDO_CABECALHO,
      borderColor: CINZA_CLARO,
      borderWidth: 0.7,
    });
    folha.pagina.drawText(titulo, {
      x: x + 4,
      y: folha.y - alturaLinha + 5,
      size: 9,
      font: folha.fontes.negrito,
      color: PRETO,
    });
    x += largura;
  }
  folha.y -= alturaLinha;

  for (const tag of dossie.tags) {
    for (const formulario of tag.formularios) {
      folha.espaco(alturaLinha);
      const valores = [
        tag.tag.nome,
        formulario.definicao.nome,
        String(formulario.progresso.respondidas),
        String(formulario.progresso.pendentes),
        `${formulario.progresso.percentual}%`,
      ];
      let cx = MARGEM;
      valores.forEach((valor, i) => {
        const largura = colunas[i][1];
        folha.pagina.drawRectangle({
          x: cx,
          y: folha.y - alturaLinha,
          width: largura,
          height: alturaLinha,
          borderColor: CINZA_CLARO,
          borderWidth: 0.7,
        });
        folha.pagina.drawText(truncar(valor, folha.fontes.normal, 8.5, largura - 8), {
          x: cx + 4,
          y: folha.y - alturaLinha + 5,
          size: 8.5,
          font: folha.fontes.normal,
          color: formulario.progresso.pendentes > 0 && i >= 3 ? VERMELHO : PRETO,
        });
        cx += largura;
      });
      folha.y -= alturaLinha;
    }
  }

  folha.linha(14);
  folha.texto(
    'Etapas sem resposta são impressas como “Não verificado”. O julgamento de conformidade é feito pelo inspetor da ABB, fora deste sistema.',
    { tamanho: 8.5, cor: CINZA },
  );
}

function numerarPaginas(doc: PDFDocument, fonte: PDFFont, rodape: string): void {
  const paginas = doc.getPages();
  paginas.forEach((pagina, i) => {
    pagina.drawLine({
      start: { x: MARGEM, y: MARGEM + 14 },
      end: { x: PAGINA.largura - MARGEM, y: MARGEM + 14 },
      thickness: 0.7,
      color: CINZA_CLARO,
    });
    pagina.drawText(truncar(rodape, fonte, 7.5, LARGURA_UTIL - 90), {
      x: MARGEM,
      y: MARGEM + 4,
      size: 7.5,
      font: fonte,
      color: CINZA,
    });
    const texto = `Página ${i + 1} de ${paginas.length}`;
    pagina.drawText(texto, {
      x: PAGINA.largura - MARGEM - fonte.widthOfTextAtSize(texto, 7.5),
      y: MARGEM + 4,
      size: 7.5,
      font: fonte,
      color: CINZA,
    });
  });
}

export interface OpcoesPdf {
  incluirFotos: boolean;
  /** Título do tipo de verificação impresso na capa. */
  tituloTipo: string;
}

/**
 * Monta um único PDF com todas as TAGs do projeto, separadas por seção,
 * no leiaute dos formulários ABB.
 */
export async function gerarPdf(dossie: Dossie, opcoes: OpcoesPdf): Promise<Blob> {
  const doc = await PDFDocument.create();
  const fontes: Fontes = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrito: await doc.embedFont(StandardFonts.HelveticaBold),
    italico: await doc.embedFont(StandardFonts.HelveticaOblique),
  };

  doc.setTitle(`${dossie.projeto.empresa} — ${dossie.projeto.nomeProjeto}`);
  doc.setProducer('Sistema de Verificação de Montagem de Painéis');
  doc.setCreationDate(dossie.geradoEm);

  const folha = new Folha(doc, fontes);
  folha.tituloCorrente = `${dossie.projeto.empresa} • ${dossie.projeto.nomeProjeto}`;
  desenharCapa(folha, dossie, opcoes.tituloTipo);

  for (const tag of dossie.tags) {
    for (const formulario of tag.formularios) {
      folha.novaPagina();
      folha.titulo(`TAG ${tag.tag.nome}`, 14);
      folha.texto(formulario.definicao.nome, { tamanho: 11, negrito: true });
      folha.linha(4);
      folha.tabelaDados([
        ['Linha de produto', formulario.definicao.linhaProduto],
        [
          'Revisão do formulário',
          `${formulario.formRevisao} — ${formulario.definicao.dataRevisao}`,
        ],
        ['Emitido por', formulario.definicao.emitidoPor || '—'],
        ...formulario.definicao.cabecalho.map(
          (campo) =>
            [
              campo.rotulo + (campo.unidade ? ` (${campo.unidade})` : ''),
              formulario.cabecalho[campo.id] ?? '',
            ] as [string, string],
        ),
        [
          'Situação',
          `${formulario.progresso.respondidas} de ${formulario.progresso.total} etapas respondidas (${formulario.progresso.percentual}%)`,
        ],
      ]);

      for (const secao of formulario.definicao.secoes) {
        const etapas = secao.etapas.filter((e) => etapaVisivel(e, formulario.respostas));
        if (!etapas.length) continue;
        folha.faixaSecao(`${secao.id} — ${secao.titulo}`);
        desenharCabecalhoTabela(folha);
        for (const etapa of etapas) desenharEtapa(folha, etapa, formulario);
        folha.linha(10);
      }

      if (opcoes.incluirFotos) {
        await desenharFotos(folha, formulario, tag.tag.nome);
      }
    }
  }

  numerarPaginas(
    doc,
    fontes.normal,
    `${dossie.projeto.empresa} • ${dossie.projeto.nomeProjeto} • gerado em ${dataBr(dossie.geradoEm)}`,
  );

  const bytes = await doc.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}
