import type { DefinicaoFormulario, ValoresCabecalho } from '../../core/forms/tipos';
import {
  CampoData,
  CampoNumero,
  CampoSelecao,
  CampoTexto,
} from '../../shared/componentes/Campos';

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
      <div className="grid gap-4 sm:grid-cols-2">
        {definicao.cabecalho.map((campo) => {
          const valor = valores[campo.id] ?? '';
          const comum = {
            id: `cab-${campo.id}`,
            rotulo: campo.rotulo,
            ajuda: campo.ajuda,
          };
          if (campo.tipo === 'numero') {
            return (
              <CampoNumero
                key={campo.id}
                {...comum}
                unidade={campo.unidade}
                valor={valor === '' ? null : Number(valor)}
                onChange={(v) => onChange(campo.id, v === null ? '' : String(v))}
              />
            );
          }
          if (campo.tipo === 'selecao') {
            return (
              <CampoSelecao
                key={campo.id}
                {...comum}
                opcoes={campo.opcoes ?? []}
                valor={valor}
                onChange={(v) => onChange(campo.id, v)}
              />
            );
          }
          if (campo.tipo === 'data') {
            return (
              <CampoData
                key={campo.id}
                {...comum}
                valor={valor}
                onChange={(v) => onChange(campo.id, v)}
              />
            );
          }
          return (
            <CampoTexto
              key={campo.id}
              {...comum}
              valor={valor}
              onChange={(v) => onChange(campo.id, v)}
            />
          );
        })}
      </div>
    </div>
  );
}
