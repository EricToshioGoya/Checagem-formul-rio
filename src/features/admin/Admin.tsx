import { useEffect, useState } from 'react';
import { SENHA_ADMIN } from '../../core/config';
import { formulariosAtivos } from '../../core/forms/catalogo';
import { usePainelAtivo } from '../paineis/PainelAtivo';
import type { EntradaCatalogo } from '../../core/forms/tipos';
import { EditorFormulario } from './EditorFormulario';
import { ValidacaoAbb } from './ValidacaoAbb';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Erro, Carregando, Vazio } from '../../shared/componentes/Estado';

const CHAVE_SESSAO = 'admin-liberado';

export function Admin() {
  const { painel } = usePainelAtivo();
  const [liberado, setLiberado] = useState(
    () => sessionStorage.getItem(CHAVE_SESSAO) === '1',
  );
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [entradas, setEntradas] = useState<EntradaCatalogo[] | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [aba, setAba] = useState<'validacao' | 'formularios'>('validacao');

  useEffect(() => {
    if (!liberado) return;
    // Só os formulários do painel em uso: a senha libera a área, o painel
    // escolhido decide o que ela mostra.
    formulariosAtivos()
      .then((todas) =>
        setEntradas(painel ? todas.filter((e) => painel.formularios.includes(e.id)) : []),
      )
      .catch((e: unknown) =>
        setErro(e instanceof Error ? e.message : 'Falha ao ler o catálogo.'),
      );
  }, [liberado, painel]);

  if (!liberado) {
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
          onClick={() => {
            if (senha === SENHA_ADMIN) {
              sessionStorage.setItem(CHAVE_SESSAO, '1');
              setLiberado(true);
              setErro(null);
            } else {
              setErro('Senha incorreta.');
            }
          }}
        >
          Entrar
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
        <Botao
          onClick={() => {
            sessionStorage.removeItem(CHAVE_SESSAO);
            setLiberado(false);
          }}
        >
          Bloquear
        </Botao>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {(
          [
            ['validacao', 'Validação ABB'],
            ['formularios', 'Formulários'],
          ] as const
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            role="tab"
            aria-selected={aba === chave}
            onClick={() => setAba(chave)}
            className={[
              'min-h-12 rounded-md border px-4 text-base font-semibold',
              aba === chave
                ? 'border-abb-red bg-abb-red text-white'
                : 'border-abb-line bg-white text-abb-black',
            ].join(' ')}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === 'validacao' ? <ValidacaoAbb /> : null}

      {aba === 'formularios' ? (
        <>
      <p className="text-base text-abb-gray">
        Formulários do painel{' '}
        <span className="font-semibold text-abb-black">{painel?.nome}</span>. Escolha um
        para editar textos, ativar ou desativar etapas, reordenar e trocar o conteúdo de
        apoio.
      </p>
      {entradas.length === 0 ? (
        <Vazio titulo="Nenhum formulário para editar">
          Escolha um painel na tela inicial para ver os formulários dele.
        </Vazio>
      ) : null}
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
        </>
      ) : null}
    </div>
  );
}
