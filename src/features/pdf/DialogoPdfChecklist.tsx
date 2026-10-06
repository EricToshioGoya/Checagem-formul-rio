import { useEffect, useState } from 'react';
import type { AlvoChecklist } from '../../core/export/PdfExport';
import { baixarBlob } from '../../shared/utils/download';
import { Botao } from '../../shared/componentes/Botao';
import { Modal } from '../../shared/componentes/Modal';
import { Aviso, Erro } from '../../shared/componentes/Estado';
import { ArquivosGerados, EscolhaFotos } from './PartesDialogoPdf';

interface Props {
  aberto: boolean;
  alvo: AlvoChecklist;
  /** Nome do checklist, mostrado no diálogo. */
  nome: string;
  /** Etapas ainda sem resposta: o PDF sai assim mesmo, com elas sinalizadas. */
  pendentes: number;
  /** Grava o que ainda está a caminho do banco, para o PDF sair com tudo. */
  antesDeGerar?: () => Promise<void>;
  onFechar: () => void;
}

/** Gera o PDF de um checklist só — o da TAG aberta ou o da solicitação. */
export function DialogoPdfChecklist({ aberto, alvo, nome, pendentes, antesDeGerar, onFechar }: Props) {
  const [incluirFotos, setIncluirFotos] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState<string[] | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setConcluido(null);
  }, [aberto]);

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    try {
      await antesDeGerar?.();
      const { gerarArquivosChecklist } = await import('../../core/export/PdfExport');
      const arquivos = await gerarArquivosChecklist(alvo, incluirFotos);
      for (const arquivo of arquivos) baixarBlob(arquivo.blob, arquivo.nome);
      setConcluido(arquivos.map((a) => a.nome));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao gerar o PDF.');
    } finally {
      setGerando(false);
    }
  };

  return (
    <Modal
      aberto={aberto}
      titulo="Gerar PDF"
      onFechar={onFechar}
      rodape={
        <>
          <Botao onClick={onFechar}>Fechar</Botao>
          <Botao variante="primario" onClick={() => void gerar()} disabled={gerando}>
            {gerando ? 'Gerando…' : 'Gerar e baixar'}
          </Botao>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-base">
          <strong>{nome}</strong>, com todas as respostas, observações e fotos.
        </p>

        {pendentes > 0 ? (
          <Aviso>
            Há <strong>{pendentes}</strong> etapa{pendentes === 1 ? '' : 's'} sem resposta.
            O PDF será gerado assim mesmo, com essas etapas sinalizadas como{' '}
            <strong>“Não verificado”</strong>.
          </Aviso>
        ) : (
          <p className="rounded-md border border-green-600 bg-green-50 p-3 text-base text-green-900">
            Todas as etapas foram respondidas.
          </p>
        )}

        <EscolhaFotos incluirFotos={incluirFotos} onChange={setIncluirFotos} />

        {erro ? <Erro detalhe={erro} /> : null}
        {concluido ? <ArquivosGerados nomes={concluido} /> : null}
      </div>
    </Modal>
  );
}
