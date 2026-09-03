import type { TabelaReferencia as Tabela } from '../../core/forms/tipos';

/** Tabelas de referência do protocolo (abas por perfil, seções de barra, etc.). */
export function TabelaReferencia({ tabela }: { tabela: Tabela }) {
  return (
    <div className="overflow-x-auto rounded-md border border-abb-line">
      {tabela.titulo ? (
        <p className="border-b border-abb-line bg-neutral-100 px-3 py-2 text-sm font-bold">
          {tabela.titulo}
        </p>
      ) : null}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {tabela.colunas.map((c) => (
              <th key={c} className="border-b border-abb-line bg-neutral-50 p-2 text-left">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabela.linhas.map((linha, i) => (
            <tr key={i} className={i % 2 ? 'bg-neutral-50' : ''}>
              {linha.map((celula, j) => (
                <td key={j} className="border-t border-abb-line p-2 align-top">
                  {celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
