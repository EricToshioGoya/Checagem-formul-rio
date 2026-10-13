import { useCallback, useEffect, useMemo, useState } from 'react';
import { HASH_SENHA_ADMIN, MINUTOS_SESSAO_ADMIN } from '../../core/config';
import { conferirSenha, interpretarHash } from '../../core/seguranca/senha';
import { formulariosAtivos } from '../../core/forms/catalogo';
import type { EntradaCatalogo } from '../../core/forms/tipos';
import { EditorFormulario } from './EditorFormulario';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Erro, Carregando } from '../../shared/componentes/Estado';

/** Guarda o instante (ms) até o qual a aba fica liberada. */
const CHAVE_SESSAO = 'admin-liberado-ate';
/** Teto da espera progressiva entre tentativas erradas. */
const ESPERA_MAXIMA_MS = 30_000;

function sessaoValida(): boolean {
  const ate = Number(sessionStorage.getItem(CHAVE_SESSAO));
  return Number.isFinite(ate) && ate > Date.now();
}

export function Admin() {
  const hashSenha = useMemo(() => interpretarHash(HASH_SENHA_ADMIN), []);
  const [liberado, setLiberado] = useState(sessaoValida);
  const [senha, setSenha] = useState('');
  const [conferindo, setConferindo] = useState(false);
  const [falhas, setFalhas] = useState(0);
  const [esperarAte, setEsperarAte] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [entradas, setEntradas] = useState<EntradaCatalogo[] | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const bloquear = useCallback(() => {
    sessionStorage.removeItem(CHAVE_SESSAO);
    setLiberado(false);
    setSelecionado(null);
  }, []);

  useEffect(() => {
    if (!liberado) return;
    formulariosAtivos()
      .then(setEntradas)
      .catch((e: unknown) =>
        setErro(e instanceof Error ? e.message : 'Falha ao ler o catálogo.'),
      );
  }, [liberado]);

  // A liberação expira: depois de MINUTOS_SESSAO_ADMIN a aba volta a pedir a senha.
  useEffect(() => {
    if (!liberado) return;
    const t = setInterval(() => {
      if (!sessaoValida()) bloquear();
    }, 15_000);
    return () => clearInterval(t);
  }, [liberado, bloquear]);

  const entrar = async () => {
    if (!hashSenha || conferindo) return;
    const restante = esperarAte - Date.now();
    if (restante > 0) {
      setErro(`Aguarde ${Math.ceil(restante / 1000)} s antes de tentar de novo.`);
      return;
    }
    setConferindo(true);
    try {
      if (await conferirSenha(senha, hashSenha)) {
        sessionStorage.setItem(
          CHAVE_SESSAO,
          String(Date.now() + MINUTOS_SESSAO_ADMIN * 60_000),
        );
        setSenha('');
        setFalhas(0);
        setErro(null);
        setLiberado(true);
      } else {
        const total = falhas + 1;
        setFalhas(total);
        setEsperarAte(Date.now() + Math.min(1000 * 2 ** total, ESPERA_MAXIMA_MS));
        setErro('Senha incorreta.');
      }
    } finally {
      setConferindo(false);
    }
  };

  if (!liberado) {
    if (!hashSenha) {
      return (
        <div className="mx-auto max-w-md space-y-4">
          <h1 className="text-2xl font-bold">Administração</h1>
          <Erro
            titulo="Administração indisponível"
            detalhe="A senha da administração não foi configurada nesta versão (VITE_SENHA_ADMIN_HASH). Consulte o README."
          />
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Administração</h1>
        <p className="text-base text-abb-gray">
          Área de edição do conteúdo dos formulários. Informe a senha para continuar.
        </p>
        <CampoTexto rotulo="Senha" senha valor={senha} onChange={setSenha} autoFoco />
        {erro ? <Erro detalhe={erro} /> : null}
        <Botao
          variante="primario"
          larguraTotal
          disabled={conferindo}
          onClick={() => void entrar()}
        >
          {conferindo ? 'Conferindo…' : 'Entrar'}
        </Botao>
      </div>
    );
  }

  if (erro) return <Erro detalhe={erro} />;
  if (!entradas) return <Carregando mensagem="Lendo o catálogo de formulários…" />;

  if (selecionado) {
    return (
      <EditorFormulario formId={selecionado} onVoltar={() => setSelecionado(null)} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Administração</h1>
        <Botao onClick={bloquear}>Bloquear</Botao>
      </div>
      <p className="text-base text-abb-gray">
        Escolha um formulário para editar textos, ativar ou desativar etapas,
        reordenar e trocar o conteúdo de apoio.
      </p>
      <ul className="space-y-3">
        {entradas.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => setSelecionado(e.id)}
              className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg border border-abb-line bg-white p-4 text-left hover:border-abb-red"
            >
              <span>
                <span className="block text-lg font-bold">{e.nome}</span>
                <span className="block text-sm text-abb-gray">
                  {e.linhaProduto} • {e.id}
                </span>
              </span>
              <span className="text-base font-semibold text-abb-red">Editar</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
