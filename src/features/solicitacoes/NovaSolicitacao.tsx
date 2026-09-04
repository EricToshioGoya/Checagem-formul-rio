import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { solicitacaoStore } from '../../core/certificacao';
import { camposDoPainel, obterPainel } from '../../core/paineis/catalogo';
import { camposObrigatoriosVazios, rotulosDe } from '../../core/forms/validacaoCampos';
import type { CampoCabecalho, ValoresCabecalho } from '../../core/forms/tipos';
import type { Painel } from '../../core/paineis/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { GradeCampos } from '../../shared/componentes/GradeCampos';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeVoltar } from '../../shared/componentes/Icones';

/**
 * Dados da empresa e do projeto. Os campos vêm do catálogo de painéis, não do
 * código: o avanço fica bloqueado enquanto houver obrigatório vazio.
 */
export function NovaSolicitacao() {
  const { tipoPainel = '' } = useParams();
  const navegar = useNavigate();

  const [painel, setPainel] = useState<Painel | null>(null);
  const [campos, setCampos] = useState<CampoCabecalho[]>([]);
  const [valores, setValores] = useState<ValoresCabecalho>({});
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    Promise.all([obterPainel(tipoPainel), camposDoPainel(tipoPainel)])
      .then(([p, c]) => {
        setPainel(p);
        setCampos(c);
      })
      .catch((e: unknown) =>
        setErro(e instanceof Error ? e.message : 'Falha ao ler o catálogo de painéis.'),
      );
  }, [tipoPainel]);

  const pendentes = useMemo(
    () => camposObrigatoriosVazios(campos, valores),
    [campos, valores],
  );

  if (erro && !painel) return <Erro detalhe={erro} />;
  if (!painel) return <Carregando mensagem="Carregando os campos da solicitação…" />;

  const salvar = async () => {
    setTentouSalvar(true);
    if (pendentes.length) return;
    setSalvando(true);
    setErro(null);
    try {
      const id = await solicitacaoStore.criar({
        tipoPainel,
        formId: painel.formularios[0],
        dados: valores,
      });
      navegar(`/solicitacoes/${id}`, { replace: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gravar a solicitação.');
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <Botao
          variante="texto"
          onClick={() => navegar(`/paineis/${tipoPainel}/solicitacoes`)}
          aria-label="Voltar"
        >
          <IconeVoltar />
        </Botao>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
            {painel.nome}
          </p>
          <h1 className="text-2xl font-bold">Nova solicitação</h1>
        </div>
      </div>

      <Aviso>
        Uma solicitação por painel/quadro. Todos os campos marcados com{' '}
        <span className="font-bold text-abb-red">*</span> são obrigatórios.
      </Aviso>

      <div className="space-y-4 rounded-lg border border-abb-line bg-white p-4">
        <h2 className="text-lg font-bold">Dados da empresa e do projeto</h2>
        <GradeCampos
          campos={campos}
          valores={valores}
          onChange={(id, valor) => setValores((atual) => ({ ...atual, [id]: valor }))}
          pendentes={tentouSalvar ? pendentes : []}
          prefixoId="sol"
        />
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      {tentouSalvar && pendentes.length ? (
        <Erro
          titulo="Preencha os campos obrigatórios"
          detalhe={rotulosDe(campos, pendentes)
            .map((r) => `• ${r}`)
            .join('\n')}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Botao
          variante="primario"
          onClick={salvar}
          disabled={salvando || pendentes.length > 0}
        >
          {salvando ? 'Gravando…' : 'Criar solicitação'}
        </Botao>
        <Botao onClick={() => navegar(`/paineis/${tipoPainel}/solicitacoes`)}>Cancelar</Botao>
      </div>
    </div>
  );
}
