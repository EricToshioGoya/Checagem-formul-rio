import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProjetoRepository } from '../../core/db/repositorios';
import { Botao } from '../../shared/componentes/Botao';
import { CampoNumero, CampoTexto } from '../../shared/componentes/Campos';
import { Erro } from '../../shared/componentes/Estado';
import { IconeVoltar } from '../../shared/componentes/Icones';

const MAX_TAGS = 60;

export function NovoProjeto() {
  const navegar = useNavigate();
  const [empresa, setEmpresa] = useState('');
  const [nomeProjeto, setNomeProjeto] = useState('');
  const [operador, setOperador] = useState('');
  const [numeroPedido, setNumeroPedido] = useState('');
  const [quantidade, setQuantidade] = useState<number | null>(1);
  const [nomesTags, setNomesTags] = useState<string[]>(['']);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  /** A quantidade informada abre (ou fecha) os campos de nome de cada TAG. */
  const ajustarQuantidade = (valor: number | null) => {
    const n = valor === null ? 0 : Math.max(0, Math.min(MAX_TAGS, Math.floor(valor)));
    setQuantidade(valor === null ? null : n);
    setNomesTags((atual) => {
      const novo = [...atual];
      while (novo.length < n) novo.push('');
      return novo.slice(0, n);
    });
  };

  const salvar = async () => {
    if (!empresa.trim() || !nomeProjeto.trim()) {
      setErro('Informe a empresa e o nome do projeto.');
      return;
    }
    if (!operador.trim()) {
      setErro('Informe o nome do operador. Ele será impresso em todas as etapas.');
      return;
    }
    if (nomesTags.length === 0) {
      setErro('Informe pelo menos uma TAG.');
      return;
    }
    setSalvando(true);
    try {
      const id = await ProjetoRepository.criar({
        empresa,
        nomeProjeto,
        operador,
        numeroPedido,
        tags: nomesTags,
      });
      navegar(`/projetos/${id}`, { replace: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gravar o projeto.');
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Botao variante="texto" onClick={() => navegar('/')} aria-label="Voltar">
          <IconeVoltar />
        </Botao>
        <h1 className="text-2xl font-bold">Novo projeto</h1>
      </div>

      <div className="space-y-4 rounded-lg border border-abb-line bg-white p-4">
        <CampoTexto
          id="empresa"
          rotulo="Empresa"
          valor={empresa}
          onChange={setEmpresa}
          placeholder="Nome do parceiro de painel"
          obrigatorio
          autoFoco
        />
        <CampoTexto
          id="nomeProjeto"
          rotulo="Nome do projeto"
          valor={nomeProjeto}
          onChange={setNomeProjeto}
          placeholder="Ex.: Linha 3"
          obrigatorio
        />
        <CampoTexto
          id="operador"
          rotulo="Nome do operador"
          valor={operador}
          onChange={setOperador}
          ajuda="Informado uma vez e repetido na coluna “Operador” de todas as etapas."
          obrigatorio
        />
        <CampoTexto
          id="numeroPedido"
          rotulo="Número do pedido"
          valor={numeroPedido}
          onChange={setNumeroPedido}
          ajuda="Opcional."
        />
        <CampoNumero
          id="quantidade"
          rotulo="Quantidade de TAGs"
          valor={quantidade}
          onChange={ajustarQuantidade}
          obrigatorio
        />
      </div>

      {nomesTags.length > 0 ? (
        <div className="space-y-3 rounded-lg border border-abb-line bg-white p-4">
          <h2 className="text-lg font-bold">Nome de cada TAG</h2>
          {nomesTags.map((nome, i) => (
            <CampoTexto
              key={i}
              id={`tag-${i}`}
              rotulo={`TAG ${i + 1}`}
              valor={nome}
              placeholder={`TAG ${i + 1}`}
              onChange={(v) =>
                setNomesTags((atual) => atual.map((n, j) => (j === i ? v : n)))
              }
            />
          ))}
        </div>
      ) : null}

      {erro ? <Erro detalhe={erro} /> : null}

      <div className="flex flex-wrap gap-2">
        <Botao variante="primario" larguraTotal={false} onClick={salvar} disabled={salvando}>
          {salvando ? 'Gravando…' : 'Criar projeto'}
        </Botao>
        <Botao onClick={() => navegar('/')}>Cancelar</Botao>
      </div>
    </div>
  );
}
