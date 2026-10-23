import { useEffect, useState } from 'react';
import type { AlvoChecklist } from '../../core/export/PdfExport';
import { baixarBlob } from '../../shared/utils/download';
import { Botao } from '../../shared/componentes/Botao';
import { Modal } from '../../shared/componentes/Modal';
import { Aviso, Erro } from '../../shared/componentes/Estado';
import { useSessao } from '../../core/api/SessaoContexto';
import { registrarPdfs } from '../../core/sync/arquivoPdfs';
import { atualizarDecisoes, certificadoEmitido } from '../../core/aprovacao/decisoes';
import { ArquivosGerados, EscolhaFotos, type EstadoRegistro } from './PartesDialogoPdf';

interface Props {
  aberto: boolean;
  alvo: AlvoChecklist;
  /** Nome do checklist, mostrado no diálogo. */
  nome: string;
  /** Etapas ainda sem resposta: o PDF sai assim mesmo, com elas sinalizadas. */
  pendentes: number;
  /** Grava o que ainda está a caminho do banco, para o PDF sair com tudo. */
  antesDeGerar?: () => Promise<void>;
  /** Checklist que contém certificado: terminado, o PDF vai para a aba Certificados. */
  contemCertificado?: boolean;
  onFechar: () => void;
}

/** Gera o PDF de um checklist só — o da TAG aberta ou o da solicitação. */
export function DialogoPdfChecklist({
  aberto,
  alvo,
  nome,
  pendentes,
  antesDeGerar,
  contemCertificado = false,
  onFechar,
}: Props) {
  const [incluirFotos, setIncluirFotos] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState<string[] | null>(null);
  const [registro, setRegistro] = useState<EstadoRegistro>(undefined);
  const { usuario } = useSessao();

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setConcluido(null);
    setRegistro(undefined);
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
      // Todo PDF emitido vai para o arquivo do servidor (documentação de
      // garantia) e, o de um checklist que contém certificado, para a aba
      // Certificados. Sem rede, fica na fila do aparelho e segue depois.
      if (usuario) {
        // Certificado já emitido para este checklist: o PDF é só guardado.
        for (const { registro: r } of arquivos) {
          const pedido = r?.verificacao?.certificado;
          const emitido = pedido && certificadoEmitido(usuario.id, pedido.tagUid, pedido.formId);
          if (r && emitido) {
            delete r.verificacao;
            r.semCertificado = `O certificado nº ${emitido.certificado?.numero} deste checklist já foi emitido; o PDF foi só guardado.`;
          }
        }
        setRegistro(null);
        setRegistro(await registrarPdfs(usuario.id, arquivos, 'projetoId' in alvo ? alvo.projetoId : undefined));
        if (contemCertificado) void atualizarDecisoes(usuario.id);
      }
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

        {contemCertificado && 'projetoId' in alvo ? (
          <p className="rounded-md border border-sky-600 bg-sky-50 p-3 text-base text-sky-900">
            Este checklist contém certificado: com todas as etapas respondidas, o PDF vai para a
            administração aprovar e emitir o certificado.
          </p>
        ) : null}

        {pendentes > 0 ? (
          <Aviso>
            Há <strong>{pendentes}</strong> etapa{pendentes === 1 ? '' : 's'} sem resposta.
            O PDF será gerado assim mesmo, com essas etapas sinalizadas como{' '}
            <strong>“Não verificado”</strong>.
            {contemCertificado && 'projetoId' in alvo ? ' Para pedir o certificado, responda todas antes.' : ''}
          </Aviso>
        ) : (
          <p className="rounded-md border border-green-600 bg-green-50 p-3 text-base text-green-900">
            Todas as etapas foram respondidas.
          </p>
        )}

        <EscolhaFotos incluirFotos={incluirFotos} onChange={setIncluirFotos} />

        {erro ? <Erro detalhe={erro} /> : null}
        {concluido ? <ArquivosGerados nomes={concluido} registro={registro} /> : null}
      </div>
    </Modal>
  );
}
