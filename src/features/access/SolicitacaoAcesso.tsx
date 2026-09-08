import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { codigoConfere } from '../../core/access/codigo';
import { enviarPedidoAprovacao, type ResultadoEnvio } from '../../core/access/envio';
import { responsavelDoPainel } from '../../core/auth/acesso';
import { AcessoRepository } from '../../core/db/repositorios';
import type { Painel } from '../../core/paineis/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Aviso, Erro } from '../../shared/componentes/Estado';
import { abrirEmail } from '../../shared/utils/email';
import { useSessao } from '../auth/SessaoContexto';

/**
 * Link que o responsável abre para ver o código do pedido.
 *
 * Resolvido contra o endereço aberto, e não colado à mão: com base relativa
 * (`./`, que é como sai o pacote de página única) concatenar origem e base
 * produzia `https://servidor./#/aprovar` — host com ponto final, que nenhum
 * certificado atende e o navegador recusa com 421.
 */
function linkDeAprovacao(email: string, painelId: string): string {
  const parametros = new URLSearchParams({ email, painel: painelId });
  return new URL(`#/aprovar?${parametros.toString()}`, window.location.href).toString();
}

/**
 * Pedido de acesso ao painel escolhido. O montador já está identificado pelo
 * login; aqui ele dispara o e-mail ao responsável e digita o código devolvido.
 */
export function SolicitacaoAcesso() {
  const navegar = useNavigate();
  const { email, painel, aprovado, revalidarAcesso, trocarPainel } = useSessao();
  const [pedido, setPedido] = useState(false);
  const [envio, setEnvio] = useState<ResultadoEnvio | null>(null);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const registrar = useCallback(
    async (alvo: Painel) => {
      if (!email) return;
      await AcessoRepository.registrarPedido({
        email,
        painelId: alvo.id,
        painelNome: alvo.nome,
        responsavelEmail: responsavelDoPainel(alvo),
      });
    },
    [email],
  );

  // Reabrir a tela com um pedido já registrado retoma o passo do código.
  useEffect(() => {
    if (!email || !painel) return;
    AcessoRepository.obter(email, painel.id).then((a) => setPedido(Boolean(a)));
  }, [email, painel]);

  useEffect(() => {
    if (aprovado) navegar('/', { replace: true });
  }, [aprovado, navegar]);

  if (!email || !painel) return <Erro detalhe="Escolha um painel para pedir o acesso." />;

  const responsavel = responsavelDoPainel(painel);

  /**
   * O e-mail leva apenas o link. O código nunca vai no corpo: quem envia a
   * mensagem é o próprio montador, e ele não pode vê-lo.
   */
  const enviarPedidoPorEmail = () => {
    const assunto = `Autorização de montagem — ${painel.nome}`;
    const corpo = [
      'Prezado(a),',
      '',
      `Solicito autorização para trabalhar no painel ${painel.nome}.`,
      '',
      `Montador: ${email}`,
      `Painel: ${painel.nome}`,
      `Data do pedido: ${new Date().toLocaleString('pt-BR')}`,
      '',
      'Para autorizar, abra o link abaixo e envie o código de aprovação exibido:',
      linkDeAprovacao(email, painel.id),
      '',
      'Sem o código o acesso ao painel permanece bloqueado.',
    ].join('\n');
    abrirEmail(responsavel, assunto, corpo);
  };

  const solicitar = async () => {
    setErro(null);
    setOcupado(true);
    try {
      await registrar(painel);
      setPedido(true);

      // Com servidor configurado, é ele quem manda a mensagem. Sem ele, resta
      // o rascunho no programa de e-mail do próprio montador.
      const resultado = await enviarPedidoAprovacao(email, painel.id);
      setEnvio(resultado);
      if (!resultado.enviado) enviarPedidoPorEmail();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar o pedido.');
    } finally {
      setOcupado(false);
    }
  };

  const liberar = async () => {
    setErro(null);
    setOcupado(true);
    try {
      if (!(await codigoConfere(email, painel.id, codigo))) {
        setErro('Código inválido para este e-mail e painel. Confira com o responsável.');
        return;
      }
      await registrar(painel);
      await AcessoRepository.aprovar(email, painel.id);
      await revalidarAcesso();
      navegar('/', { replace: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível liberar o acesso.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Acesso ao painel {painel.nome}</h1>
        <p className="mt-1 text-base text-abb-gray">
          O painel só abre depois que o responsável aprovar o seu pedido.
        </p>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      <div className="space-y-4 rounded-lg border border-abb-line bg-white p-4">
        <dl className="space-y-2 text-base">
          <div>
            <dt className="text-sm font-semibold text-abb-gray">Montador</dt>
            <dd className="break-all">{email}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-abb-gray">Responsável pelo painel</dt>
            <dd className="break-all">{responsavel}</dd>
          </div>
        </dl>

        <Botao variante="primario" larguraTotal onClick={solicitar} disabled={ocupado}>
          {pedido ? 'Reenviar pedido por e-mail' : 'Solicitar aprovação por e-mail'}
        </Botao>

        {envio?.enviado ? (
          <p className="rounded-md border border-green-600 bg-green-50 p-3 text-base text-green-800">
            Pedido enviado para <strong className="break-all">{envio.destinatario}</strong>.
            Aguarde o código de aprovação.
          </p>
        ) : null}
        {envio && !envio.enviado ? (
          <p className="text-sm text-abb-gray">
            O servidor não enviou o e-mail ({envio.motivo}). Abrimos um rascunho no seu
            programa de e-mail; se ele não abrir, envie o link abaixo por conta própria.
          </p>
        ) : null}

        <details className="text-sm text-abb-gray" open={pedido && !envio?.enviado}>
          <summary className="min-h-8 cursor-pointer">O aplicativo de e-mail não abriu?</summary>
          <p className="mt-2 break-all">
            Envie manualmente para <strong>{responsavel}</strong> este link:
            <br />
            {linkDeAprovacao(email, painel.id)}
          </p>
        </details>
      </div>

      <div className="space-y-3 rounded-lg border border-abb-line bg-white p-4">
        <Aviso>
          O responsável abre o link, lê o código e devolve a você. Digite-o abaixo para
          liberar este painel no aparelho.
        </Aviso>

        <CampoTexto
          id="codigo-aprovacao"
          rotulo="Código de aprovação"
          valor={codigo}
          onChange={setCodigo}
          placeholder="XXXX-XXXX"
        />
        <Botao
          variante="primario"
          larguraTotal
          onClick={liberar}
          disabled={ocupado || codigo.trim().length < 8}
        >
          Liberar acesso
        </Botao>
      </div>

      <Botao
        variante="texto"
        larguraTotal
        onClick={() => {
          trocarPainel();
          navegar('/', { replace: true });
        }}
      >
        Escolher outro painel
      </Botao>
    </div>
  );
}
