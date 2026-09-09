/** Painel como o aplicativo o conhece: sem o e-mail do responsável. */
export interface PainelPublico {
  id: string;
  nome: string;
}

export type StatusSolicitacao = 'pendente' | 'aprovada' | 'negada';

export type Papel = 'montador' | 'responsavel';

/** Resposta do servidor ao pedir ou consultar um acesso. */
export interface ResultadoSolicitacao {
  id: string;
  status: StatusSolicitacao;
  /** Só vem preenchida quando o acesso está aprovado e vigente. */
  credencial?: string;
  emailResponsavel: string;
  revogada?: boolean;
}

/**
 * Conteúdo da credencial. O aplicativo lê estes campos offline, depois de
 * conferir a assinatura — nunca antes.
 */
export interface Claims {
  sub: string;
  email: string;
  painelId: string;
  painelNome: string;
  deviceId: string;
  papel: Papel;
  iat: number;
  exp: number;
}

/** Uma solicitação como aparece na tela de autorizações do responsável. */
export interface Solicitacao {
  id: string;
  email: string;
  painelId: string;
  deviceId: string;
  papel: Papel;
  status: StatusSolicitacao;
  criadoEm: string;
  decididoEm?: string;
  decididoPor?: string;
  revogadoEm?: string;
  revogadoPor?: string;
  descricao?: string;
}
