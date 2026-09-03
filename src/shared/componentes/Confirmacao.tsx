import { Botao } from './Botao';
import { Modal } from './Modal';

interface Props {
  aberto: boolean;
  titulo: string;
  mensagem: string;
  textoConfirmar?: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/** Toda ação destrutiva passa por aqui — exigência da seção 9 da especificação. */
export function Confirmacao({
  aberto,
  titulo,
  mensagem,
  textoConfirmar = 'Excluir',
  onConfirmar,
  onCancelar,
}: Props) {
  return (
    <Modal
      aberto={aberto}
      titulo={titulo}
      onFechar={onCancelar}
      rodape={
        <>
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao variante="primario" onClick={onConfirmar}>
            {textoConfirmar}
          </Botao>
        </>
      }
    >
      <p className="text-base leading-relaxed whitespace-pre-line">{mensagem}</p>
    </Modal>
  );
}
