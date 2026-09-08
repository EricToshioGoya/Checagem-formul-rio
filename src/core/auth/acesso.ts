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

export function administraPainel(acessos: AcessoAoPainel[], formId: string): boolean {
  return acessos.some((a) => a.entrada.id === formId && a.papel === 'administrador');
}

/** O formulário está liberado para o e-mail em sessão? */
export function temAcessoAoFormulario(
  acessos: AcessoAoPainel[],
  formId: string,
): boolean {
  return acessos.some((a) => a.entrada.id === formId);
}

/** Painel oferecido na escolha: uma linha de produto e os formulários dela. */
export interface PainelAcessivel {
  linhaProduto: string;
  entradas: EntradaCatalogo[];
  administrador: boolean;
}

/**
 * Agrupa os acessos por linha de produto — é assim que o montador enxerga o
 * painel na tela de escolha, e não formulário por formulário.
 */
export function paineisAcessiveis(acessos: AcessoAoPainel[]): PainelAcessivel[] {
  const porLinha = new Map<string, PainelAcessivel>();
  for (const { entrada, papel } of acessos) {
    const atual = porLinha.get(entrada.linhaProduto);
    if (atual) {
      atual.entradas.push(entrada);
      atual.administrador ||= papel === 'administrador';
    } else {
      porLinha.set(entrada.linhaProduto, {
        linhaProduto: entrada.linhaProduto,
        entradas: [entrada],
        administrador: papel === 'administrador',
      });
    }
  }
  return [...porLinha.values()].sort((a, b) =>
    a.linhaProduto.localeCompare(b.linhaProduto, 'pt-BR'),
  );
}
