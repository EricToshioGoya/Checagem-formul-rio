import type { CampoCabecalho, ValoresCabecalho } from '../../core/forms/tipos';
import { CampoData, CampoNumero, CampoSelecao, CampoTexto } from './Campos';

interface Props {
  campos: CampoCabecalho[];
  valores: ValoresCabecalho;
  onChange: (campoId: string, valor: string) => void;
  /** Ids destacados em vermelho por estarem obrigatórios e vazios. */
  pendentes?: string[];
  prefixoId?: string;
}

/**
 * Renderiza uma lista de campos definida em arquivo de dados. É usada tanto
 * pelo cabeçalho dos formulários quanto pelos dados da solicitação — nenhum
 * campo é escrito no código da tela.
 */
export function GradeCampos({
  campos,
  valores,
  onChange,
  pendentes = [],
  prefixoId = 'campo',
}: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {campos.map((campo) => {
        const valor = valores[campo.id] ?? '';
        const invalido = pendentes.includes(campo.id);
        const comum = {
          id: `${prefixoId}-${campo.id}`,
          rotulo: campo.rotulo,
          ajuda: campo.ajuda,
          obrigatorio: campo.obrigatorio,
          invalido,
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
              id={comum.id}
              rotulo={comum.rotulo}
              ajuda={comum.ajuda}
              obrigatorio={comum.obrigatorio}
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
              id={comum.id}
              rotulo={comum.rotulo}
              ajuda={comum.ajuda}
              obrigatorio={comum.obrigatorio}
              valor={valor}
              onChange={(v) => onChange(campo.id, v)}
            />
          );
        }
        return (
          <CampoTexto
            key={campo.id}
            {...comum}
            formato={
              campo.tipo === 'email' ? 'email' : campo.tipo === 'telefone' ? 'telefone' : 'texto'
            }
            valor={valor}
            onChange={(v) => onChange(campo.id, v)}
          />
        );
      })}
    </div>
  );
}
