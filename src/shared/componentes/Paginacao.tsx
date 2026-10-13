import { Botao } from './Botao';

interface Props {
  pagina: number;
  porPagina: number;
  total: number;
  onMudar: (pagina: number) => void;
}

/** "26–50 de 312   ‹ Anterior  2 / 13  Próxima ›". Some quando tudo cabe numa página. */
export function Paginacao({ pagina, porPagina, total, onMudar }: Props) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (total <= porPagina) return null;
  const inicio = (pagina - 1) * porPagina + 1;
  const fim = Math.min(total, pagina * porPagina);
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-abb-gray">
        {inicio}–{fim} de {total}
      </span>
      <div className="flex items-center gap-1.5">
        <Botao tamanho="compacto" disabled={pagina <= 1} onClick={() => onMudar(pagina - 1)}>
          ‹ Anterior
        </Botao>
        <span className="px-1 text-abb-gray tabular-nums">
          {pagina} / {paginas}
        </span>
        <Botao tamanho="compacto" disabled={pagina >= paginas} onClick={() => onMudar(pagina + 1)}>
          Próxima ›
        </Botao>
      </div>
    </nav>
  );
}
