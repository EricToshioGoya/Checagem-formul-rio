import { useRef, useState } from 'react';
import { Botao } from '../../shared/componentes/Botao';
import { IconeFechar, IconeMais } from '../../shared/componentes/Icones';

interface Props {
  /** Opções gravadas na etapa. Só a lista inicial é lida: ver `EditorOpcoes`. */
  opcoes: string[];
  /** Recebe a lista sem linhas vazias e sem espaços nas pontas. */
  onChange: (opcoes: string[]) => void;
}

interface Linha {
  chave: number;
  texto: string;
}

const campo =
  'min-h-10 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-base ' +
  'text-abb-black hover:border-abb-line focus:border-abb-red focus:bg-white';

/**
 * Editor das alternativas de uma etapa de escolha, no estilo do Google Forms:
 * uma linha por alternativa, "Adicionar opção" no fim, remover e reordenar
 * por linha.
 *
 * Mantém as linhas em estado próprio, inclusive as ainda vazias — uma linha
 * recém-criada não pode sumir só porque ainda não tem texto. Só a lista limpa
 * sobe para a etapa. Por isso o pai deve montá-lo com `key` da etapa: trocar
 * de etapa recomeça a partir das opções dela.
 */
export function EditorOpcoes({ opcoes, onChange }: Props) {
  const proxima = useRef(0);
  const novaChave = () => proxima.current++;
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    (opcoes.length ? opcoes : ['']).map((texto) => ({ chave: novaChave(), texto })),
  );
  const campos = useRef(new Map<number, HTMLInputElement>());
  const focar = useRef<number | null>(null);

  const aplicar = (novas: Linha[]) => {
    setLinhas(novas);
    onChange(novas.map((l) => l.texto.trim()).filter(Boolean));
  };

  const inserirApos = (indice: number) => {
    const nova = { chave: novaChave(), texto: '' };
    focar.current = nova.chave;
    aplicar([...linhas.slice(0, indice + 1), nova, ...linhas.slice(indice + 1)]);
  };

  const remover = (indice: number) => {
    if (linhas.length === 1) {
      aplicar([{ ...linhas[0], texto: '' }]);
      return;
    }
    const alvo = linhas[Math.max(0, indice - 1)];
    focar.current = indice > 0 ? alvo.chave : linhas[1].chave;
    aplicar(linhas.filter((_, i) => i !== indice));
  };

  const mover = (indice: number, passo: -1 | 1) => {
    const destino = indice + passo;
    if (destino < 0 || destino >= linhas.length) return;
    const novas = [...linhas];
    [novas[indice], novas[destino]] = [novas[destino], novas[indice]];
    aplicar(novas);
  };

  const normalizadas = linhas.map((l) => l.texto.trim().toLowerCase());
  const repetida = (indice: number) =>
    normalizadas[indice] !== '' && normalizadas.indexOf(normalizadas[indice]) !== indice;

  return (
    <fieldset>
      <legend className="mb-1 text-base font-semibold">Opções de resposta</legend>
      <ul className="space-y-1">
        {linhas.map((linha, i) => (
          <li key={linha.chave}>
            <div className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="ml-1 h-5 w-5 shrink-0 rounded-full border-2 border-abb-gray"
              />
              <input
                ref={(el) => {
                  if (el) {
                    campos.current.set(linha.chave, el);
                    if (focar.current === linha.chave) {
                      focar.current = null;
                      el.focus();
                    }
                  } else {
                    campos.current.delete(linha.chave);
                  }
                }}
                aria-label={`Opção ${i + 1}`}
                aria-invalid={repetida(i) || undefined}
                placeholder={`Opção ${i + 1}`}
                className={campo}
                value={linha.texto}
                onChange={(e) =>
                  aplicar(linhas.map((l, j) => (j === i ? { ...l, texto: e.target.value } : l)))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    inserirApos(i);
                  } else if (e.key === 'Backspace' && linha.texto === '' && linhas.length > 1) {
                    e.preventDefault();
                    remover(i);
                  }
                }}
              />
              <Botao
                variante="texto"
                tamanho="compacto"
                className="px-2"
                aria-label={`Subir opção ${i + 1}`}
                disabled={i === 0}
                onClick={() => mover(i, -1)}
              >
                ↑
              </Botao>
              <Botao
                variante="texto"
                tamanho="compacto"
                className="px-2"
                aria-label={`Descer opção ${i + 1}`}
                disabled={i === linhas.length - 1}
                onClick={() => mover(i, 1)}
              >
                ↓
              </Botao>
              <Botao
                variante="texto"
                tamanho="compacto"
                className="px-2"
                aria-label={`Remover opção ${i + 1}`}
                disabled={linhas.length === 1 && linha.texto === ''}
                onClick={() => remover(i)}
              >
                <IconeFechar className="h-4 w-4" />
              </Botao>
            </div>
            {repetida(i) ? (
              <p className="ml-8 text-sm text-abb-red">Já existe uma opção com esse texto.</p>
            ) : null}
          </li>
        ))}
      </ul>
      <Botao
        variante="texto"
        tamanho="compacto"
        className="mt-1"
        onClick={() => inserirApos(linhas.length - 1)}
      >
        <IconeMais className="h-4 w-4" />
        Adicionar opção
      </Botao>
      {normalizadas.every((t) => t === '') ? (
        <p className="mt-1 text-sm text-abb-gray">
          Sem nenhuma opção, o montador não terá o que escolher.
        </p>
      ) : null}
    </fieldset>
  );
}
