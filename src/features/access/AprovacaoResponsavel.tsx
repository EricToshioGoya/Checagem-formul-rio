import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { obterPainel } from '../../core/paineis/catalogo';
import {
  PRAZOS_APROVACAO,
  PRAZO_PADRAO,
  formatarCodigo,
  gerarCodigo,
  validadeDoCodigo,
} from '../../core/access/codigo';
import { normalizarEmail, responsavelDoPainel } from '../../core/auth/acesso';
import type { Painel } from '../../core/paineis/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';
import { dataBr } from '../../shared/utils/texto';
import { abrirEmail } from '../../shared/utils/email';

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
  const [prazo, setPrazo] = useState<number>(PRAZO_PADRAO);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!email || !painelId) {
      setErro('Link incompleto: falta o e-mail do montador ou o painel.');
      return;
    }
    (async () => {
      try {
        const encontrado = await obterPainel(painelId);
        setPainel(encontrado);
        setCodigo(await gerarCodigo(email, encontrado.id, prazo));
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Falha ao gerar o código.');
      }
    })();
  }, [email, painelId, prazo]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(formatarCodigo(codigo));
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro('O navegador bloqueou a cópia. Anote o código manualmente.');
    }
  };

  const validoAte = validadeDoCodigo(codigo);

  const responder = () => {
    if (!painel) return;
    const assunto = `Autorização aprovada — ${painel.nome}`;
    const corpo = [
      'Pedido aprovado.',
      '',
      `Painel: ${painel.nome}`,
      `Montador: ${email}`,
      `Código de aprovação: ${formatarCodigo(codigo)}`,
      `Válido até: ${dataBr(validoAte ?? undefined)}`,
      '',
      'Digite o código na tela de acesso do aplicativo para liberar a montagem.',
      'Vencido o prazo, o acesso fecha sozinho e um código novo é necessário.',
    ].join('\n');
    abrirEmail(email, assunto, corpo);
  };

  if (erro) return <Erro titulo="Aprovação" detalhe={erro} />;
  if (!painel || !codigo) return <Carregando mensagem="Lendo o pedido…" />;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Pedido de acesso ao painel</h1>
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
          <dd className="break-all">{responsavelDoPainel(painel)}</dd>
        </div>
      </dl>

      <div className="rounded-lg border border-abb-line bg-white p-4">
        <p className="text-sm font-semibold text-abb-gray">Prazo do acesso</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRAZOS_APROVACAO.map((dias) => (
            <button
              key={dias}
              type="button"
              aria-pressed={prazo === dias}
              onClick={() => setPrazo(dias)}
              className={`min-h-12 rounded-md border-2 px-4 text-base font-semibold ${
                prazo === dias
                  ? 'border-abb-red bg-red-50 text-abb-red'
                  : 'border-abb-line bg-white text-abb-black'
              }`}
            >
              {dias} dias
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border-2 border-abb-red bg-red-50 p-4 text-center">
        <p className="text-sm font-semibold text-abb-gray">Código de aprovação</p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-widest text-abb-red">
          {formatarCodigo(codigo)}
        </p>
        <p className="mt-2 text-base font-semibold text-abb-black">
          Vale até {dataBr(validoAte ?? undefined)}
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
        O código vale só para este e-mail, este painel e este prazo. Vencido, o acesso
        fecha sozinho no aparelho do montador: para tirar o acesso de alguém, basta não
        repassar código novo. Repasse apenas se reconhecer o montador — quem tiver o
        código acessa o painel até o vencimento.
      </Aviso>
    </div>
  );
}
