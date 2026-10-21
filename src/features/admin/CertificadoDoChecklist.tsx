import { useRef, useState } from 'react';
import type { DefinicaoFormulario } from '../../../compartilhado/formulario';
import { api, consulta } from '../../core/api/cliente';
import { novoUid } from '../../core/db/db';
import { Botao } from '../../shared/componentes/Botao';
import { Aviso } from '../../shared/componentes/Estado';
import { baixarBlob } from '../../shared/utils/download';
import { sha256Hex } from '../../shared/utils/hash';
import { formatarBytes } from '../../shared/utils/texto';

const TAMANHO_MAXIMO = 25 * 1024 * 1024;

type Modelo = NonNullable<DefinicaoFormulario['modeloCertificado']>;

interface Props {
  definicao: DefinicaoFormulario;
  /**
   * Aplica a mudança sobre a definição mais recente: o envio do modelo leva
   * alguns segundos, e a pessoa pode ter mexido em outra coisa nesse meio-tempo.
   */
  onAlterar: (mudanca: Partial<DefinicaoFormulario>) => void;
}

const opcao =
  'flex min-h-12 cursor-pointer items-center gap-2 rounded-md border px-3 text-base font-semibold';

/**
 * "Contém certificado?" no construtor do checklist. Sim: o checklist é
 * preenchido na TAG do projeto e, terminado, o PDF vai para a aba
 * Certificados; aprovado, o certificado sai do modelo em PDF enviado aqui,
 * com um código único em todas as páginas.
 */
export function CertificadoDoChecklist({ definicao, onAlterar }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const modelo = definicao.modeloCertificado;
  const sim = definicao.emiteCertificado;

  const enviar = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setErro(null);
    if (arquivo.type !== 'application/pdf' && !arquivo.name.toLowerCase().endsWith('.pdf')) {
      setErro('O modelo do certificado deve ser um PDF.');
      return;
    }
    if (arquivo.size > TAMANHO_MAXIMO) {
      setErro('PDF grande demais (máximo 25 MB).');
      return;
    }
    setEnviando(true);
    try {
      const uid = novoUid();
      const corpo = arquivo.type === 'application/pdf' ? arquivo : new Blob([arquivo], { type: 'application/pdf' });
      const { modelo: novo } = await api.enviarArquivo<{ modelo: Modelo & { sha256: string } }>(
        `/api/admin/modelos-certificado/${uid}${consulta({ nomeArquivo: arquivo.name, sha256: await sha256Hex(arquivo) })}`,
        corpo,
      );
      onAlterar({
        modeloCertificado: { uid: novo.uid, nomeArquivo: novo.nomeArquivo, tamanho: novo.tamanho, paginas: novo.paginas },
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar o modelo.');
    } finally {
      setEnviando(false);
    }
  };

  const verModelo = async () => {
    if (!modelo) return;
    setErro(null);
    try {
      baixarBlob(await api.baixarArquivo(`/api/admin/modelos-certificado/${modelo.uid}`), modelo.nomeArquivo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir o modelo.');
    }
  };

  return (
    <fieldset className="space-y-3 rounded-lg border border-abb-line bg-white p-3">
      <legend className="px-1 text-base font-bold">Contém certificado?</legend>
      <div className="flex flex-wrap gap-2">
        <label className={`${opcao} ${sim ? 'border-abb-red bg-red-50' : 'border-abb-line-botao bg-abb-offwhite'}`}>
          <input
            type="radio"
            name={`certificado-${definicao.id}`}
            className="size-5 accent-abb-red"
            checked={sim}
            disabled={enviando}
            onChange={() => onAlterar({ emiteCertificado: true })}
          />
          Sim
        </label>
        <label className={`${opcao} ${!sim ? 'border-abb-black bg-neutral-100' : 'border-abb-line-botao bg-abb-offwhite'}`}>
          <input
            type="radio"
            name={`certificado-${definicao.id}`}
            className="size-5 accent-abb-red"
            checked={!sim}
            disabled={enviando}
            onChange={() => onAlterar({ emiteCertificado: false })}
          />
          Não
        </label>
      </div>
      <p className="text-sm text-abb-gray">
        {sim
          ? 'O montador preenche este checklist na TAG do projeto. Com todas as etapas respondidas, ao gerar o PDF do checklist ele vai para Administração → Certificados. Aprovado, o certificado é emitido a partir do modelo abaixo, com um código único em todas as páginas.'
          : 'Verificação comum: o checklist entra no PDF do projeto, aprovado na aba Aprovações.'}
      </p>

      {sim ? (
        <div className="space-y-2">
          {modelo ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-600 bg-green-50 p-3">
              <p className="min-w-0 text-base">
                <span className="block font-semibold break-all">Modelo: {modelo.nomeArquivo}</span>
                <span className="text-sm text-abb-gray">
                  {modelo.paginas ? `${modelo.paginas} página(s)` : ''}
                  {modelo.paginas && modelo.tamanho ? ' · ' : ''}
                  {modelo.tamanho ? formatarBytes(modelo.tamanho) : ''}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Botao tamanho="compacto" onClick={() => void verModelo()}>
                  Ver modelo
                </Botao>
                <Botao tamanho="compacto" disabled={enviando} onClick={() => entrada.current?.click()}>
                  {enviando ? 'Enviando…' : 'Trocar modelo'}
                </Botao>
              </div>
            </div>
          ) : (
            <Aviso>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Adicione o certificado: envie o modelo em PDF. Sem ele, o montador não consegue pedir o
                  certificado deste checklist.
                </span>
                <Botao variante="primario" tamanho="compacto" disabled={enviando} onClick={() => entrada.current?.click()}>
                  {enviando ? 'Enviando…' : 'Adicionar certificado (PDF)'}
                </Botao>
              </span>
            </Aviso>
          )}
          <input
            ref={entrada}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            aria-label="Modelo do certificado em PDF"
            onChange={(e) => {
              void enviar(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {erro ? (
            <p className="text-sm font-semibold text-abb-red" role="alert">
              {erro}
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
