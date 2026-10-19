import { useState } from 'react';
import { servicoValidacao } from '../../core/certificacao';
import { baixarCertificadoAnexado } from '../../core/certificacao/sincronizacaoCertificacao';
import { ErroApi } from '../../core/api/cliente';
import type { AnexoCertificado, Solicitacao } from '../../core/db/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { IconePdf } from '../../shared/componentes/Icones';
import { baixarBlob } from '../../shared/utils/download';
import { dataHoraBr, formatarBytes } from '../../shared/utils/texto';

/**
 * Os arquivos de certificado que a administração anexou na aprovação. O
 * arquivo fica guardado no servidor; baixar exige conexão e registra a
 * emissão.
 */
export function CertificadosAnexados({
  solicitacao,
  por,
  onBaixado,
}: {
  solicitacao: Solicitacao;
  /** Nome de quem baixa, para o histórico. */
  por: string;
  onBaixado?: () => void;
}) {
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const anexos = [...(solicitacao.anexos ?? [])].sort((a, b) => b.anexadoEm - a.anexadoEm);

  const baixar = async (anexo: AnexoCertificado) => {
    setBaixando(anexo.uid);
    setErro(null);
    try {
      const blob = await baixarCertificadoAnexado(solicitacao, anexo);
      baixarBlob(blob, anexo.nomeArquivo);
      await servicoValidacao.registrarEmissao(solicitacao.id!, por);
      onBaixado?.();
    } catch (e) {
      setErro(
        e instanceof ErroApi && e.semRede
          ? 'Sem conexão: o certificado fica guardado no servidor. Tente de novo quando houver rede.'
          : e instanceof Error
            ? e.message
            : 'Falha ao baixar o certificado.',
      );
    } finally {
      setBaixando(null);
    }
  };

  if (!anexos.length) {
    return (
      <p className="text-base text-abb-gray">
        O arquivo deste certificado ainda não foi anexado pela administração. Assim que
        for, ele aparece aqui para baixar.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {anexos.map((anexo, i) => (
          <li key={anexo.uid} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-sm text-abb-gray">
              <span className="block font-semibold break-all text-abb-black">{anexo.nomeArquivo}</span>
              {i === 0 && anexos.length > 1 ? 'Mais recente · ' : ''}
              anexado em {dataHoraBr(anexo.anexadoEm)} · {formatarBytes(anexo.tamanho)}
            </span>
            <Botao
              variante={i === 0 ? 'primario' : 'secundario'}
              disabled={baixando !== null}
              onClick={() => void baixar(anexo)}
            >
              <IconePdf className="h-5 w-5" />
              {baixando === anexo.uid ? 'Baixando…' : 'Baixar certificado'}
            </Botao>
          </li>
        ))}
      </ul>
      {erro ? (
        <p className="text-sm font-semibold text-abb-red" role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
