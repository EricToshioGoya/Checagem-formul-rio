import type { ReactNode } from 'react';

export function Carregando({ mensagem = 'Carregando…' }: { mensagem?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-abb-gray" role="status">
      <span className="h-6 w-6 animate-spin rounded-full border-3 border-abb-line border-t-abb-red" />
      <span className="text-base">{mensagem}</span>
    </div>
  );
}

export function Erro({ titulo = 'Ocorreu um erro', detalhe }: { titulo?: string; detalhe?: string }) {
  return (
    <div className="rounded-md border-2 border-abb-red bg-red-50 p-4" role="alert">
      <p className="text-base font-bold text-abb-red">{titulo}</p>
      {detalhe ? (
        <p className="mt-1 text-base whitespace-pre-line text-abb-black">{detalhe}</p>
      ) : null}
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border-2 border-dashed border-abb-line bg-white p-8 text-center">
      <p className="text-lg font-semibold">{titulo}</p>
      {children ? <div className="mt-3 text-base text-abb-gray">{children}</div> : null}
    </div>
  );
}

export function Aviso({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-base text-amber-900">
      {children}
    </div>
  );
}
