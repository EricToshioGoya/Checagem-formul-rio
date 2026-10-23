import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnaliseCertificacao } from './AnaliseCertificacao';
import { AnaliseVerificacao } from './AnaliseVerificacao';
import { FilaCertificacoes, FilaVerificacoes, RegistroCertificados } from './Aprovacoes';

type Secao = 'fila' | 'emitidos' | 'antigas';

const SECOES: Array<{ id: Secao; rotulo: string }> = [
  { id: 'fila', rotulo: 'Checklists para aprovar' },
  { id: 'emitidos', rotulo: 'Certificados emitidos' },
  { id: 'antigas', rotulo: 'Solicitações antigas' },
];

interface Props {
  onSessaoVencida: () => void;
  /** Relê os selos das abas depois de uma decisão. */
  onAlterado: () => void;
  pendentes?: { checklists?: number; antigas?: number };
}

/**
 * Certificados: os checklists que contêm certificado, terminados pelos
 * montadores, com o PDF para aprovar. Aprovado, o certificado é emitido a
 * partir do modelo do checklist, com um código único. Abaixo, o registro de
 * todos os certificados e as solicitações de certificação abertas antes da
 * mudança.
 */
export function Certificados({ onSessaoVencida, onAlterado, pendentes }: Props) {
  const [parametros, setParametros] = useSearchParams();
  const secao: Secao = SECOES.some((s) => s.id === parametros.get('secao'))
    ? (parametros.get('secao') as Secao)
    : 'fila';
  const aberta = Number(parametros.get('abrir')) || null;
  const [mensagem, setMensagem] = useState<string | null>(null);

  const ir = (proxima: Secao, abrir?: number) => {
    const p: Record<string, string> = { aba: 'certificados', secao: proxima };
    if (abrir) p.abrir = String(abrir);
    setParametros(p, { replace: !abrir });
  };

  const decidido = (texto: string) => {
    setMensagem(texto);
    onAlterado();
    ir(secao);
  };

  if (aberta && secao === 'fila') {
    return (
      <AnaliseVerificacao
        id={aberta}
        onVoltar={() => ir('fila')}
        onDecidido={decidido}
        onSessaoVencida={onSessaoVencida}
      />
    );
  }
  if (aberta && secao === 'antigas') {
    return (
      <AnaliseCertificacao
        id={aberta}
        onVoltar={() => ir('antigas')}
        onDecidido={decidido}
        onSessaoVencida={onSessaoVencida}
      />
    );
  }

  const selo = (id: Secao) =>
    id === 'fila' ? pendentes?.checklists : id === 'antigas' ? pendentes?.antigas : undefined;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Certificados</h2>
        <p className="text-sm text-abb-gray">
          Checklists que contêm certificado, terminados pelos montadores. Analise o PDF e as etapas:
          aprovado, o certificado é emitido a partir do modelo do checklist, com um código único que
          nunca se repete. Reprovado, o montador vê as etapas marcadas e corrige.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Seções de certificados">
        {SECOES.map((s) => {
          const n = selo(s.id) ?? 0;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={secao === s.id}
              onClick={() => {
                setMensagem(null);
                ir(s.id);
              }}
              className={[
                'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold',
                secao === s.id
                  ? 'border-abb-black bg-abb-black text-white'
                  : 'border-abb-line-botao bg-abb-offwhite text-abb-black hover:bg-abb-offwhite-hover',
              ].join(' ')}
            >
              {s.rotulo}
              {n > 0 ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1 text-xs font-bold text-white">
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {mensagem ? (
        <div className="rounded-md border border-green-600 bg-green-50 p-3 text-base text-green-900" role="status">
          {mensagem}
        </div>
      ) : null}

      {secao === 'fila' ? (
        <FilaVerificacoes
          categoria="certificado"
          onAbrir={(id) => ir('fila', id)}
          onSessaoVencida={onSessaoVencida}
        />
      ) : secao === 'emitidos' ? (
        <RegistroCertificados onSessaoVencida={onSessaoVencida} />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-abb-gray">
            Solicitações de certificação abertas antes de o checklist com certificado passar para a
            TAG do projeto. Aprovar exige anexar o arquivo do certificado.
          </p>
          <FilaCertificacoes onAbrir={(id) => ir('antigas', id)} onSessaoVencida={onSessaoVencida} />
        </div>
      )}
    </div>
  );
}
