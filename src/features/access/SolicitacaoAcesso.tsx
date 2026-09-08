import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { carregarPaineis, enderecoAplicacao } from '../../core/access/paineis';
import { codigoConfere, normalizarEmail } from '../../core/access/codigo';
import { AcessoRepository } from '../../core/db/repositorios';
import type { CatalogoPaineis, Painel } from '../../core/access/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeCheck } from '../../shared/componentes/Icones';

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Monta o link que o responsável abre para ver o código do pedido. */
function linkDeAprovacao(catalogo: CatalogoPaineis, email: string, painelId: string): string {
  const parametros = new URLSearchParams({ email: normalizarEmail(email), painel: painelId });
  return `${enderecoAplicacao(catalogo)}#/aprovar?${parametros.toString()}`;
}

/**
 * Porta de entrada do montador: ele se identifica, escolhe o painel e pede a
 * autorização do responsável. O acesso à montagem só abre depois que o
 * código devolvido pelo responsável é digitado aqui.
 */
export function SolicitacaoAcesso() {
  const navegar = useNavigate();
  const [catalogo, setCatalogo] = useState<CatalogoPaineis | null>(null);
  const [falhaCatalogo, setFalhaCatalogo] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [painelId, setPainelId] = useState('');
  const [pedidoEnviado, setPedidoEnviado] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    carregarPaineis()
      .then(setCatalogo)
      .catch((e: unknown) =>
        setFalhaCatalogo(e instanceof Error ? e.message : 'Falha ao ler o catálogo de painéis.'),
      );
  }, []);

  // Reabrir a tela com um pedido já feito para este montador retoma o passo
  // do código, em vez de exigir um novo pedido.
  useEffect(() => {
    AcessoRepository.sessaoAtual().then((sessao) => {
      if (!sessao) return;
      setEmail((atual) => atual || sessao.email);
      setPainelId((atual) => atual || sessao.painelId);
      setPedidoEnviado(true);
    });
  }, []);

  const paineis = useMemo(() => catalogo?.paineis.filter((p) => p.ativo) ?? [], [catalogo]);
  const painel: Painel | undefined = paineis.find((p) => p.id === painelId);
  const emailValido = EMAIL_VALIDO.test(email.trim());

  const solicitar = async () => {
    if (!emailValido) {
      setErro('Informe um e-mail válido.');
      return;
    }
    if (!painel || !catalogo) {
      setErro('Escolha o painel que você vai montar.');
      return;
    }
    setErro(null);
    setOcupado(true);
    try {
      const acesso = await AcessoRepository.registrarPedido({
        email,
        painelId: painel.id,
        painelNome: painel.nome,
        responsavelEmail: painel.responsavelEmail,
      });
      await AcessoRepository.definirSessao(email, painel.id);
      if (acesso.aprovadoEm) {
        navegar('/', { replace: true });
        return;
      }
      setPedidoEnviado(true);
      abrirEmail(catalogo, painel);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar o pedido.');
    } finally {
      setOcupado(false);
    }
  };

  /**
   * O e-mail leva apenas o link de aprovação. O código nunca vai no corpo:
   * quem envia a mensagem é o próprio montador, e ele não pode vê-lo.
   */
  const abrirEmail = (cat: CatalogoPaineis, alvo: Painel) => {
    const link = linkDeAprovacao(cat, email, alvo.id);
    const assunto = `Autorização de montagem — ${alvo.nome}`;
    const corpo = [
      `${alvo.responsavelNome ? `${alvo.responsavelNome},` : 'Prezado(a),'}`,
      '',
      `Solicito autorização para iniciar a montagem do painel ${alvo.nome}.`,
      '',
      `Montador: ${normalizarEmail(email)}`,
      `Painel: ${alvo.nome}`,
      `Data do pedido: ${new Date().toLocaleString('pt-BR')}`,
      '',
      'Para autorizar, abra o link abaixo e envie o código de aprovação exibido:',
      link,
      '',
      'Sem o código o acesso à montagem permanece bloqueado.',
    ].join('\n');
    window.location.href = `mailto:${encodeURIComponent(alvo.responsavelEmail)}?subject=${encodeURIComponent(
      assunto,
    )}&body=${encodeURIComponent(corpo)}`;
  };

  const liberar = async () => {
    if (!painel) return;
    setErro(null);
    setOcupado(true);
    try {
      if (!(await codigoConfere(email, painel.id, codigo))) {
        setErro('Código inválido para este e-mail e painel. Confira com o responsável.');
        return;
      }
      await AcessoRepository.registrarPedido({
        email,
        painelId: painel.id,
        painelNome: painel.nome,
        responsavelEmail: painel.responsavelEmail,
      });
      await AcessoRepository.aprovar(email, painel.id);
      await AcessoRepository.definirSessao(email, painel.id);
      navegar('/', { replace: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível liberar o acesso.');
    } finally {
      setOcupado(false);
    }
  };

  const trocarPedido = () => {
    setPedidoEnviado(false);
    setCodigo('');
    setErro(null);
    AcessoRepository.encerrarSessao();
  };

  if (falhaCatalogo) return <Erro titulo="Catálogo de painéis" detalhe={falhaCatalogo} />;
  if (!catalogo) return <Carregando mensagem="Carregando painéis…" />;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Acesso à montagem</h1>
        <p className="mt-1 text-base text-abb-gray">
          A montagem só abre depois que o responsável pelo painel aprovar o seu pedido.
        </p>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      {!pedidoEnviado ? (
        <div className="space-y-5 rounded-lg border border-abb-line bg-white p-4">
          <CampoTexto
            id="email-montador"
            rotulo="Seu e-mail"
            valor={email}
            onChange={setEmail}
            placeholder="montador@empresa.com.br"
            ajuda="Identifica você no pedido enviado ao responsável."
            obrigatorio
            autoFoco
          />

          <div>
            <p className="mb-1 text-base font-semibold">
              Painel que você vai montar<span className="text-abb-red"> *</span>
            </p>
            <div className="space-y-2">
              {paineis.map((p) => {
                const escolhido = p.id === painelId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPainelId(p.id)}
                    aria-pressed={escolhido}
                    className={[
                      'flex min-h-12 w-full items-center justify-between gap-3 rounded-md border-2 px-4 py-3 text-left',
                      escolhido
                        ? 'border-abb-red bg-red-50'
                        : 'border-abb-line bg-white hover:bg-neutral-50',
                    ].join(' ')}
                  >
                    <span>
                      <span className="block text-base font-semibold">{p.nome}</span>
                      <span className="block text-sm text-abb-gray">
                        Responsável: {p.responsavelEmail}
                      </span>
                    </span>
                    {escolhido ? <IconeCheck className="h-6 w-6 text-abb-red" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <Botao variante="primario" larguraTotal onClick={solicitar} disabled={ocupado}>
            Solicitar aprovação por e-mail
          </Botao>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border border-abb-line bg-white p-4">
          <div className="text-base">
            <p className="font-semibold">Pedido registrado</p>
            <p className="text-abb-gray">
              {normalizarEmail(email)} — {painel?.nome ?? painelId}
            </p>
          </div>

          <Aviso>
            O responsável ({painel?.responsavelEmail}) recebe o link de aprovação e devolve um
            código. Digite esse código abaixo para liberar a montagem neste aparelho.
          </Aviso>

          {painel ? (
            <div className="space-y-2">
              <Botao larguraTotal onClick={() => abrirEmail(catalogo, painel)}>
                Reenviar pedido por e-mail
              </Botao>
              <details className="text-sm text-abb-gray">
                <summary className="min-h-8 cursor-pointer">
                  O aplicativo de e-mail não abriu?
                </summary>
                <p className="mt-2 break-all">
                  Envie manualmente para <strong>{painel.responsavelEmail}</strong> este link:
                  <br />
                  {linkDeAprovacao(catalogo, email, painel.id)}
                </p>
              </details>
            </div>
          ) : null}

          <CampoTexto
            id="codigo-aprovacao"
            rotulo="Código de aprovação"
            valor={codigo}
            onChange={setCodigo}
            placeholder="XXXX-XXXX"
            ajuda="Informado pelo responsável depois de aprovar o pedido."
          />
          <Botao
            variante="primario"
            larguraTotal
            onClick={liberar}
            disabled={ocupado || codigo.trim().length < 8}
          >
            Liberar acesso à montagem
          </Botao>

          <Botao variante="texto" larguraTotal onClick={trocarPedido}>
            Trocar e-mail ou painel
          </Botao>
        </div>
      )}
    </div>
  );
}
