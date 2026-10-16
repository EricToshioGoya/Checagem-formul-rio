import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type ResumoAdmin } from '../../core/api/cliente';
import { useSessao } from '../../core/api/SessaoContexto';
import { Andamento } from '../paineis/Andamento';
import { Aprovacoes } from './aprovacoes/Aprovacoes';
import { Documentos } from './Documentos';
import { GestaoAcessos } from './GestaoAcessos';
import { GestaoAdministradores } from './GestaoAdministradores';
import { GestaoContas } from './GestaoContas';
import { GestaoPaineis } from './GestaoPaineis';
import { Historico } from './Historico';
import { Sistema } from './Sistema';
import { plural } from '../../../compartilhado/plural';
import { sessaoAdminAcabou } from './sessaoAdmin';

type Aba =
  | 'acessos'
  | 'andamento'
  | 'aprovacoes'
  | 'documentos'
  | 'paineis'
  | 'contas'
  | 'administradores'
  | 'historico'
  | 'sistema';

const ABAS: Array<{ id: Aba; rotulo: string; curto: string }> = [
  { id: 'acessos', rotulo: 'Acessos', curto: 'Acessos' },
  { id: 'andamento', rotulo: 'Andamento', curto: 'Andamento' },
  { id: 'aprovacoes', rotulo: 'Aprovações', curto: 'Aprovações' },
  { id: 'documentos', rotulo: 'Documentos', curto: 'Documentos' },
  { id: 'paineis', rotulo: 'Painéis e checklists', curto: 'Painéis' },
  { id: 'contas', rotulo: 'Contas', curto: 'Contas' },
  { id: 'administradores', rotulo: 'Administradores', curto: 'Admins' },
  { id: 'historico', rotulo: 'Histórico', curto: 'Histórico' },
  { id: 'sistema', rotulo: 'Sistema', curto: 'Sistema' },
];

const ANTIGAS: Record<string, Aba> = { validacao: 'aprovacoes', pdfs: 'documentos' };

/** Selos de pendência de cada aba; relidos de tempos em tempos. */
const RELEITURA_MS = 30_000;

/**
 * Área de administração.
 *
 * Não há senha própria: chega aqui quem entrou como administrador, com a
 * própria conta — o portão é `ExigirAdmin`, e quem decide de fato é o
 * servidor, que confere o papel da conta em toda rota de administração.
 */
export function Admin() {
  const { sair } = useSessao();
  const navegar = useNavigate();
  // A aba fica na URL: recarregar a página volta para onde se estava.
  const [parametros, setParametros] = useSearchParams();
  // Endereços antigos (avisos já enviados, favoritos) continuam abrindo.
  const pedida = ANTIGAS[parametros.get('aba') ?? ''] ?? parametros.get('aba');
  const aba: Aba = ABAS.some((a) => a.id === pedida) ? (pedida as Aba) : 'acessos';
  const [resumo, setResumo] = useState<ResumoAdmin | null>(null);

  const sessaoVencida = useCallback(async () => {
    await sair();
    navegar('/entrar?perfil=admin', { replace: true });
  }, [navegar, sair]);

  const lerResumo = useCallback(async () => {
    try {
      setResumo(await api.get<ResumoAdmin>('/api/admin/resumo'));
    } catch (e) {
      if (sessaoAdminAcabou(e)) void sessaoVencida();
    }
  }, [sessaoVencida]);

  useEffect(() => {
    void lerResumo();
    const releitura = window.setInterval(() => {
      if (document.visibilityState === 'visible') void lerResumo();
    }, RELEITURA_MS);
    return () => window.clearInterval(releitura);
  }, [lerResumo]);

  const selo: Partial<Record<Aba, number>> = {
    acessos: resumo?.acessosPendentes,
    administradores: resumo?.pedidosAdmin,
    aprovacoes: (resumo?.verificacoesPendentes ?? 0) + (resumo?.certificacoesPendentes ?? 0),
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Administração</h1>

      <div
        role="tablist"
        aria-label="Seções da administração"
        className="flex w-full max-w-full overflow-x-auto rounded-xl border border-abb-line bg-white p-1 shadow-sm"
      >
        {ABAS.map((a) => {
          const ativa = aba === a.id;
          const n = selo[a.id] ?? 0;
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              id={`aba-${a.id}`}
              aria-selected={ativa}
              aria-controls={`painel-${a.id}`}
              onClick={() =>
                setParametros(a.id === 'acessos' ? {} : { aba: a.id }, { replace: true })
              }
              className={[
                'inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition',
                ativa
                  ? 'bg-abb-black text-white shadow-sm'
                  : 'text-abb-gray hover:bg-neutral-100 hover:text-abb-black',
              ].join(' ')}
            >
              <span className="sm:hidden">{a.curto}</span>
              <span className="hidden sm:inline">{a.rotulo}</span>
              {n > 0 ? (
                <span
                  aria-label={plural(n, 'pendente', 'pendentes')}
                  className={[
                    'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold',
                    ativa ? 'bg-white text-abb-black' : 'bg-sky-500 text-white',
                  ].join(' ')}
                >
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`}>
        {aba === 'acessos' ? (
          <GestaoAcessos onSessaoVencida={sessaoVencida} onAlterado={lerResumo} />
        ) : aba === 'andamento' ? (
          <div className="space-y-3">
            <div>
              <h2 className="text-xl font-bold">Andamento</h2>
              <p className="text-sm text-abb-gray">
                Quanto cada montador já preencheu, do que o aparelho dele sincronizou.
              </p>
            </div>
            <Andamento onSessaoVencida={sessaoVencida} />
          </div>
        ) : aba === 'aprovacoes' ? (
          <Aprovacoes
            onSessaoVencida={sessaoVencida}
            onAlterado={lerResumo}
            pendentes={{
              verificacoes: resumo?.verificacoesPendentes,
              certificacoes: resumo?.certificacoesPendentes,
            }}
          />
        ) : aba === 'documentos' ? (
          <Documentos
            onSessaoVencida={sessaoVencida}
            onAbrirAnalise={(secao, id) =>
              setParametros({ aba: 'aprovacoes', secao, abrir: String(id) })
            }
          />
        ) : aba === 'contas' ? (
          <GestaoContas onSessaoVencida={sessaoVencida} onAlterado={lerResumo} />
        ) : aba === 'administradores' ? (
          <GestaoAdministradores
            onSessaoVencida={sessaoVencida}
            onAlterado={lerResumo}
            onAbrirHistorico={() => setParametros({ aba: 'historico' }, { replace: true })}
          />
        ) : aba === 'historico' ? (
          <Historico onSessaoVencida={sessaoVencida} />
        ) : aba === 'sistema' ? (
          <Sistema onSessaoVencida={sessaoVencida} />
        ) : (
          <GestaoPaineis />
        )}
      </div>
    </div>
  );
}
