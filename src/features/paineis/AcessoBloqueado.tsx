import { useNavigate } from 'react-router-dom';
import type { Bloqueio } from '../../core/api/acessoLocal';
import { Botao } from '../../shared/componentes/Botao';
import { dataHoraBr } from '../../shared/utils/texto';

const textos: Record<Bloqueio['motivo'], { titulo: string; detalhe: string }> = {
  expirada: {
    titulo: 'O seu acesso a este painel expirou',
    detalhe: 'O prazo liberado pela administração terminou.',
  },
  revogada: {
    titulo: 'O seu acesso a este painel foi retirado',
    detalhe: 'A administração encerrou a sua liberação neste painel.',
  },
  'sem-acesso': {
    titulo: 'Você não tem acesso a este painel',
    detalhe: 'O painel não está liberado para a sua conta.',
  },
};

/**
 * Tela no lugar do projeto quando o acesso ao painel acabou. O que já foi
 * preenchido continua guardado no aparelho e volta a abrir assim que o acesso
 * for liberado de novo.
 */
export function AcessoBloqueado({ bloqueio }: { bloqueio: Bloqueio }) {
  const navegar = useNavigate();
  const texto = textos[bloqueio.motivo];

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-abb-line bg-white p-6 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-abb-red">
        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="5" y="10.5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <h1 className="mt-4 text-xl font-bold">{texto.titulo}</h1>
      <p className="mt-2 text-base text-abb-gray">
        {texto.detalhe}
        {bloqueio.motivo === 'expirada' && bloqueio.expiraEm
          ? ` Venceu em ${dataHoraBr(bloqueio.expiraEm)}.`
          : ''}
      </p>
      <p className="mt-2 text-base text-abb-gray">
        O que você já preencheu continua guardado neste aparelho.
      </p>
      <Botao variante="primario" className="mt-5" onClick={() => navegar('/paineis')}>
        Pedir acesso de novo
      </Botao>
    </div>
  );
}
