import { ADMIN_PADRAO } from '../config';
import { formulariosAtivos } from '../forms/catalogo';
import type { EntradaCatalogo } from '../forms/tipos';

/** Papel do usuário dentro de um painel. `null` = sem acesso. */
export type Papel = 'administrador' | 'liberado' | null;

export interface AcessoAoPainel {
  entrada: EntradaCatalogo;
  papel: Exclude<Papel, null>;
}

/** Comparação de e-mail ignora caixa e espaços em volta. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizarEmail(email));
}

/** Administradores do painel; sem lista no catálogo, vale o padrão do build. */
export function administradoresDoPainel(entrada: EntradaCatalogo): string[] {
  const declarados = entrada.administradores?.map(normalizarEmail).filter(Boolean) ?? [];
  return declarados.length ? declarados : [normalizarEmail(ADMIN_PADRAO)];
}

export function liberadosDoPainel(entrada: EntradaCatalogo): string[] {
  return entrada.liberados?.map(normalizarEmail).filter(Boolean) ?? [];
}

export function papelNoPainel(email: string, entrada: EntradaCatalogo): Papel {
  const alvo = normalizarEmail(email);
  if (administradoresDoPainel(entrada).includes(alvo)) return 'administrador';
  if (liberadosDoPainel(entrada).includes(alvo)) return 'liberado';
  return null;
}

/** Painéis ativos aos quais o e-mail tem acesso, com o papel em cada um. */
export async function acessosDoEmail(email: string): Promise<AcessoAoPainel[]> {
  const entradas = await formulariosAtivos();
  const acessos: AcessoAoPainel[] = [];
  for (const entrada of entradas) {
    const papel = papelNoPainel(email, entrada);
    if (papel) acessos.push({ entrada, papel });
  }
  return acessos;
}

export function ehAdministrador(acessos: AcessoAoPainel[]): boolean {
  return acessos.some((a) => a.papel === 'administrador');
}

export function temAcessoAoPainel(acessos: AcessoAoPainel[], formId: string): boolean {
  return acessos.some((a) => a.entrada.id === formId);
}

export function administraPainel(acessos: AcessoAoPainel[], formId: string): boolean {
  return acessos.some((a) => a.entrada.id === formId && a.papel === 'administrador');
}
