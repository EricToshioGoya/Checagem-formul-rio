import { useCallback, useEffect, useRef, useState } from 'react';

export type EstadoSalvamento = 'ocioso' | 'pendente' | 'salvando' | 'salvo' | 'erro';

/** Valor novo, ou função que recebe o pendente e devolve o próximo. */
type Proximo<T> = T | ((pendente: T | null) => T);

/**
 * Executa a gravação com atraso de 500 ms após a última alteração
 * (seção 7.4 da especificação) e expõe o estado para a barra superior.
 *
 * O que estiver pendente é gravado também quando a tela sai de vista: sem
 * isso, marcar uma etapa e recarregar, ou usar o gesto de voltar do Android,
 * descartava o registro dentro da janela dos 500 ms — e a barra ainda dizia
 * "Salvo".
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
    setEstado('salvando');
    try {
      await gravarRef.current(valor);
      // Limpa apenas o que foi gravado: se o montador alterou algo durante a
      // gravação, isso continua pendente para a próxima rodada.
      if (pendente.current === valor) pendente.current = null;
      setEstado('salvo');
    } catch (erro) {
      // O valor continua na fila — uma falha de gravação não pode ser a razão
      // de um registro sumir.
      console.error('Falha ao salvar', erro);
      setEstado('erro');
    }
  }, []);

  const agendar = useCallback(
    (proximo: Proximo<T>) => {
      pendente.current =
        typeof proximo === 'function'
          ? (proximo as (p: T | null) => T)(pendente.current)
          : proximo;
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

  // A tela pode sair de vista sem passar pelo botão de voltar: recarregar,
  // fechar a aba, ou o Android mandar o aplicativo para segundo plano.
  // `visibilitychange` é o único desses eventos em que o celular ainda dá
  // tempo de concluir a gravação.
  useEffect(() => {
    const aoEsconder = () => {
      if (pendente.current !== null) void descarregar();
    };
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'hidden') aoEsconder();
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    window.addEventListener('pagehide', aoEsconder);
    window.addEventListener('beforeunload', aoEsconder);
    return () => {
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      window.removeEventListener('pagehide', aoEsconder);
      window.removeEventListener('beforeunload', aoEsconder);
    };
  }, [descarregar]);

  // Ao desmontar — navegação interna, botão de voltar do navegador — grava o
  // que restou em vez de apenas cancelar o temporizador.
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      if (pendente.current !== null) void executar();
    },
    [executar],
  );

  return { estado, agendar, descarregar };
}
