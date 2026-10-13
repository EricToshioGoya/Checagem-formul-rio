import { URL_ARQUIVO } from '../config';
import { EnvioRepository } from '../db/repositorios';
import type { ArquivoGerado } from '../export/PdfExport';

/** PDF registrado no arquivo central, como devolvido pela API. */
export interface PdfArquivado {
  id: number;
  empresa: string;
  projeto: string;
  tipo: string;
  nomeArquivo: string;
  emitidoEm: string;
  recebidoEm: string;
  tamanho: number;
  sha256: string;
}

export interface FiltroArquivo {
  /** Trecho do nome da empresa ou do projeto. */
  nome?: string;
  /** Datas `AAAA-MM-DD` no fuso do aparelho, inclusivas. */
  de?: string;
  ate?: string;
}

export class SenhaIncorretaError extends Error {
  constructor() {
    super('Senha incorreta.');
  }
}

export function arquivoConfigurado(): boolean {
  return URL_ARQUIVO !== '';
}

async function mensagemDeErro(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { erro?: string };
    if (corpo.erro) return corpo.erro;
  } catch {
    // Corpo não é JSON: cai na mensagem genérica.
  }
  return `O servidor respondeu ${resposta.status}.`;
}

let envioEmAndamento: Promise<number> | null = null;

/**
 * Envia a fila local ao servidor, do mais antigo ao mais novo. Para no
 * primeiro erro de rede (sem conexão, nada adiante vai passar) e devolve
 * quantos PDFs continuam pendentes. Chamadas simultâneas compartilham o
 * mesmo envio.
 */
export function enviarPendentes(): Promise<number> {
  if (!arquivoConfigurado()) return Promise.resolve(0);
  envioEmAndamento ??= (async () => {
    try {
      for (const envio of await EnvioRepository.listar()) {
        const formulario = new FormData();
        formulario.set('idEnvio', envio.idEnvio);
        formulario.set('empresa', envio.empresa);
        formulario.set('projeto', envio.projeto);
        formulario.set('tipo', envio.tipo);
        formulario.set('nomeArquivo', envio.nomeArquivo);
        formulario.set('emitidoEm', envio.emitidoEm);
        formulario.set('arquivo', envio.blob, envio.nomeArquivo);

        let resposta: Response;
        try {
          resposta = await fetch(`${URL_ARQUIVO}/api/pdfs`, {
            method: 'POST',
            body: formulario,
          });
        } catch {
          await EnvioRepository.registrarErro(envio.id!, 'Sem conexão com o servidor.');
          break;
        }
        if (resposta.ok) await EnvioRepository.remover(envio.id!);
        else await EnvioRepository.registrarErro(envio.id!, await mensagemDeErro(resposta));
      }
      return await EnvioRepository.contar();
    } finally {
      envioEmAndamento = null;
    }
  })();
  return envioEmAndamento;
}

/**
 * Coloca os PDFs gerados na fila e tenta enviá-los na hora. Devolve quantos
 * ficaram pendentes (0 quando todos chegaram ao servidor).
 */
export async function registrarNoArquivo(arquivos: ArquivoGerado[]): Promise<number> {
  if (!arquivoConfigurado()) return 0;
  for (const arquivo of arquivos) {
    if (!arquivo.registro) continue;
    await EnvioRepository.adicionar({
      idEnvio: crypto.randomUUID(),
      empresa: arquivo.registro.empresa,
      projeto: arquivo.registro.projeto,
      tipo: arquivo.registro.tipo,
      nomeArquivo: arquivo.nome,
      emitidoEm: arquivo.registro.emitidoEm.toISOString(),
      blob: arquivo.blob,
      criadoEm: Date.now(),
    });
  }
  return enviarPendentes();
}

/** Reenvia a fila ao abrir o aplicativo e sempre que a conexão voltar. */
export function iniciarEnvioAutomatico(): void {
  if (!arquivoConfigurado()) return;
  void enviarPendentes();
  window.addEventListener('online', () => void enviarPendentes());
}

function cabecalhoSenha(senha: string): HeadersInit {
  return { Authorization: `Bearer ${senha}` };
}

function inicioDoDia(data: string): string {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(a, m - 1, d, 0, 0, 0, 0).toISOString();
}

function fimDoDia(data: string): string {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(a, m - 1, d, 23, 59, 59, 999).toISOString();
}

export async function buscarPdfs(senha: string, filtro: FiltroArquivo): Promise<PdfArquivado[]> {
  const parametros = new URLSearchParams();
  if (filtro.nome?.trim()) parametros.set('nome', filtro.nome.trim());
  if (filtro.de) parametros.set('de', inicioDoDia(filtro.de));
  if (filtro.ate) parametros.set('ate', fimDoDia(filtro.ate));

  const resposta = await fetch(`${URL_ARQUIVO}/api/pdfs?${parametros}`, {
    headers: cabecalhoSenha(senha),
  });
  if (resposta.status === 401) throw new SenhaIncorretaError();
  if (!resposta.ok) throw new Error(await mensagemDeErro(resposta));
  return ((await resposta.json()) as { itens: PdfArquivado[] }).itens;
}

export async function baixarPdfArquivado(senha: string, pdf: PdfArquivado): Promise<Blob> {
  const resposta = await fetch(`${URL_ARQUIVO}/api/pdfs/${pdf.id}/arquivo`, {
    headers: cabecalhoSenha(senha),
  });
  if (resposta.status === 401) throw new SenhaIncorretaError();
  if (!resposta.ok) throw new Error(await mensagemDeErro(resposta));
  return resposta.blob();
}
