import type { ComponentType } from 'react';
import type { Etapa, TipoResposta, ValorGrade, ValorResposta } from '../../../core/forms/tipos';
import { AreaFotos } from '../AreaFotos';
import { IconeCheck } from '../../../shared/componentes/Icones';
import { CampoNumero, CampoSelecao, CampoTexto } from '../../../shared/componentes/Campos';

export interface PropsCampo {
  etapa: Etapa;
  valor: ValorResposta | undefined;
  onChange: (valor: ValorResposta | null) => void;
  preenchimentoId: number;
  onFotosAlteradas?: () => void;
}

/** Confirmação única. Não existe "não OK": ou está verificado, ou fica em branco. */
function Confirmacao({ valor, onChange }: PropsCampo) {
  const marcado = valor === true;
  return (
    <button
      type="button"
      aria-pressed={marcado}
      onClick={() => onChange(marcado ? null : true)}
      className={[
        'flex min-h-14 w-full items-center gap-3 rounded-md border-2 px-4 text-left text-base font-bold',
        marcado
          ? 'border-green-700 bg-green-50 text-green-800'
          : 'border-abb-line bg-white text-abb-black',
      ].join(' ')}
    >
      <span
        className={[
          'flex h-8 w-8 shrink-0 items-center justify-center rounded border-2',
          marcado ? 'border-green-700 bg-green-700 text-white' : 'border-abb-gray bg-white',
        ].join(' ')}
      >
        {marcado ? <IconeCheck className="h-6 w-6" /> : null}
      </span>
      {marcado ? 'Verificado' : 'Marcar como verificado'}
    </button>
  );
}

function ConfirmacaoComFoto(props: PropsCampo) {
  return (
    <div className="space-y-3">
      <Confirmacao {...props} />
      <AreaFotos
        preenchimentoId={props.preenchimentoId}
        etapaId={props.etapa.id}
        onAlterou={props.onFotosAlteradas}
      />
    </div>
  );
}

function SomenteFotos(props: PropsCampo) {
  return (
    <AreaFotos
      preenchimentoId={props.preenchimentoId}
      etapaId={props.etapa.id}
      onAlterou={props.onFotosAlteradas}
    />
  );
}

function AnexoPdf(props: PropsCampo) {
  return (
    <AreaFotos
      preenchimentoId={props.preenchimentoId}
      etapaId={props.etapa.id}
      aceitaPdf
      onAlterou={props.onFotosAlteradas}
    />
  );
}

function Numero({ etapa, valor, onChange }: PropsCampo) {
  return (
    <CampoNumero
      id={`campo-${etapa.id}`}
      rotulo="Valor aferido"
      unidade={etapa.unidade}
      valor={typeof valor === 'number' ? valor : null}
      onChange={(v) => onChange(v)}
    />
  );
}

function Texto({ etapa, valor, onChange }: PropsCampo) {
  return (
    <CampoTexto
      id={`campo-${etapa.id}`}
      rotulo="Registro"
      multilinha
      valor={typeof valor === 'string' ? valor : ''}
      onChange={(v) => onChange(v === '' ? null : v)}
    />
  );
}

function Selecao({ etapa, valor, onChange }: PropsCampo) {
  return (
    <CampoSelecao
      id={`campo-${etapa.id}`}
      rotulo="Registro"
      opcoes={etapa.opcoes ?? []}
      valor={typeof valor === 'string' ? valor : ''}
      onChange={(v) => onChange(v === '' ? null : v)}
    />
  );
}

/**
 * Grade de valores dos ensaios (R3 e R5 da rotina BT).
 * Registra o número informado; não há validação de faixa nem alerta —
 * o julgamento é do inspetor, fora do sistema.
 */
function GradeNumerica({ etapa, valor, onChange }: PropsCampo) {
  const grade = etapa.grade;
  if (!grade) return null;
  const atual = (typeof valor === 'object' && valor !== null ? valor : {}) as ValorGrade;

  const alterar = (linhaId: string, colunaId: string, novo: number | null) => {
    const proximo: ValorGrade = {
      ...atual,
      [linhaId]: { ...(atual[linhaId] ?? {}), [colunaId]: novo },
    };
    onChange(proximo);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-base">
        <thead>
          <tr>
            <th className="border border-abb-line bg-neutral-100 p-2 text-left">Ponto</th>
            {grade.colunas.map((c) => (
              <th key={c.id} className="border border-abb-line bg-neutral-100 p-2 text-left">
                {c.rotulo}
                {c.unidade ? <span className="text-abb-gray"> ({c.unidade})</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grade.linhas.map((linha) => (
            <tr key={linha.id}>
              <th scope="row" className="border border-abb-line p-2 text-left font-semibold">
                {linha.rotulo}
              </th>
              {grade.colunas.map((c) => {
                const v = atual[linha.id]?.[c.id];
                return (
                  <td key={c.id} className="border border-abb-line p-1">
                    <CampoNumero
                      compacto
                      rotuloAcessivel={`${linha.rotulo} — ${c.rotulo}`}
                      valor={typeof v === 'number' && Number.isFinite(v) ? v : null}
                      onChange={(novo) => alterar(linha.id, c.id, novo)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Registro de tipos de campo. Um tipo novo entra aqui com o seu componente,
 * sem alteração no motor de formulários (ponto de extensão 2).
 */
export const registroCampos: Record<TipoResposta, ComponentType<PropsCampo>> = {
  check: Confirmacao,
  check_com_foto: ConfirmacaoComFoto,
  foto: SomenteFotos,
  numero: Numero,
  texto: Texto,
  selecao: Selecao,
  anexo_pdf: AnexoPdf,
  grade_numerica: GradeNumerica,
};

export function componenteDoTipo(tipo: TipoResposta): ComponentType<PropsCampo> {
  return registroCampos[tipo] ?? Texto;
}
