import { useEffect, useState } from 'react';
import { formulariosDoPainel } from '../../core/forms/catalogo';
import { progressoDoProjeto } from '../../core/forms/progressoProjeto';
import { ProjetoRepository } from '../../core/db/repositorios';
import type { EntradaCatalogo } from '../../core/forms/tipos';
import { baixarBlob } from '../../shared/utils/download';
import { Botao } from '../../shared/componentes/Botao';
import { Modal } from '../../shared/componentes/Modal';
import { Aviso, Erro } from '../../shared/componentes/Estado';

interface Props {
  aberto: boolean;
  projetoId: number;
  onFechar: () => void;
}

export function DialogoGerarPdf({ aberto, projetoId, onFechar }: Props) {
  const [entradas, setEntradas] = useState<EntradaCatalogo[]>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [incluirFotos, setIncluirFotos] = useState(true);
  const [pendentes, setPendentes] = useState<number | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState<string[] | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setConcluido(null);
    (async () => {
      try {
        const projeto = await ProjetoRepository.obter(projetoId);
        const lista = await formulariosDoPainel(projeto?.painel);
        setEntradas(lista);
        setSelecionados(lista.map((e) => e.id));
        setPendentes((await progressoDoProjeto(projetoId)).progresso.pendentes);
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Falha ao preparar a geração.');
      }
    })();
  }, [aberto, projetoId]);

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
            O PDF será gerado assim mesmo e essas etapas sairão como{' '}
            <strong>“Não verificado”</strong>.
          </Aviso>
        ) : null}

        <fieldset>
          <legend className="mb-2 text-base font-bold">Formulários</legend>
          <div className="space-y-2">
            {entradas.map((e) => (
              <label
                key={e.id}
                className="flex min-h-12 items-center gap-3 rounded-md border border-abb-line bg-white px-3"
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

        <fieldset>
          <legend className="mb-2 text-base font-bold">Fotos</legend>
          <div className="space-y-2">
            <label className="flex min-h-12 items-center gap-3 rounded-md border border-abb-line bg-white px-3">
              <input
                type="radio"
                name="fotos"
                className="h-6 w-6"
                checked={incluirFotos}
                onChange={() => setIncluirFotos(true)}
              />
              <span className="text-base">Fotos incorporadas ao PDF</span>
            </label>
            <label className="flex min-h-12 items-center gap-3 rounded-md border border-abb-line bg-white px-3">
              <input
                type="radio"
                name="fotos"
                className="h-6 w-6"
                checked={!incluirFotos}
                onChange={() => setIncluirFotos(false)}
              />
              <span className="text-base">
                PDF sem fotos + arquivo ZIP separado com as imagens
              </span>
            </label>
          </div>
        </fieldset>

        {erro ? <Erro detalhe={erro} /> : null}

        {concluido ? (
          <div className="rounded-md border border-green-600 bg-green-50 p-3 text-base">
            <p className="font-bold text-green-800">Arquivos gerados:</p>
            <ul className="mt-1 list-disc pl-5">
              {concluido.map((n) => (
                <li key={n} className="break-all">
                  {n}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-abb-gray">
              Envie o PDF por e-mail ao inspetor da ABB.
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
