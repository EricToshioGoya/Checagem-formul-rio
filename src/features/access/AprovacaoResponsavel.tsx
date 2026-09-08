import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { carregarPaineis } from '../../core/access/paineis';
import { formatarCodigo, gerarCodigo, normalizarEmail } from '../../core/access/codigo';
import type { Painel } from '../../core/access/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';

/**
 * Tela aberta pelo responsável a partir do link recebido por e-mail. Ela não
 * grava nada: apenas exibe o pedido e o código que libera aquele montador
 * naquele painel. Aprovar é repassar o código ao montador.
 */
export function AprovacaoResponsavel() {
  const [parametros] = useSearchParams();
  const email = normalizarEmail(parametros.get('email') ?? '');
  const painelId = parametros.get('painel') ?? '';

  const [painel, setPainel] = useState<Painel | null>(null);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!email || !painelId) {
      setErro('Link incompleto: falta o e-mail do montador ou o painel.');
      return;
    }
    (async () => {
      try {
        const catalogo = await carregarPaineis();
        const encontrado = catalogo.paineis.find((p) => p.id === painelId);
        if (!encontrado) {
          setErro(`Painel "${painelId}" não existe no catálogo desta versão.`);
          return;
        }
        setPainel(encontrado);
        setCodigo(await gerarCodigo(email, encontrado.id));
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Falha ao gerar o código.');
      }
    })();
  }, [email, painelId]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(formatarCodigo(codigo));
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro('O navegador bloqueou a cópia. Anote o código manualmente.');
    }
  };

  const responder = () => {
    if (!painel) return;
    const assunto = `Autorização aprovada — ${painel.nome}`;
    const corpo = [
      'Pedido aprovado.',
      '',
      `Painel: ${painel.nome}`,
      `Montador: ${email}`,
      `Código de aprovação: ${formatarCodigo(codigo)}`,
      '',
      'Digite o código na tela de acesso do aplicativo para liberar a montagem.',
    ].join('\n');
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
      assunto,
    )}&body=${encodeURIComponent(corpo)}`;
  };

  if (erro) return <Erro titulo="Aprovação" detalhe={erro} />;
  if (!painel || !codigo) return <Carregando mensagem="Lendo o pedido…" />;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Pedido de acesso à montagem</h1>
        <p className="mt-1 text-base text-abb-gray">
          Confira os dados antes de repassar o código.
        </p>
      </div>

      <dl className="space-y-3 rounded-lg border border-abb-line bg-white p-4 text-base">
        <div>
          <dt className="text-sm font-semibold text-abb-gray">Montador</dt>
          <dd className="break-all">{email}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-abb-gray">Painel</dt>
          <dd>{painel.nome}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-abb-gray">Responsável</dt>
          <dd className="break-all">{painel.responsavelEmail}</dd>
        </div>
      </dl>

      <div className="rounded-lg border-2 border-abb-red bg-red-50 p-4 text-center">
        <p className="text-sm font-semibold text-abb-gray">Código de aprovação</p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-widest text-abb-red">
          {formatarCodigo(codigo)}
        </p>
      </div>

      <div className="space-y-2">
        <Botao variante="primario" larguraTotal onClick={responder}>
          Responder ao montador por e-mail
        </Botao>
        <Botao larguraTotal onClick={copiar}>
          {copiado ? 'Código copiado' : 'Copiar código'}
        </Botao>
      </div>

      <Aviso>
        O código vale só para este e-mail e este painel, e não expira. Repasse-o apenas se
        reconhecer o montador — quem tiver o código monta o painel.
      </Aviso>
    </div>
  );
}
