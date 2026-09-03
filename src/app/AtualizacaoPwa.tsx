import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Botao } from '../shared/componentes/Botao';

/** Tempo que o aviso de "pronto para uso offline" fica na tela. */
const SEGUNDOS_AVISO_OFFLINE = 6;

/**
 * Avisa quando uma nova versão foi baixada e quando o aplicativo já opera
 * offline. A faixa fica fixa no rodapé, então o corpo ganha um respiro
 * equivalente enquanto ela existe — sem isso ela cobriria o botão principal
 * de telas curtas, como a de novo projeto no celular.
 */
export function AtualizacaoPwa() {
  const {
    offlineReady: [prontoOffline, setProntoOffline],
    needRefresh: [precisaAtualizar, setPrecisaAtualizar],
    updateServiceWorker,
  } = useRegisterSW();

  const visivel = prontoOffline || precisaAtualizar;

  // O aviso de offline é apenas informativo: some sozinho.
  useEffect(() => {
    if (!prontoOffline) return;
    const t = setTimeout(() => setProntoOffline(false), SEGUNDOS_AVISO_OFFLINE * 1000);
    return () => clearTimeout(t);
  }, [prontoOffline, setProntoOffline]);

  useEffect(() => {
    document.body.style.paddingBottom = visivel ? '6.5rem' : '';
    return () => {
      document.body.style.paddingBottom = '';
    };
  }, [visivel]);

  if (!visivel) return null;

  const fechar = () => {
    setProntoOffline(false);
    setPrecisaAtualizar(false);
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-abb-red bg-white p-3 shadow-lg"
      role="status"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <p className="text-base font-semibold">
          {precisaAtualizar
            ? 'Há uma versão nova do aplicativo.'
            : 'Aplicativo pronto para uso sem internet.'}
        </p>
        <div className="flex gap-2">
          {precisaAtualizar ? (
            <Botao variante="primario" onClick={() => void updateServiceWorker(true)}>
              Atualizar agora
            </Botao>
          ) : null}
          <Botao onClick={fechar}>Fechar</Botao>
        </div>
      </div>
    </div>
  );
}
