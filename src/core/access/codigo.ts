import { SEGREDO_APROVACAO } from '../config';
import { normalizarEmail } from '../auth/acesso';

/**
 * Código de aprovação de acesso, com prazo embutido.
 *
 * A aplicação não tem servidor: o aparelho do montador não consegue saber,
 * por conta própria, que o responsável aprovou — nem que ele mudou de ideia.
 * O código resolve as duas coisas sem rede. Ele é derivado de
 * `e-mail + painel + dia de vencimento + segredo do build`, de modo que o
 * aparelho do responsável (que roda a mesma aplicação, com o mesmo segredo)
 * calcula exatamente o mesmo valor, e o do montador confere o que foi
 * digitado e aprende até quando aquilo vale.
 *
 * É isso que torna a permissão revogável sem servidor: ela vence sozinha, e
 * quem para de repassar código novo tira o acesso da pessoa no vencimento.
 *
 * Só o responsável vê o código: o e-mail enviado pelo montador leva apenas o
 * link de aprovação, nunca o código.
 */

// Sem 0/O/1/I: o código é lido em voz alta e digitado com luva.
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** 32³ = 32768 dias de alcance, quase noventa anos a partir da época. */
const DIGITOS_PRAZO = 3;
const DIGITOS_ASSINATURA = 6;
const TAMANHO = DIGITOS_PRAZO + DIGITOS_ASSINATURA;

const DIA = 86_400_000;
/** Início da contagem de dias embutida no código. */
const EPOCA = Date.UTC(2026, 0, 1);

/** Prazos oferecidos ao responsável, em dias. */
export const PRAZOS_APROVACAO = [30, 60, 90, 180] as const;
export const PRAZO_PADRAO = 30;

export type Verificacao =
  | { valido: true; validoAte: number }
  | { valido: false; motivo: 'formato' | 'nao_confere' | 'expirado'; validoAte?: number };

/** Aceita espaços, hífens e minúsculas na digitação do montador. */
export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Grupos de três, para ler em voz alta ao telefone. */
export function formatarCodigo(codigo: string): string {
  return (codigo.match(/.{1,3}/g) ?? []).join('-');
}

function paraBase32(valor: number, digitos: number): string {
  let restante = valor;
  let saida = '';
  for (let i = 0; i < digitos; i += 1) {
    saida = ALFABETO[restante % ALFABETO.length] + saida;
    restante = Math.floor(restante / ALFABETO.length);
  }
  return saida;
}

function deBase32(texto: string): number | null {
  let valor = 0;
  for (const caractere of texto) {
    const posicao = ALFABETO.indexOf(caractere);
    if (posicao < 0) return null;
    valor = valor * ALFABETO.length + posicao;
  }
  return valor;
}

const diaDeHoje = () => Math.floor((Date.now() - EPOCA) / DIA);
/** O código vale até o fim do dia que ele carrega. */
const fimDoDia = (dia: number) => EPOCA + (dia + 1) * DIA - 1;

async function assinar(email: string, painelId: string, dia: number): Promise<string> {
  const material = `${normalizarEmail(email)}|${painelId}|${dia}|${SEGREDO_APROVACAO}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const bytes = new Uint8Array(digest);
  let saida = '';
  for (let i = 0; i < DIGITOS_ASSINATURA; i += 1) {
    saida += ALFABETO[bytes[i] % ALFABETO.length];
  }
  return saida;
}

export async function gerarCodigo(
  email: string,
  painelId: string,
  prazoDias: number = PRAZO_PADRAO,
): Promise<string> {
  const dia = diaDeHoje() + Math.max(1, Math.trunc(prazoDias));
  return paraBase32(dia, DIGITOS_PRAZO) + (await assinar(email, painelId, dia));
}

/** Até quando vale o código, sem conferir a assinatura. */
export function validadeDoCodigo(codigo: string): number | null {
  const limpo = normalizarCodigo(codigo);
  if (limpo.length !== TAMANHO) return null;
  const dia = deBase32(limpo.slice(0, DIGITOS_PRAZO));
  return dia === null ? null : fimDoDia(dia);
}

export async function verificarCodigo(
  email: string,
  painelId: string,
  digitado: string,
): Promise<Verificacao> {
  const limpo = normalizarCodigo(digitado);
  if (limpo.length !== TAMANHO) return { valido: false, motivo: 'formato' };

  const dia = deBase32(limpo.slice(0, DIGITOS_PRAZO));
  if (dia === null) return { valido: false, motivo: 'formato' };

  if ((await assinar(email, painelId, dia)) !== limpo.slice(DIGITOS_PRAZO)) {
    return { valido: false, motivo: 'nao_confere' };
  }

  const validoAte = fimDoDia(dia);
  if (Date.now() > validoAte) return { valido: false, motivo: 'expirado', validoAte };
  return { valido: true, validoAte };
}
