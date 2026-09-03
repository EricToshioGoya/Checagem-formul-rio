import { useEffect, useState } from 'react';
import { SENHA_ADMIN } from '../../core/config';
import { formulariosAtivos } from '../../core/forms/catalogo';
import type { EntradaCatalogo } from '../../core/forms/tipos';
import { EditorFormulario } from './EditorFormulario';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Erro, Carregando } from '../../shared/componentes/Estado';

const CHAVE_SESSAO = 'admin-liberado';

export function Admin() {
  const [liberado, setLiberado] = useState(
    () => sessionStorage.getItem(CHAVE_SESSAO) === '1',
  );
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [entradas, setEntradas] = useState<EntradaCatalogo[] | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  useEffect(() => {
    if (!liberado) return;
    formulariosAtivos()
      .then(setEntradas)
      .catch((e: unknown) =>
        setErro(e instanceof Error ? e.message : 'Falha ao ler o catálogo.'),
      );
  }, [liberado]);

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
