import { ADMIN_PADRAO, RESPONSAVEL_MONTAGEM_PADRAO } from '../config';
import type { Painel } from '../paineis/tipos';

/** Comparação de e-mail ignora caixa e espaços em volta. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizarEmail(email));
}

/** Administradores do painel; sem lista no catálogo, vale o padrão do build. */
export function administradoresDoPainel(painel: Painel): string[] {
  const declarados = painel.administradores?.map(normalizarEmail).filter(Boolean) ?? [];
  return declarados.length ? declarados : [normalizarEmail(ADMIN_PADRAO)];
}

export function ehAdministrador(email: string | null, painel: Painel | null): boolean {
  if (!email || !painel) return false;
  return administradoresDoPainel(painel).includes(normalizarEmail(email));
}

/**
 * Quem aprova o acesso de montagem ao painel. Sem valor no catálogo, vale o
 * padrão do build.
 */
export function responsavelDoPainel(painel: Painel): string {
  return normalizarEmail(painel.responsavelMontagem || RESPONSAVEL_MONTAGEM_PADRAO);
}
