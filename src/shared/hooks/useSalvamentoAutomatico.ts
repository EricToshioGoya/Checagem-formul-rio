import { useCallback, useEffect, useRef, useState } from 'react';

export type EstadoSalvamento = 'ocioso' | 'pendente' | 'salvando' | 'salvo' | 'erro';

/**
 * Executa a gravação com atraso de 500 ms após a última alteração
 * (seção 7.4 da especificação) e expõe o estado para a barra superior.
 */
export function useSalvamentoAutomatico<T>(
  gravar: (valor: T) => Promise<void>,
  atrasoMs = 500,
) {
  const [estado, setEstado] = useState<EstadoSalvamento>('ocioso');
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendente = useRef<T | null>(null);
  const gravarRef = useRef(gravar);
  gravarRef.current = gravar;

  const executar = useCallback(async () => {
    if (pendente.current === null) return;
    const valor = pendente.current;
    pendente.current = null;
    setEstado('salvando');
    try {
      await gravarRef.current(valor);
      setEstado('salvo');
    } catch (erro) {
      console.error('Falha ao salvar', erro);
      setEstado('erro');
    }
  }, []);

  const agendar = useCallback(
    (valor: T) => {
      pendente.current = valor;
      setEstado('pendente');
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => void executar(), atrasoMs);
    },
    [atrasoMs, executar],
  );

  /** Grava imediatamente o que estiver pendente (saída de tela, geração de PDF). */
  const descarregar = useCallback(async () => {
    if (temporizador.current) clearTimeout(temporizador.current);
    await executar();
  }, [executar]);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  return { estado, agendar, descarregar };
}
