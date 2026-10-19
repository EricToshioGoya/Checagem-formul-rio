import { Link } from 'react-router-dom';
import {
  ehCertificado,
  rotuloDaDecisao,
  type DecisaoVerificacao,
  type EstadoVerificacao,
} from '../../core/aprovacao/decisoes';
import { BaixarCertificado } from './BaixarCertificado';
import { dataHoraBr } from '../../shared/utils/texto';

export const ROTULO_VERIFICACAO: Record<EstadoVerificacao, { texto: string; classe: string }> = {
  aguardando: { texto: 'Aguardando aprovação', classe: 'bg-neutral-200 text-abb-black' },
  aprovada: { texto: 'Aprovada', classe: 'bg-green-100 text-green-800' },
  reprovada: { texto: 'Correção pedida', classe: 'bg-amber-400 text-abb-black' },
  substituida: { texto: 'Substituída', classe: 'bg-neutral-100 text-abb-gray' },
};

export function EtiquetaVerificacao({ estado }: { estado: EstadoVerificacao }) {
  const r = ROTULO_VERIFICACAO[estado];
  return <span className={`shrink-0 rounded px-2 py-1 text-sm font-semibold ${r.classe}`}>{r.texto}</span>;
}

/**
 * Situação da aprovação de cada tipo de verificação de um projeto, na tela
 * dele. A reprovada leva às correções.
 */
export function SituacaoAprovacaoProjeto({ decisoes }: { decisoes: DecisaoVerificacao[] }) {
  if (!decisoes.length) return null;
  return (
    <section className="space-y-2 rounded-lg border border-abb-line bg-white p-4" aria-label="Aprovação da administração">
      <h2 className="text-lg font-bold">Aprovação da administração</h2>
      <ul className="space-y-2">
        {decisoes.map((d) => (
          <li
            key={d.uid}
            className={[
              'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3',
              d.estado === 'reprovada' ? 'border-2 border-amber-500 bg-amber-50' : 'border-abb-line',
            ].join(' ')}
          >
            <div className="min-w-0">
              <p className="text-base font-bold">
                {rotuloDaDecisao(d)} <span className="font-normal text-abb-gray">· versão {d.versao ?? '—'}</span>
              </p>
              {ehCertificado(d) && d.estado === 'aprovada' && d.certificado?.numero ? (
                <p className="text-base font-semibold text-green-800">Certificado nº {d.certificado.numero}</p>
              ) : null}
              <p className="text-sm text-abb-gray">
                {d.estado === 'aguardando'
                  ? `Enviado em ${dataHoraBr(d.enviadoEm ?? d.geradoEm)}`
                  : `Decidido em ${dataHoraBr(d.decididoEm ?? undefined)}${d.decididoPor ? ` por ${d.decididoPor}` : ''}`}
                {d.estado !== 'aprovada' && d.ultimaAprovada
                  ? ` · última aprovada: versão ${d.ultimaAprovada.versao}`
                  : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <EtiquetaVerificacao estado={d.estado} />
              {ehCertificado(d) && d.estado === 'aprovada' && d.certificado?.numero ? (
                <BaixarCertificado decisao={d} compacto />
              ) : null}
              {d.estado === 'reprovada' ? (
                <Link
                  to={`/correcoes/${d.uid}`}
                  className="inline-flex min-h-12 items-center rounded-md bg-amber-500 px-4 text-base font-bold text-abb-black hover:bg-amber-400"
                >
                  Ver correções
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
