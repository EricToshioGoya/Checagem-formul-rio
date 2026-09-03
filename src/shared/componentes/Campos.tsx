import { useId, type ReactNode } from 'react';

const entrada =
  'min-h-12 w-full rounded-md border border-abb-line bg-white px-3 text-base text-abb-black placeholder:text-neutral-400 focus:border-abb-red';

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
}

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
}: TextoProps) {
  // Sem id informado, um id gerado mantém o rótulo associado ao campo —
  // exigência de acessibilidade e do leitor de tela.
  const gerado = useId();
  const idCampo = id ?? gerado;
  const rotuloAcessivel = rotulo ?? placeholder;

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
          className={`${entrada} min-h-24 py-2`}
          value={valor}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={idCampo}
          type={senha ? 'password' : 'text'}
          aria-label={rotulo ? undefined : rotuloAcessivel}
          autoFocus={autoFoco}
          className={entrada}
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
  minimo?: number;
}

export function CampoNumero({
  id,
  rotulo,
  valor,
  onChange,
  unidade,
  ajuda,
  obrigatorio,
  minimo,
}: NumeroProps) {
  const gerado = useId();
  const idCampo = id ?? gerado;
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
          aria-label={rotulo ? undefined : unidade}
          type="number"
          inputMode="decimal"
          min={minimo}
          className={entrada}
          value={valor === null || Number.isNaN(valor) ? '' : valor}
          onChange={(e) => {
            const bruto = e.target.value;
            onChange(bruto === '' ? null : Number(bruto));
          }}
        />
        {unidade ? (
          <span className="shrink-0 text-base font-semibold text-abb-gray">{unidade}</span>
        ) : null}
      </div>
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
