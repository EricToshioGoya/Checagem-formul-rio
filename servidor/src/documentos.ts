import { existsSync, statSync } from 'node:fs';
import { banco } from './banco';
import { repararDocumento } from './backup';
import { caminhoMidia, hashDe } from './midias';
import { ErroHttp } from './rotas';

/**
 * Regras comuns aos documentos guardados (PDFs, certificados e fotos citadas
 * num documento): o conteúdo só é aceito se conferir com o SHA-256 calculado
 * no aparelho, e a leitura restaura do backup o arquivo que tiver sumido.
 */

const SHA256 = /^[0-9a-f]{64}$/;

/** Sem acento e em minúsculas: "São João" e "sao joao" se encontram. */
export function paraBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Confere o SHA-256 que o aparelho calculou com o do conteúdo recebido e
 * devolve o hash real. Um arquivo truncado pela rede nunca é aceito. Sem o
 * hash informado (aplicativo anterior), aceita e só calcula.
 */
export function conferirHashRecebido(informado: string | null | undefined, dados: Buffer): string {
  const real = hashDe(dados);
  const esperado = informado?.trim().toLowerCase();
  if (esperado) {
    if (!SHA256.test(esperado)) throw new ErroHttp(400, 'SHA-256 informado inválido.');
    if (esperado !== real) {
      throw new ErroHttp(
        422,
        'O arquivo chegou diferente do original (transferência incompleta). Ele será reenviado.',
        'hash-divergente',
      );
    }
  }
  return real;
}

/**
 * Caminho de um documento guardado. Se o arquivo sumiu do disco principal ou
 * está com outro tamanho, é restaurado na hora a partir de uma cópia íntegra
 * do backup; sem cópia boa, o problema fica registrado para a tela Sistema.
 */
export function caminhoDocumento(uid: string, sha256: string, tamanho: number): string {
  const caminho = caminhoMidia(uid);
  if (existsSync(caminho) && statSync(caminho).size === tamanho) return caminho;
  const origem = repararDocumento(uid, sha256);
  if (origem) {
    console.warn(`Documento ${uid} restaurado de ${origem} ao ser lido.`);
    banco
      .prepare(
        `INSERT INTO integridade_arquivos (uid, situacao, verificadoEm, detalhe) VALUES (?, 'reparado', ?, ?)
         ON CONFLICT (uid) DO UPDATE SET situacao = excluded.situacao, verificadoEm = excluded.verificadoEm,
           detalhe = excluded.detalhe`,
      )
      .run(uid, Date.now(), `Restaurado de ${origem} ao ser lido.`);
    return caminho;
  }
  banco
    .prepare(
      `INSERT INTO integridade_arquivos (uid, situacao, verificadoEm, detalhe) VALUES (?, 'ausente', ?, ?)
       ON CONFLICT (uid) DO UPDATE SET situacao = excluded.situacao, verificadoEm = excluded.verificadoEm,
         detalhe = excluded.detalhe`,
    )
    .run(uid, Date.now(), 'Ausente no disco principal e sem cópia íntegra no backup.');
  console.error(`ALERTA: documento ${uid} ausente e sem cópia íntegra no backup.`);
  throw new ErroHttp(
    503,
    'O arquivo está indisponível no momento. O problema ficou registrado no painel Sistema da administração.',
  );
}
