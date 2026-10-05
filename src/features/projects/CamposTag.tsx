import type { DefinicaoFormulario, EntradaCatalogo, ValoresCabecalho } from '../../core/forms/tipos';
import { camposDaTag, camposVazios } from '../../core/forms/dadosTag';
import { CampoTexto } from '../../shared/componentes/Campos';
import { GradeCampos } from '../../shared/componentes/GradeCampos';
import { EscolhaChecklists } from './EscolhaChecklists';

/** TAG ainda em edição, antes de gravar. */
export interface RascunhoTag {
  nome: string;
  formIds: string[];
  dados: ValoresCabecalho;
}

export function rascunhoVazio(): RascunhoTag {
  return { nome: '', formIds: [], dados: {} };
}

/** Campos dos dados do painel para os checklists marcados, na ordem do painel. */
function camposDoRascunho(
  rascunho: RascunhoTag,
  checklists: readonly EntradaCatalogo[],
  definicoes: Readonly<Record<string, DefinicaoFormulario>>,
) {
  const marcadas = checklists
    .filter((c) => rascunho.formIds.includes(c.id))
    .map((c) => definicoes[c.id])
    .filter((d): d is DefinicaoFormulario => d !== undefined);
  return camposDaTag(marcadas).map((c) => ({ ...c, obrigatorio: true }));
}

export interface PendenciasTag {
  nome: boolean;
  checklists: boolean;
  /** Ids dos campos dos dados do painel ainda vazios. */
  campos: string[];
}

/** O que falta na TAG: nome, ao menos um checklist e todos os dados do painel. */
export function pendenciasDaTag(
  rascunho: RascunhoTag,
  checklists: readonly EntradaCatalogo[],
  definicoes: Readonly<Record<string, DefinicaoFormulario>>,
): PendenciasTag {
  return {
    nome: !rascunho.nome.trim(),
    checklists: checklists.length > 0 && rascunho.formIds.length === 0,
    campos: camposVazios(camposDoRascunho(rascunho, checklists, definicoes), rascunho.dados),
  };
}

export function tagCompleta(p: PendenciasTag): boolean {
  return !p.nome && !p.checklists && p.campos.length === 0;
}

interface Props {
  rascunho: RascunhoTag;
  onChange: (rascunho: RascunhoTag) => void;
  checklists: EntradaCatalogo[];
  definicoes: Record<string, DefinicaoFormulario>;
  /** Destaca o que falta — depois da primeira tentativa de gravar. */
  mostrarPendencias: boolean;
  /** Distingue os ids dos campos quando há várias TAGs na mesma tela. */
  prefixoId: string;
  autoFoco?: boolean;
}

/**
 * Cadastro de uma TAG: o nome, os checklists que ela vai preencher e os dados
 * do painel que esses checklists pedem no cabeçalho.
 */
export function CamposTag({
  rascunho,
  onChange,
  checklists,
  definicoes,
  mostrarPendencias,
  prefixoId,
  autoFoco,
}: Props) {
  const campos = camposDoRascunho(rascunho, checklists, definicoes);
  const pendencias = pendenciasDaTag(rascunho, checklists, definicoes);

  return (
    <div className="space-y-4">
      <CampoTexto
        id={`${prefixoId}-nome`}
        rotulo="Nome da TAG"
        valor={rascunho.nome}
        onChange={(nome) => onChange({ ...rascunho, nome })}
        placeholder="Ex.: QGBT-01"
        obrigatorio
        invalido={mostrarPendencias && pendencias.nome}
        autoFoco={autoFoco}
      />

      {checklists.length ? (
        <EscolhaChecklists
          checklists={checklists}
          selecionados={rascunho.formIds}
          onChange={(formIds) => onChange({ ...rascunho, formIds })}
          avisarVazio={mostrarPendencias}
        />
      ) : null}

      {campos.length ? (
        <div className="space-y-3 rounded-lg border border-abb-line bg-white p-4">
          <h3 className="text-lg font-bold">Dados do painel</h3>
          <GradeCampos
            campos={campos}
            valores={rascunho.dados}
            onChange={(campoId, valor) =>
              onChange({ ...rascunho, dados: { ...rascunho.dados, [campoId]: valor } })
            }
            pendentes={mostrarPendencias ? pendencias.campos : []}
            prefixoId={prefixoId}
          />
        </div>
      ) : checklists.length ? (
        <p className="text-sm text-abb-gray">
          Marque os checklists para informar os dados do painel.
        </p>
      ) : null}
    </div>
  );
}
