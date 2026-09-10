import { useEffect, useRef, useState } from 'react';
import { CampoTexto } from './Campos';
import { useSalvamentoAutomatico } from '../hooks/useSalvamentoAutomatico';

interface Props {
  rotulo?: string;
  valor: string;
  /** Chamado depois da pausa na digitação, não a cada tecla. */
  onGravar: (valor: string) => void;
  placeholder?: string;
  multilinha?: boolean;
  ajuda?: string;
}

/**
 * Campo de texto que grava depois da pausa na digitação.
 *
 * Gravar a cada tecla fazia o texto disputar com a escrita: o valor voltava do
 * banco atrasado, o cursor pulava e caracteres se perdiam — "Texto digitado
 * rapidamente pelo administrador" virava "Txto digitado rap administradr".
 *
 * O texto na tela é local; o valor de fora só o sobrescreve quando muda por
 * outro motivo — restaurar o original, ou trocar de formulário.
 */
export function CampoTextoAdiado({
  rotulo,
  valor,
  onGravar,
  placeholder,
  multilinha,
  ajuda,
}: Props) {
  const [texto, setTexto] = useState(valor);
  const ultimoEnviado = useRef(valor);

  const salvamento = useSalvamentoAutomatico<string>(async (v) => {
    ultimoEnviado.current = v;
    onGravar(v);
  }, 600);

  useEffect(() => {
    if (valor !== ultimoEnviado.current) {
      ultimoEnviado.current = valor;
      setTexto(valor);
    }
  }, [valor]);

  return (
    <CampoTexto
      rotulo={rotulo}
      ajuda={ajuda}
      multilinha={multilinha}
      placeholder={placeholder}
      valor={texto}
      onChange={(v) => {
        setTexto(v);
        salvamento.agendar(v);
      }}
    />
  );
}
