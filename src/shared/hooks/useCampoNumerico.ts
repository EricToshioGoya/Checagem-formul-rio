import { useEffect, useState } from 'react';
import { analisarNumero, numeroParaCampo } from '../utils/numero';

/**
 * Mantém o texto que o montador está digitando e o número que vai para o
 * registro. São coisas diferentes: `12,` é um estado válido de digitação e
 * precisa continuar na tela, enquanto o registro já recebe `12`.
 *
 * O texto só é reescrito quando o valor muda por fora (troca de etapa, leitura
 * do banco) — assim a vírgula não desaparece embaixo do dedo.
 */
export function useCampoNumerico(
  valor: number | null | undefined,
  onChange: (valor: number | null) => void,
) {
  const [texto, setTexto] = useState(() => numeroParaCampo(valor));

  useEffect(() => {
    const atual = valor ?? null;
    if (analisarNumero(texto) !== atual) setTexto(numeroParaCampo(atual));
    // Reagir só ao valor externo: reagir ao texto desfaria a digitação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  const aoDigitar = (novoTexto: string) => {
    setTexto(novoTexto);
    onChange(analisarNumero(novoTexto));
  };

  /** Texto que não representa número algum — o registro fica em branco. */
  const invalido = texto.trim() !== '' && analisarNumero(texto) === null;

  return { texto, aoDigitar, invalido };
}
