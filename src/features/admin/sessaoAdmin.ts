import { ErroApi } from '../../core/api/cliente';

/**
 * A sessão de administrador acabou: venceu (401) ou a conta perdeu o papel
 * (403 `nao-admin`). Nos dois casos a tela volta para o login de administrador.
 */
export function sessaoAdminAcabou(erro: unknown): boolean {
  return erro instanceof ErroApi && (erro.status === 401 || erro.codigo === 'nao-admin');
}
