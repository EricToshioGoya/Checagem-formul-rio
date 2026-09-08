import type { DefinicaoFormulario, ValoresCabecalho } from '../../core/forms/tipos';
import { GradeCampos } from '../../shared/componentes/GradeCampos';

interface Props {
  definicao: DefinicaoFormulario;
  valores: ValoresCabecalho;
  onChange: (campoId: string, valor: string) => void;
}

/** Dados do projeto e características do painel — preenchidos por TAG. */
export function CabecalhoFormulario({ definicao, valores, onChange }: Props) {
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
        campos={definicao.cabecalho}
        valores={valores}
        onChange={onChange}
        prefixoId="cab"
      />
    </div>
  );
}
