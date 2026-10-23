import { useState } from 'react';
import { ErroApi } from '../../core/api/cliente';
import { baixarCertificadoEmitido, type DecisaoVerificacao } from '../../core/aprovacao/decisoes';
import { Botao } from '../../shared/componentes/Botao';
import { IconePdf } from '../../shared/componentes/Icones';
import { baixarBlob } from '../../shared/utils/download';

/** Botão de download do certificado emitido para um checklist aprovado. */
export function BaixarCertificado({ decisao, compacto = false }: { decisao: DecisaoVerificacao; compacto?: boolean }) {
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const baixar = async () => {
    setBaixando(true);
    setErro(null);
    try {
      const { blob, nome } = await baixarCertificadoEmitido(decisao);
      baixarBlob(blob, nome);
    } catch (e) {
      setErro(
        e instanceof ErroApi && e.semRede
          ? 'Sem conexão: o certificado fica guardado no servidor. Tente de novo com rede.'
          : e instanceof Error
            ? e.message
            : 'Falha ao baixar o certificado.',
      );
    } finally {
      setBaixando(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Botao variante="primario" tamanho={compacto ? 'compacto' : 'normal'} disabled={baixando} onClick={() => void baixar()}>
        <IconePdf className="h-5 w-5" />
        {baixando ? 'Baixando…' : 'Baixar certificado'}
      </Botao>
      {erro ? (
        <span className="text-sm font-semibold text-abb-red" role="alert">
          {erro}
        </span>
      ) : null}
    </span>
  );
}
