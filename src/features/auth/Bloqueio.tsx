/**
 * Tela de entrada do aplicativo.
 *
 * O montador informa quem é e qual painel vai verificar; o responsável por
 * aquele painel recebe o pedido por e-mail e decide. Enquanto isso, esta
 * tela fica consultando o servidor, para que a liberação apareça sozinha
 * assim que o responsável clicar em aprovar.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AutorizacaoApi, ErroApi } from '../../core/auth/api';
import { useAutorizacao } from '../../core/auth/contexto';
import type { PainelPublico, StatusSolicitacao } from '../../core/auth/tipos';
import { NOME_APLICACAO } from '../../core/config';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';

/** Intervalo entre consultas enquanto a aprovação não sai. */
const INTERVALO_CONSULTA_MS = 5000;

interface Pendente {
  id: string;
  email: string;
  painelNome: string;
  emailResponsavel: string;
  status: StatusSolicitacao;
}

const CHAVE_PENDENTE = 'solicitacao-pendente';

/** Lê a solicitação em andamento, para que fechar o aplicativo não a perca. */
function lerPendente(): Pendente | null {
  try {
    const bruto = localStorage.getItem(CHAVE_PENDENTE);
    return bruto ? (JSON.parse(bruto) as Pendente) : null;
  } catch {
    return null;
  }
}

function gravarPendente(pendente: Pendente | null) {
  try {
    if (pendente) localStorage.setItem(CHAVE_PENDENTE, JSON.stringify(pendente));
    else localStorage.removeItem(CHAVE_PENDENTE);
  } catch {
    // Armazenamento indisponível (janela anônima): a solicitação continua
    // válida no servidor, só não sobrevive a fechar o aplicativo.
  }
}

export function Bloqueio() {
  const { entrar, deviceId, motivoSaida } = useAutorizacao();
  const idPainel = useId();

  const [paineis, setPaineis] = useState<PainelPublico[] | null>(null);
  const [painelId, setPainelId] = useState('');
  const [email, setEmail] = useState('');
  const [descricao, setDescricao] = useState('');

  const [pendente, setPendente] = useState<Pendente | null>(lerPendente);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    AutorizacaoApi.paineis()
      .then(setPaineis)
      .catch((e: unknown) => {
        setPaineis([]);
        setErro(e instanceof Error ? e.message : 'Não foi possível listar os painéis.');
      });
  }, []);

  const guardar = useCallback((novo: Pendente | null) => {
    setPendente(novo);
    gravarPendente(novo);
  }, []);

  const enviar = async () => {
    setErro(null);
    setAviso(null);

    if (!email.trim() || !painelId) {
      setErro('Informe o seu e-mail e escolha o painel.');
      return;
    }

    setEnviando(true);
    try {
      const resultado = await AutorizacaoApi.solicitar({
        email: email.trim(),
        painelId,
        deviceId,
        descricao: descricao.trim(),
      });

      // Quem já tinha acesso neste aparelho entra na hora, sem incomodar
      // o responsável de novo.
      if (resultado.credencial) {
        await entrar(resultado.credencial);
        return;
      }

      guardar({
        id: resultado.id,
        email: email.trim(),
        painelNome: paineis?.find((p) => p.id === painelId)?.nome ?? painelId,
        emailResponsavel: resultado.emailResponsavel,
        status: resultado.status,
      });
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar a solicitação.');
    } finally {
      setEnviando(false);
    }
  };

  if (pendente) {
    return (
      <Espera
        pendente={pendente}
        deviceId={deviceId}
        onLiberado={entrar}
        onAtualizar={guardar}
        onRecomecar={() => {
          guardar(null);
          setAviso(null);
          setErro(null);
        }}
      />
    );
  }

  return (
    <Moldura titulo="Acesso ao sistema">
      <p className="text-base text-abb-gray">
        Informe o seu e-mail e o painel que vai verificar. O responsável por
        esse painel recebe a solicitação e libera o acesso.
      </p>

      {motivoSaida ? <Aviso>{motivoSaida}</Aviso> : null}
      {aviso ? <Aviso>{aviso}</Aviso> : null}

      <CampoTexto
        rotulo="Seu e-mail"
        valor={email}
        onChange={setEmail}
        placeholder="nome@empresa.com.br"
        obrigatorio
        autoFoco
      />

      <div>
        <label htmlFor={idPainel} className="mb-1 block text-base font-semibold">
          Painel
          <span className="text-abb-red"> *</span>
        </label>
        <select
          id={idPainel}
          className="min-h-12 w-full rounded-md border border-abb-line bg-white px-3 text-base text-abb-black focus:border-abb-red"
          value={painelId}
          onChange={(e) => setPainelId(e.target.value)}
          disabled={!paineis?.length}
        >
          <option value="">— selecione —</option>
          {paineis?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </div>

      <CampoTexto
        rotulo="Observação para o responsável"
        ajuda="Opcional. Ajuda quem aprova a reconhecer o seu pedido."
        valor={descricao}
        onChange={setDescricao}
        placeholder="Ex.: montagem do quadro QGBT-02, obra Santo André"
        multilinha
      />

      {erro ? <Erro detalhe={erro} /> : null}

      <Botao variante="primario" larguraTotal onClick={() => void enviar()} disabled={enviando}>
        {enviando ? 'Enviando…' : 'Enviar solicitação'}
      </Botao>
    </Moldura>
  );
}

