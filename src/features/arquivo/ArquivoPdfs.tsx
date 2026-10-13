import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  arquivoConfigurado,
  baixarPdfArquivado,
  buscarPdfs,
  enviarPendentes,
  SenhaIncorretaError,
  type FiltroArquivo,
  type PdfArquivado,
} from '../../core/arquivo/clienteArquivo';
import { EnvioRepository } from '../../core/db/repositorios';
import { Botao } from '../../shared/componentes/Botao';
import { CampoData, CampoTexto } from '../../shared/componentes/Campos';
import { Aviso, Carregando, Erro, Vazio } from '../../shared/componentes/Estado';
import { baixarBlob } from '../../shared/utils/download';
import { dataHoraEmissao, formatarBytes } from '../../shared/utils/texto';

// A senha é conferida pelo servidor a cada consulta; aqui ela só fica
// guardada enquanto a aba do navegador estiver aberta.
const CHAVE_SESSAO = 'arquivo-senha';

export function ArquivoPdfs() {
  const [senha, setSenha] = useState(() => sessionStorage.getItem(CHAVE_SESSAO) ?? '');
  const [liberado, setLiberado] = useState(() => sessionStorage.getItem(CHAVE_SESSAO) !== null);
  const [filtro, setFiltro] = useState<FiltroArquivo>({ nome: '', de: '', ate: '' });
  const [itens, setItens] = useState<PdfArquivado[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [baixando, setBaixando] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const pendentes = useLiveQuery(() => EnvioRepository.contar(), [], 0);

  const bloquear = (mensagem?: string) => {
    sessionStorage.removeItem(CHAVE_SESSAO);
    setLiberado(false);
    setItens(null);
    setErro(mensagem ?? null);
  };

  const buscar = async (senhaUsada = senha, filtroUsado = filtro) => {
    setBuscando(true);
    setErro(null);
    try {
      setItens(await buscarPdfs(senhaUsada, filtroUsado));
      sessionStorage.setItem(CHAVE_SESSAO, senhaUsada);
      setLiberado(true);
    } catch (e) {
      if (e instanceof SenhaIncorretaError) bloquear('Senha incorreta.');
      else setErro(e instanceof Error ? e.message : 'Falha na consulta ao arquivo.');
    } finally {
      setBuscando(false);
    }
  };

  // Ao reabrir a aba com a senha da sessão, já lista os PDFs mais recentes.
  useEffect(() => {
    if (liberado && arquivoConfigurado()) void buscar();
    // Executa só na montagem.
  }, []);

  const baixar = async (pdf: PdfArquivado) => {
    setBaixando(pdf.id);
    setErro(null);
    try {
      baixarBlob(await baixarPdfArquivado(senha, pdf), pdf.nomeArquivo);
    } catch (e) {
      if (e instanceof SenhaIncorretaError) bloquear('Senha incorreta.');
      else setErro(e instanceof Error ? e.message : 'Falha ao baixar o PDF.');
    } finally {
      setBaixando(null);
    }
  };

  if (!arquivoConfigurado()) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Arquivo de PDFs</h1>
        <Aviso>
          O endereço do arquivo central não foi configurado nesta publicação. Gere o
          aplicativo com <code>VITE_URL_ARQUIVO</code> apontando para o servidor{' '}
          <code>cmd/arquivo</code>.
        </Aviso>
      </div>
    );
  }

  const avisoPendentes =
    pendentes > 0 ? (
      <Aviso>
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Este aparelho tem <strong>{pendentes}</strong> PDF{pendentes === 1 ? '' : 's'}{' '}
            aguardando envio ao arquivo central.
          </span>
          <Botao
            disabled={enviando}
            onClick={async () => {
              setEnviando(true);
              await enviarPendentes();
              setEnviando(false);
            }}
          >
            {enviando ? 'Enviando…' : 'Enviar agora'}
          </Botao>
        </span>
      </Aviso>
    ) : null;

  if (!liberado) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Arquivo de PDFs</h1>
        <p className="text-base text-abb-gray">
          Consulta dos checklists emitidos, usados como documentação de garantia.
          Informe a senha de administração para continuar.
        </p>
        {avisoPendentes}
        <CampoTexto rotulo="Senha" senha valor={senha} onChange={setSenha} autoFoco />
        {erro ? <Erro detalhe={erro} /> : null}
        <Botao
          variante="primario"
          larguraTotal
          disabled={buscando || !senha}
          onClick={() => void buscar()}
        >
          {buscando ? 'Verificando…' : 'Entrar'}
        </Botao>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Arquivo de PDFs</h1>
        <Botao
          onClick={() => {
            setSenha('');
            bloquear();
          }}
        >
          Bloquear
        </Botao>
      </div>

      {avisoPendentes}

      <form
        className="space-y-3 rounded-lg border border-abb-line bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void buscar();
        }}
      >
        <CampoTexto
          rotulo="Empresa ou projeto"
          valor={filtro.nome ?? ''}
          placeholder="Ex.: Elétrica São João"
          onChange={(nome) => setFiltro((f) => ({ ...f, nome }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoData
            rotulo="Emitido de"
            valor={filtro.de ?? ''}
            onChange={(de) => setFiltro((f) => ({ ...f, de }))}
          />
          <CampoData
            rotulo="Emitido até"
            valor={filtro.ate ?? ''}
            onChange={(ate) => setFiltro((f) => ({ ...f, ate }))}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Botao type="submit" variante="primario" disabled={buscando}>
            {buscando ? 'Buscando…' : 'Buscar'}
          </Botao>
          <Botao
            onClick={() => {
              const limpo = { nome: '', de: '', ate: '' };
              setFiltro(limpo);
              void buscar(senha, limpo);
            }}
          >
            Limpar filtros
          </Botao>
        </div>
      </form>

      {erro ? <Erro detalhe={erro} /> : null}

      {itens === null ? (
        buscando ? (
          <Carregando mensagem="Consultando o arquivo…" />
        ) : null
      ) : itens.length === 0 ? (
        <Vazio titulo="Nenhum PDF encontrado">Ajuste o nome ou o período da busca.</Vazio>
      ) : (
        <ul className="space-y-3">
          {itens.map((pdf) => (
            <li
              key={pdf.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-abb-line bg-white p-4"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-bold break-words">{pdf.empresa}</span>
                <span className="block text-base break-words">{pdf.projeto}</span>
                <span className="block text-sm text-abb-gray">
                  {pdf.tipo} • emitido em {dataHoraEmissao(new Date(pdf.emitidoEm))}
                </span>
                <span className="block text-sm break-all text-abb-gray">
                  {pdf.nomeArquivo} • {formatarBytes(pdf.tamanho)}
                </span>
              </span>
              <Botao disabled={baixando === pdf.id} onClick={() => void baixar(pdf)}>
                {baixando === pdf.id ? 'Baixando…' : 'Baixar'}
              </Botao>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
