import { api, type AcessoPainel, type PainelApi } from './cliente';

/**
 * Última situação conhecida do acesso a cada painel, guardada no aparelho.
 *
 * O preenchimento roda offline, então abrir um projeto não pode depender de
 * rede para saber se o painel continua liberado. Sem conexão, o que dá para
 * garantir é: um acesso retirado ou vencido visto na última conexão continua
 * bloqueado, e um acesso com prazo vence na hora certa — o prazo já está aqui.
 *
 * Com conexão, quem decide é o servidor, sem conferir o relógio do aparelho:
 * um relógio adiantado não pode tirar o acesso de quem ainda o tem.
 */

const CHAVE = 'acessos-paineis';

/** Tempo máximo de espera pela rede antes de decidir pela cópia local. */
const ESPERA_REDE_MS = 4000;

interface Registro {
  meuAcesso: AcessoPainel;
  podePreencher: boolean;
  expiraEm: number | null;
}

export interface Bloqueio {
  motivo: 'expirada' | 'revogada' | 'sem-acesso';
  /** Quando o acesso venceu, se o motivo for o prazo. */
  expiraEm: number | null;
}

const chaveDe = (usuarioId: number, painelId: number) => `${usuarioId}:${painelId}`;

function ler(): Record<string, Registro> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Record<string, Registro>;
  } catch {
    return {};
  }
}

/** Grava a situação recebida do servidor. Chamado a cada leitura de `/api/paineis`. */
export function guardarAcessos(usuarioId: number, paineis: readonly PainelApi[]): void {
  try {
    const mapa = ler();
    for (const p of paineis) {
      mapa[chaveDe(usuarioId, p.id)] = {
        meuAcesso: p.meuAcesso,
        podePreencher: p.podePreencher,
        expiraEm: p.acessoExpiraEm,
      };
    }
    localStorage.setItem(CHAVE, JSON.stringify(mapa));
  } catch {
    // Armazenamento bloqueado: sem rede, o aparelho não terá o que conferir.
  }
}

function bloqueioDe(r: Registro, conferirRelogio: boolean): Bloqueio | null {
  const vencido = conferirRelogio && r.expiraEm !== null && r.expiraEm <= Date.now();
  if (r.podePreencher && !vencido) return null;
  if (r.meuAcesso === 'revogada') return { motivo: 'revogada', expiraEm: null };
  if (r.meuAcesso === 'expirada' || vencido) return { motivo: 'expirada', expiraEm: r.expiraEm };
  return { motivo: 'sem-acesso', expiraEm: null };
}

/**
 * Diz se o usuário ainda pode abrir o painel; `null` é liberado.
 *
 * Tenta o servidor primeiro. Sem resposta a tempo, decide pela cópia local —
 * e um painel nunca visto nela passa: o projeto só existe no aparelho porque
 * foi aberto, um dia, com acesso aprovado.
 */
export async function conferirAcessoPainel(
  usuarioId: number,
  painelId: number,
): Promise<Bloqueio | null> {
  try {
    const { paineis } = await Promise.race([
      api.get<{ paineis: PainelApi[] }>('/api/paineis'),
      new Promise<never>((_, rejeitar) =>
        setTimeout(() => rejeitar(new Error('tempo esgotado')), ESPERA_REDE_MS),
      ),
    ]);
    guardarAcessos(usuarioId, paineis);
    const painel = paineis.find((p) => p.id === painelId);
    // Painel excluído pela administração: não há mais o que preencher nele.
    if (!painel) return { motivo: 'sem-acesso', expiraEm: null };
    return bloqueioDe(
      { meuAcesso: painel.meuAcesso, podePreencher: painel.podePreencher, expiraEm: painel.acessoExpiraEm },
      false,
    );
  } catch {
    const registro = ler()[chaveDe(usuarioId, painelId)];
    return registro ? bloqueioDe(registro, true) : null;
  }
}
