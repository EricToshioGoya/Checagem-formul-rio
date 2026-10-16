import { useEffect, useState } from 'react';
import { formulariosDoPainel } from '../../core/forms/catalogo';
import { progressoDoProjeto } from '../../core/forms/progressoProjeto';
import type { EntradaCatalogo } from '../../core/forms/tipos';
import { baixarBlob } from '../../shared/utils/download';
import { Botao } from '../../shared/componentes/Botao';
import { Modal } from '../../shared/componentes/Modal';
import { Aviso, Erro } from '../../shared/componentes/Estado';
import { useSessao } from '../../core/api/SessaoContexto';
import { registrarPdfs } from '../../core/sync/arquivoPdfs';
import { atualizarDecisoes } from '../../core/aprovacao/decisoes';
import { ArquivosGerados, EscolhaFotos, type EstadoRegistro } from './PartesDialogoPdf';

interface Props {
  aberto: boolean;
  projetoId: number;
  /** Painel do projeto: limita o PDF aos checklists daquela linha. */
  painelSlug?: string;
  /** Tipo de verificação a pré-selecionar (reenvio de uma reprovada); ausente, todos. */
  tipo?: string;
  onFechar: () => void;
}

export function DialogoGerarPdf({ aberto, projetoId, painelSlug, tipo, onFechar }: Props) {
  const [entradas, setEntradas] = useState<EntradaCatalogo[]>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [incluirFotos, setIncluirFotos] = useState(true);
  const [pendentes, setPendentes] = useState<number | null>(null);
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
    (async () => {
      try {
        const lista = await formulariosDoPainel(painelSlug);
        setEntradas(lista);
        const doTipo = lista.filter((e) => e.tipo === tipo);
        setSelecionados((doTipo.length ? doTipo : lista).map((e) => e.id));
        setPendentes(
          (await progressoDoProjeto(projetoId, painelSlug)).progresso.pendentes,
        );
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Falha ao preparar a geração.');
      }
    })();
  }, [aberto, projetoId, painelSlug, tipo]);

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    try {
      const { gerarArquivos } = await import('../../core/export/PdfExport');
      const arquivos = await gerarArquivos(projetoId, {
        formIds: selecionados,
        incluirFotos,
      });
      if (!arquivos.length) {
        setErro('Nenhum formulário selecionado.');
        return;
      }
      for (const arquivo of arquivos) baixarBlob(arquivo.blob, arquivo.nome);
      setConcluido(arquivos.map((a) => a.nome));
      // Todo PDF emitido vai para o arquivo do servidor (documentação de
      // garantia) e, o do projeto, para a aprovação da administração. Sem
      // rede, fica na fila do aparelho e segue depois.
      if (usuario) {
        setRegistro(null);
        setRegistro(await registrarPdfs(usuario.id, arquivos, projetoId));
        // A versão reenviada passa a "aguardando": o alerta de correção some.
        void atualizarDecisoes(usuario.id);
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
          <Botao variante="primario" onClick={gerar} disabled={gerando || !selecionados.length}>
            {gerando ? 'Gerando…' : 'Gerar e baixar'}
          </Botao>
        </>
      }
    >
      <div className="space-y-4">
        {pendentes !== null && pendentes > 0 ? (
          <Aviso>
            Há <strong>{pendentes}</strong> etapa{pendentes === 1 ? '' : 's'} sem resposta.
            O PDF será gerado assim mesmo, com essas etapas sinalizadas como{' '}
            <strong>“Não verificado”</strong>.
          </Aviso>
        ) : null}

        <fieldset>
          <legend className="mb-2 text-base font-bold">Formulários</legend>
          <div className="space-y-2">
            {entradas.map((e) => (
              <label
                key={e.id}
                className="flex min-h-12 items-center gap-3 rounded-md border border-abb-line-botao bg-abb-offwhite px-3 hover:bg-abb-offwhite-hover"
              >
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={selecionados.includes(e.id)}
                  onChange={(ev) =>
                    setSelecionados((atual) =>
                      ev.target.checked
                        ? [...atual, e.id]
                        : atual.filter((id) => id !== e.id),
                    )
                  }
                />
                <span className="text-base">{e.nome}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <EscolhaFotos incluirFotos={incluirFotos} onChange={setIncluirFotos} />

        {erro ? <Erro detalhe={erro} /> : null}
        {concluido ? <ArquivosGerados nomes={concluido} registro={registro} /> : null}
      </div>
    </Modal>
  );
}
