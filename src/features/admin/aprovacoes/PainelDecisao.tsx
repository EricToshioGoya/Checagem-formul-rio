import { useState, type ReactNode } from 'react';
import { Botao } from '../../../shared/componentes/Botao';
import { CampoTexto } from '../../../shared/componentes/Campos';
import { Confirmacao } from '../../../shared/componentes/Confirmacao';
import { Erro } from '../../../shared/componentes/Estado';

interface Props {
  /** Etapas marcadas como não conformes. */
  marcadas: number;
  /** Das marcadas, quantas ainda sem o motivo. */
  semMotivo: number;
  rotuloAprovar: string;
  rotuloReprovar: string;
  /** Conteúdo extra antes dos botões (ex.: o arquivo do certificado). */
  extra?: ReactNode;
  /** Motivo de não poder aprovar ainda, além das marcas (ex.: falta o arquivo). */
  bloqueioAprovar?: string | null;
  onDecidir: (decisao: 'aprovada' | 'reprovada', comentario: string) => Promise<void>;
}

/**
 * Rodapé da análise: comentário geral e a decisão. Aprovar exige nenhuma
 * etapa marcada; reprovar exige o motivo de cada etapa marcada (ou um
 * comentário). A decisão é definitiva, então passa por confirmação.
 */
export function PainelDecisao({
  marcadas,
  semMotivo,
  rotuloAprovar,
  rotuloReprovar,
  extra,
  bloqueioAprovar,
  onDecidir,
}: Props) {
  const [comentario, setComentario] = useState('');
  const [confirmando, setConfirmando] = useState<'aprovada' | 'reprovada' | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const podeAprovar = marcadas === 0 && !bloqueioAprovar;
  const podeReprovar = semMotivo === 0 && (marcadas > 0 || comentario.trim().length > 0);

  const confirmar = async () => {
    if (!confirmando) return;
    const decisao = confirmando;
    setConfirmando(null);
    setOcupado(true);
    setErro(null);
    try {
      await onDecidir(decisao, comentario.trim());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gravar a decisão.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="sticky bottom-0 z-10 space-y-3 rounded-lg border-2 border-abb-black bg-white p-4 shadow-lg">
      <h3 className="text-lg font-bold">Decisão</h3>
      <p className="text-base text-abb-gray">
        {marcadas
          ? `${marcadas} etapa(s) marcada(s) como não conforme(s)${semMotivo ? ` — falta descrever ${semMotivo}` : ''}.`
          : 'Nenhuma etapa marcada como não conforme.'}
      </p>
      <CampoTexto
        rotulo="Comentário geral (opcional)"
        multilinha
        valor={comentario}
        onChange={setComentario}
        placeholder="Vai junto com a decisão para o montador."
        maxLength={4000}
      />
      {extra}
      {erro ? <Erro detalhe={erro} /> : null}
      <div className="flex flex-wrap gap-2">
        <Botao variante="primario" disabled={ocupado || !podeAprovar} onClick={() => setConfirmando('aprovada')}>
          {rotuloAprovar}
        </Botao>
        <Botao variante="perigo" disabled={ocupado || !podeReprovar} onClick={() => setConfirmando('reprovada')}>
          {rotuloReprovar}
        </Botao>
      </div>
      {marcadas > 0 ? (
        <p className="text-sm text-abb-gray">Com etapas marcadas, só é possível pedir correção.</p>
      ) : bloqueioAprovar ? (
        <p className="text-sm text-abb-gray">{bloqueioAprovar}</p>
      ) : null}

      <Confirmacao
        aberto={confirmando !== null}
        titulo={confirmando === 'aprovada' ? 'Confirmar aprovação' : 'Confirmar pedido de correção'}
        mensagem={
          confirmando === 'aprovada'
            ? 'A aprovação é definitiva e o montador será avisado.'
            : `O montador será avisado e verá ${marcadas ? `as ${marcadas} etapa(s) marcada(s), com o motivo de cada uma` : 'o comentário'} em destaque na tela inicial.`
        }
        textoConfirmar={confirmando === 'aprovada' ? 'Aprovar' : 'Pedir correção'}
        onCancelar={() => setConfirmando(null)}
        onConfirmar={() => void confirmar()}
      />
    </section>
  );
}