interface EsperaProps {
  pendente: Pendente;
  deviceId: string;
  onLiberado: (credencial: string) => Promise<void>;
  onAtualizar: (pendente: Pendente) => void;
  onRecomecar: () => void;
}

/** Tela de espera: consulta o servidor até o responsável decidir. */
function Espera({ pendente, deviceId, onLiberado, onAtualizar, onRecomecar }: EsperaProps) {
  const [erro, setErro] = useState<string | null>(null);
  const [consultandoAgora, setConsultandoAgora] = useState(false);

  // As dependências do efeito precisam ser estáveis para não reiniciar o
  // temporizador a cada render.
  const acoes = useRef({ onLiberado, onAtualizar });
  acoes.current = { onLiberado, onAtualizar };

  const consultar = useCallback(
    async (manual: boolean) => {
      if (manual) {
        setConsultandoAgora(true);
        setErro(null);
      }
      try {
        const resultado = await AutorizacaoApi.consultar(pendente.id, deviceId);
        if (resultado.credencial) {
          await acoes.current.onLiberado(resultado.credencial);
          gravarPendente(null);
          return;
        }
        if (resultado.status !== pendente.status || resultado.revogada) {
          acoes.current.onAtualizar({ ...pendente, status: resultado.status });
        }
      } catch (e: unknown) {
        // Sem rede a consulta apenas não avança; só vale avisar quando o
        // usuário pediu explicitamente.
        if (manual) {
          setErro(e instanceof ErroApi ? e.message : 'Não foi possível consultar agora.');
        }
      } finally {
        if (manual) setConsultandoAgora(false);
      }
    },
    [pendente, deviceId],
  );

  useEffect(() => {
    if (pendente.status !== 'pendente') return;

    void consultar(false);
    const temporizador = setInterval(() => void consultar(false), INTERVALO_CONSULTA_MS);
    return () => clearInterval(temporizador);
  }, [pendente.status, consultar]);

  if (pendente.status === 'negada') {
    return (
      <Moldura titulo="Acesso negado">
        <p className="text-base">
          O responsável pelo painel <b>{pendente.painelNome}</b> não autorizou este pedido.
        </p>
        <p className="text-base text-abb-gray">
          Fale com {pendente.emailResponsavel} antes de solicitar de novo.
        </p>
        <Botao variante="secundario" larguraTotal onClick={onRecomecar}>
          Fazer outra solicitação
        </Botao>
      </Moldura>
    );
  }

  return (
    <Moldura titulo="Aguardando aprovação">
      <div className="rounded-lg border border-abb-line bg-white p-4">
        <Carregando mensagem="Esperando a decisão do responsável…" />
      </div>

      <dl className="space-y-2 text-base">
        <Linha rotulo="Solicitante" valor={pendente.email} />
        <Linha rotulo="Painel" valor={pendente.painelNome} />
        <Linha rotulo="Responsável" valor={pendente.emailResponsavel} />
      </dl>

      <p className="text-base text-abb-gray">
        Um e-mail foi enviado ao responsável. Assim que ele aprovar, esta tela
        libera sozinha — mantenha o aplicativo aberto e com internet.
      </p>

      {erro ? <Erro detalhe={erro} /> : null}

      <div className="space-y-2">
        <Botao
          variante="primario"
          larguraTotal
          onClick={() => void consultar(true)}
          disabled={consultandoAgora}
        >
          {consultandoAgora ? 'Verificando…' : 'Já fui aprovado'}
        </Botao>
        <Botao variante="texto" larguraTotal onClick={onRecomecar}>
          Cancelar e corrigir os dados
        </Botao>
      </div>
    </Moldura>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-abb-gray">{rotulo}:</dt>
      <dd className="font-semibold break-all">{valor}</dd>
    </div>
  );
}

function Moldura({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="bg-abb-red text-white shadow-md">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <span className="text-xl font-black tracking-tight">ABB</span>
          <span className="text-base font-semibold">{NOME_APLICACAO}</span>
        </div>
      </header>
      <main className="mx-auto max-w-md space-y-4 px-4 py-6">
        <h1 className="text-2xl font-bold">{titulo}</h1>
        {children}
      </main>
    </div>
  );
}
