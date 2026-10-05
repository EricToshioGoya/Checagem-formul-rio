import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProjetoRepository } from '../../core/db/repositorios';
import { useSessao } from '../../core/api/SessaoContexto';
import { conferirAcessoPainel, painelGuardado, type Bloqueio } from '../../core/api/acessoLocal';
import { carregarFormulario, formulariosDoPainel } from '../../core/forms/catalogo';
import { prepararTag } from '../../core/forms/dadosTag';
import type { DefinicaoFormulario, EntradaCatalogo } from '../../core/forms/tipos';
import { AcessoBloqueado } from '../paineis/AcessoBloqueado';
import { Botao } from '../../shared/componentes/Botao';
import { CampoNumero, CampoTexto } from '../../shared/componentes/Campos';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeVoltar } from '../../shared/componentes/Icones';
import {
  CamposTag,
  pendenciasDaTag,
  rascunhoVazio,
  tagCompleta,
  type RascunhoTag,
} from './CamposTag';

/** Teto da quantidade de TAGs num cadastro: cada uma é um bloco de campos na tela. */
const MAXIMO_TAGS = 50;

interface Painel {
  slug: string;
  nome: string;
}

/**
 * Cadastro de um projeto no painel: nome, empresa, quantas TAGs e, para cada
 * TAG, o nome, os checklists e os dados do painel. Tudo obrigatório.
 */
