import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ServidorIndisponivel } from '../../core/acesso/api';
import { dominioDoEmail, dominioPermitido } from '../../core/paineis/permissoes';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Aviso, Erro } from '../../shared/componentes/Estado';
import { useLiberacao } from './LiberacaoAtiva';
import { usePainelAtivo } from './PainelAtivo';

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Porta de entrada dos painéis que exigem liberação.
 *
 * O montador informa nome e e-mail; o pedido vai para a fila do servidor e a
 * tela fica travada até a administração decidir. Nada do fluxo abre antes
 * disso — é a única trava que não depende do aparelho de quem preenche.
 */
export function Liberacao() {
  const navegar = useNavigate();
  const { painel, permissao, identificacao, identificar } = usePainelAtivo();
  const { situacao, sessao, semServidor, consultando, pedir, revalidar, desistir } =
    useLiberacao();
  const [nome, setNome] = useState(identificacao?.nome ?? '');
  const [email, setEmail] = useState(identificacao?.email ?? '');
  const [empresa, setEmpresa] = useState(identificacao?.empresa ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!painel) return <Erro detalhe="Escolha um painel antes de pedir liberação." />;

  const destino =
    painel.fluxo === 'certificacao'
      ? `/paineis/${painel.id}/solicitacoes`
      : `/paineis/${painel.id}/projetos`;

  const enviar = async () => {
    const limpo = email.trim().toLowerCase();
    if (!nome.trim()) {
      setErro('Informe o seu nome.');
      return;
    }
    if (!FORMATO_EMAIL.test(limpo)) {
      setErro('Informe um e-mail válido.');
      return;
    }
    if (!dominioPermitido(limpo, permissao)) {
      setErro(
        permissao.aviso?.trim() ||
          `O painel ${painel.nome} está liberado apenas para as empresas parceiras cadastradas. ` +
            `O domínio ${dominioDoEmail(limpo)} não está na lista — fale com o responsável ABB.`,
      );
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      // A identificação fica gravada junto: liberado o acesso, o montador não
      // precisa informar quem é outra vez.
      identificar({ nome: nome.trim(), email: limpo, empresa: empresa.trim() });
      await pedir(limpo);
    } catch (e) {
      setErro(
        e instanceof ServidorIndisponivel
          ? `${e.message} Sem ele não há como pedir liberação — verifique a rede ou fale com o responsável ABB.`
          : e instanceof Error
            ? e.message
            : 'Não foi possível enviar o pedido.',
      );
    } finally {
      setEnviando(false);
    }
  };

  if (situacao === 'sem-pedido') {
    return (
      <div className="mx-auto max-w-md space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Pedir acesso ao painel {painel.nome}</h1>
          <p className="mt-1 text-base text-abb-gray">
            Informe quem vai preencher. O responsável ABB precisa liberar antes do
            primeiro preenchimento.
          </p>
        </div>

        {erro ? <Erro titulo="Não foi possível pedir o acesso" detalhe={erro} /> : null}

        <div className="space-y-4 rounded-lg border border-abb-line bg-white p-4">
          <CampoTexto rotulo="Nome" valor={nome} onChange={setNome} obrigatorio autoFoco />
          <CampoTexto
            rotulo="E-mail da empresa"
            formato="email"
            valor={email}
            onChange={setEmail}
            placeholder="nome@empresa.com.br"
            obrigatorio
            ajuda={
              permissao.dominios.length
                ? `Empresas liberadas neste painel: ${permissao.dominios.join(', ')}.`
                : undefined
            }
          />
          <CampoTexto rotulo="Empresa" valor={empresa} onChange={setEmpresa} />
          <Botao
            variante="primario"
            larguraTotal
            onClick={() => void enviar()}
            disabled={enviando}
          >
            {enviando ? 'Enviando o pedido…' : 'Pedir liberação'}
          </Botao>
        </div>

        <Botao larguraTotal onClick={() => navegar('/')}>
          Escolher outro tipo de painel
        </Botao>
      </div>
    );
  }

  const negado = situacao === 'negado';
  const liberado = situacao === 'liberado';

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="rounded-lg border border-abb-line bg-white p-5 text-center">
        <div
          aria-hidden
          className={[
            'mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl',
            negado ? 'bg-red-50 text-abb-red' : 'bg-neutral-100 text-abb-gray',
          ].join(' ')}
        >
          {negado ? '✕' : liberado ? '✓' : '⏳'}
        </div>
        <h1 className="text-2xl font-bold">
          {negado
            ? 'Acesso não liberado'
            : liberado
              ? 'Acesso liberado'
              : 'Aguardando liberação'}
        </h1>
        <p className="mt-2 text-base text-abb-gray">
          {negado
            ? 'O responsável ABB não liberou este pedido.'
            : liberado
              ? 'Pode seguir para o preenchimento.'
              : 'O responsável ABB precisa liberar o seu acesso. Esta tela se atualiza sozinha.'}
        </p>

        {sessao ? (
          <dl className="mt-4 space-y-1 text-left text-base">
            <div className="flex justify-between gap-3 border-t border-abb-line pt-2">
              <dt className="text-abb-gray">E-mail</dt>
              <dd className="font-semibold break-all">{sessao.email}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-abb-line pt-2">
              <dt className="text-abb-gray">Painel</dt>
              <dd className="font-semibold">{sessao.painelNome}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-abb-line pt-2">
              <dt className="text-abb-gray">Protocolo</dt>
              <dd className="font-mono text-sm">{sessao.id}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      {sessao?.observacao ? <Aviso>Recado da ABB: {sessao.observacao}</Aviso> : null}

      {semServidor ? (
        <Erro
          titulo="Sem conexão com o servidor"
          detalhe="A liberação é consultada no servidor. Verifique a rede — a tela volta a tentar sozinha."
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {liberado ? (
          <Botao variante="primario" onClick={() => navegar(destino, { replace: true })}>
            Entrar no painel
          </Botao>
        ) : (
          <Botao variante="primario" onClick={() => void revalidar()} disabled={consultando}>
            {consultando ? 'Consultando…' : 'Verificar agora'}
          </Botao>
        )}
        <Botao onClick={desistir}>{negado ? 'Fazer outro pedido' : 'Trocar o e-mail'}</Botao>
        <Botao variante="texto" onClick={() => navegar('/')}>
          Escolher outro painel
        </Botao>
      </div>
    </div>
  );
}
