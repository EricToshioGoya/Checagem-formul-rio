import { campoDoProjeto } from '../../core/forms/dadosTag';
import type { DefinicaoFormulario, ValoresCabecalho } from '../../core/forms/tipos';
import { GradeCampos } from '../../shared/componentes/GradeCampos';

interface Props {
  definicao: DefinicaoFormulario;
  valores: ValoresCabecalho;
  onChange: (campoId: string, valor: string) => void;
  /** Preenchimento de uma TAG de projeto: os campos do projeto valem para todas as TAGs. */
  daTag?: boolean;
}

/**
 * Dados do projeto e características do painel — preenchidos por TAG, exceto
 * fabricante e cliente final, que valem para todas as TAGs do projeto.
 */
export function CabecalhoFormulario({ definicao, valores, onChange, daTag = false }: Props) {
  if (definicao.cabecalho.length === 0) {
    return (
      <p className="text-base text-abb-gray">
        Este formulário não tem campos de cabeçalho.
      </p>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-abb-line bg-white p-4">
      <h3 className="text-lg font-bold">Dados do painel</h3>
      <GradeCampos
        campos={
          daTag
            ? definicao.cabecalho.map((c) =>
                campoDoProjeto(c.id)
                  ? { ...c, ajuda: c.ajuda ?? 'Vale para todas as TAGs do projeto.' }
                  : c,
              )
            : definicao.cabecalho
        }
        valores={valores}
        onChange={onChange}
        prefixoId="cab"
      />
    </div>
  );
}