export function NovoProjeto() {
  const { painelId } = useParams();
  const id = Number(painelId);
  const navegar = useNavigate();
  const { usuario } = useSessao();

  const [painel, setPainel] = useState<Painel | null>(null);
  const [bloqueio, setBloqueio] = useState<Bloqueio | null>(null);
  const [checklists, setChecklists] = useState<EntradaCatalogo[] | null>(null);
  const [definicoes, setDefinicoes] = useState<Record<string, DefinicaoFormulario>>({});
  const [erroCarga, setErroCarga] = useState<string | null>(null);

  const [nomeProjeto, setNomeProjeto] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [quantidade, setQuantidade] = useState<number | null>(1);
  // Guarda mais rascunhos do que a quantidade mostra: diminuir e voltar a
  // aumentar não apaga o que já foi digitado.
  const [tags, setTags] = useState<RascunhoTag[]>([rascunhoVazio()]);
  const [tentou, setTentou] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!usuario || !Number.isFinite(id)) return;
    let ativo = true;
    (async () => {
      try {
        const b = await conferirAcessoPainel(usuario.id, id);
        if (!ativo) return;
        if (b) {
          setBloqueio(b);
          return;
        }
        const p = painelGuardado(usuario.id, id);
        if (!p) {
          setErroCarga('Painel desconhecido neste aparelho. Abra a lista de painéis com conexão e tente de novo.');
          return;
        }
        const lista = await formulariosDoPainel(p.slug);
        const mapa: Record<string, DefinicaoFormulario> = {};
        for (const c of lista) mapa[c.id] = await carregarFormulario(c.id);
        if (!ativo) return;
        setPainel(p);
        setDefinicoes(mapa);
        setChecklists(lista);
      } catch (e) {
        if (ativo) setErroCarga(e instanceof Error ? e.message : 'Falha ao preparar o cadastro.');
      }
    })();
    return () => {
      ativo = false;
    };
  }, [usuario, id]);

  if (!Number.isFinite(id)) return <Erro detalhe="Painel inválido." />;
  if (bloqueio) return <AcessoBloqueado bloqueio={bloqueio} />;
  if (erroCarga) return <Erro detalhe={erroCarga} />;
  if (!painel || !checklists || !usuario) return <Carregando mensagem="Preparando o cadastro…" />;

  const visiveis = tags.slice(0, quantidade ?? 0);
  const pendencias = visiveis.map((t) => pendenciasDaTag(t, checklists, definicoes));
  const faltas: string[] = [];
  if (!nomeProjeto.trim()) faltas.push('Nome do projeto');
  if (!empresa.trim()) faltas.push('Empresa');
  if (!quantidade) faltas.push('Quantidade de TAGs');
  pendencias.forEach((p, i) => {
    const partes: string[] = [];
    if (p.nome) partes.push('nome');
    if (p.checklists) partes.push('checklists');
    if (p.campos.length) {
      partes.push(`${p.campos.length} ${p.campos.length === 1 ? 'campo' : 'campos'} dos dados do painel`);
    }
    if (partes.length) faltas.push(`TAG ${i + 1}: ${partes.join(', ')}`);
  });
  const valido = faltas.length === 0 && pendencias.every(tagCompleta);

  const mudarQuantidade = (valor: number | null) => {
    const n = valor === null ? null : Math.max(0, Math.min(MAXIMO_TAGS, Math.trunc(valor)));
    setQuantidade(n);
    if (n !== null) {
      setTags((atual) =>
        atual.length >= n
          ? atual
          : [...atual, ...Array.from({ length: n - atual.length }, rascunhoVazio)],
      );
    }
  };

  const mudarTag = (indice: number, rascunho: RascunhoTag) =>
    setTags((atual) => atual.map((t, i) => (i === indice ? rascunho : t)));

  const criar = async () => {
    setTentou(true);
    if (!valido) return;
    setGravando(true);
    setErro(null);
    try {
      const entradas = [];
      for (const t of visiveis) {
        // Na ordem do painel, e não na ordem em que foram marcados.
        const formIds = checklists.length
          ? checklists.filter((c) => t.formIds.includes(c.id)).map((c) => c.id)
          : undefined;
        entradas.push(await prepararTag(t.nome, formIds, t.dados));
      }
      const projetoId = await ProjetoRepository.criar({
        empresa,
        nomeProjeto,
        operador: usuario.nome,
        painelId: id,
        painelSlug: painel.slug,
        usuarioId: usuario.id,
        tags: entradas,
      });
      navegar(`/projetos/${projetoId}`, { replace: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar o projeto.');
      setGravando(false);
    }
  };

  const voltar = `/paineis/${id}/projetos`;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <Botao variante="texto" onClick={() => navegar(voltar)} aria-label="Voltar aos projetos">
          <IconeVoltar />
        </Botao>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">{painel.nome}</p>
          <h1 className="text-2xl font-bold">Novo projeto</h1>
        </div>
      </div>

      <section className="space-y-4 rounded-lg border border-abb-line bg-white p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            id="projeto-nome"
            rotulo="Nome do projeto"
            valor={nomeProjeto}
            onChange={setNomeProjeto}
            placeholder="Ex.: Subestação Norte"
            obrigatorio
            invalido={tentou && !nomeProjeto.trim()}
            autoFoco
          />
          <CampoTexto
            id="projeto-empresa"
            rotulo="Empresa"
            valor={empresa}
            onChange={setEmpresa}
            placeholder="Ex.: Montadora Parceira Ltda."
            ajuda="Aparece na capa e no nome do arquivo do PDF."
            obrigatorio
            invalido={tentou && !empresa.trim()}
          />
          <CampoNumero
            id="projeto-quantidade"
            rotulo="Quantidade de TAGs"
            valor={quantidade}
            onChange={mudarQuantidade}
            ajuda={`De 1 a ${MAXIMO_TAGS}.`}
            obrigatorio
            invalido={tentou && !quantidade}
          />
        </div>
      </section>

      {visiveis.map((t, i) => (
        <section
          key={i}
          aria-label={`TAG ${i + 1}`}
          className="space-y-3 rounded-lg border border-abb-line bg-abb-offwhite p-4"
        >
          <h2 className="text-xl font-bold">TAG {i + 1}</h2>
          <CamposTag
            rascunho={t}
            onChange={(r) => mudarTag(i, r)}
            checklists={checklists}
            definicoes={definicoes}
            mostrarPendencias={tentou}
            prefixoId={`tag${i + 1}`}
          />
        </section>
      ))}

      {tentou && !valido ? (
        <Erro titulo="Preencha o que falta para criar o projeto" detalhe={faltas.join('\n')} />
      ) : null}
      {erro ? <Erro detalhe={erro} /> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Link
          to={voltar}
          className="inline-flex min-h-12 items-center rounded-md border border-abb-line-botao bg-abb-offwhite px-5 text-base font-semibold hover:bg-abb-offwhite-hover"
        >
          Cancelar
        </Link>
        <Botao variante="primario" disabled={gravando} onClick={() => void criar()}>
          {gravando ? 'Criando…' : 'Criar projeto'}
        </Botao>
      </div>
    </div>
  );
}
