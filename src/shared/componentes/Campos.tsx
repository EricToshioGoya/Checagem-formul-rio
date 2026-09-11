import { useId, type ReactNode } from 'react';
import { useCampoNumerico } from '../hooks/useCampoNumerico';

const entrada =
  'min-h-12 w-full rounded-md border border-abb-line bg-white px-3 text-base text-abb-black placeholder:text-neutral-400 focus:border-abb-red';

/** Mesma entrada, sem a altura mínima do toque — para células de tabela. */
const entradaCompacta =
  'min-h-12 w-full rounded border border-abb-line bg-white px-2 text-base text-abb-black focus:border-abb-red';

interface RotuloProps {
  htmlFor?: string;
  children: ReactNode;
  ajuda?: string;
  obrigatorio?: boolean;
}

export function Rotulo({ htmlFor, children, ajuda, obrigatorio }: RotuloProps) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-base font-semibold">
      {children}
      {obrigatorio ? <span className="text-abb-red"> *</span> : null}
      {ajuda ? <span className="block text-sm font-normal text-abb-gray">{ajuda}</span> : null}
    </label>
  );
}

interface TextoProps {
  id?: string;
  rotulo?: string;
  valor: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  ajuda?: string;
  obrigatorio?: boolean;
  multilinha?: boolean;
  autoFoco?: boolean;
  senha?: boolean;
  /** Escolhe o teclado do celular: `email` e `telefone` evitam digitação manual. */
  formato?: 'texto' | 'email' | 'telefone';
  invalido?: boolean;
}

const TECLADO = {
  texto: { type: 'text', inputMode: undefined, autoComplete: undefined },
  email: { type: 'email', inputMode: 'email' as const, autoComplete: 'email' },
  telefone: { type: 'tel', inputMode: 'tel' as const, autoComplete: 'tel' },
};

export function CampoTexto({
  id,
  rotulo,
  valor,
  onChange,
  placeholder,
  ajuda,
  obrigatorio,
  multilinha,
  autoFoco,
  senha,
  formato = 'texto',
  invalido,
}: TextoProps) {
  // Sem id informado, um id gerado mantém o rótulo associado ao campo —
  // exigência de acessibilidade e do leitor de tela.
  const gerado = useId();
  const idCampo = id ?? gerado;
  const rotuloAcessivel = rotulo ?? placeholder;
  const teclado = TECLADO[formato];
  const borda = invalido ? `${entrada} border-abb-red` : entrada;

  return (
    <div>
      {rotulo ? (
        <Rotulo htmlFor={idCampo} ajuda={ajuda} obrigatorio={obrigatorio}>
          {rotulo}
        </Rotulo>
      ) : null}
      {multilinha ? (
        <textarea
          id={idCampo}
          aria-label={rotulo ? undefined : rotuloAcessivel}
          aria-invalid={invalido || undefined}
          className={`${borda} min-h-24 py-2`}
          value={valor}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={idCampo}
          type={senha ? 'password' : teclado.type}
          inputMode={senha ? undefined : teclado.inputMode}
          autoComplete={senha ? undefined : teclado.autoComplete}
          aria-label={rotulo ? undefined : rotuloAcessivel}
          aria-invalid={invalido || undefined}
          autoFocus={autoFoco}
          className={borda}
          value={valor}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

interface NumeroProps {
  id?: string;
  rotulo?: string;
  valor: number | null;
  onChange: (valor: number | null) => void;
  unidade?: string;
  ajuda?: string;
  obrigatorio?: boolean;
  invalido?: boolean;
  /** Rótulo do leitor de tela quando o campo não tem rótulo visível. */
  rotuloAcessivel?: string;
  compacto?: boolean;
}

/**
 * Campo numérico que aceita a vírgula decimal.
 *
 * É `type="text"` de propósito: o `type="number"` do navegador descarta a
 * vírgula sem avisar, e `12,5` acabava gravado como `125`. O `inputMode`
 * continua abrindo o teclado numérico no celular.
 */
export function CampoNumero({
  id,
  rotulo,
  valor,
  onChange,
  unidade,
  ajuda,
  obrigatorio,
  invalido: obrigatorioVazio,
  rotuloAcessivel,
  compacto,
}: NumeroProps) {
  const gerado = useId();
  const idCampo = id ?? gerado;
  const { texto, aoDigitar, invalido: naoNumerico } = useCampoNumerico(valor, onChange);
  const invalido = obrigatorioVazio || naoNumerico;
  const idAviso = `${idCampo}-aviso`;

  return (
    <div>
      {rotulo ? (
        <Rotulo htmlFor={idCampo} ajuda={ajuda} obrigatorio={obrigatorio}>
          {rotulo}
        </Rotulo>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          id={idCampo}
          aria-label={rotulo ? undefined : (rotuloAcessivel ?? unidade)}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={invalido || undefined}
          aria-describedby={naoNumerico ? idAviso : undefined}
          className={[
            compacto ? entradaCompacta : entrada,
            invalido ? 'border-abb-red' : '',
          ].join(' ')}
          value={texto}
          onChange={(e) => aoDigitar(e.target.value)}
        />
        {unidade ? (
          <span className="shrink-0 text-base font-semibold text-abb-gray">{unidade}</span>
        ) : null}
      </div>
      {naoNumerico ? (
        <p id={idAviso} className="mt-1 text-sm font-semibold text-abb-red">
          Valor não numérico — nada será registrado nesta etapa.
        </p>
      ) : null}
    </div>
  );
}

interface SelecaoProps {
  id?: string;
  rotulo?: string;
  valor: string;
  opcoes: string[];
  onChange: (valor: string) => void;
  ajuda?: string;
  obrigatorio?: boolean;
}

export function CampoSelecao({
  id,
  rotulo,
  valor,
  opcoes,
  onChange,
  ajuda,
  obrigatorio,
}: SelecaoProps) {
  const gerado = useId();
  const idCampo = id ?? gerado;
  return (
    <div>
      {rotulo ? (
        <Rotulo htmlFor={idCampo} ajuda={ajuda} obrigatorio={obrigatorio}>
          {rotulo}
        </Rotulo>
      ) : null}
      <select
        id={idCampo}
        aria-label={rotulo ? undefined : 'Tipo de mídia'}
        className={entrada}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— selecione —</option>
        {opcoes.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

interface DataProps {
  id?: string;
  rotulo?: string;
  valor: string;
  onChange: (valor: string) => void;
  ajuda?: string;
  obrigatorio?: boolean;
}

export function CampoData({ id, rotulo, valor, onChange, ajuda, obrigatorio }: DataProps) {
  const gerado = useId();
  const idCampo = id ?? gerado;
  return (
    <div>
      {rotulo ? (
        <Rotulo htmlFor={idCampo} ajuda={ajuda} obrigatorio={obrigatorio}>
          {rotulo}
        </Rotulo>
      ) : null}
      <input
        id={idCampo}
        type="date"
        className={entrada}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
