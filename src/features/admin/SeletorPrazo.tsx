import type { Validade } from '../../core/api/cliente';
import { IconeInfinito, IconeRelogio } from '../../shared/componentes/Icones';
import { dataHoraBr, duracaoCurta } from '../../shared/utils/texto';

const HORA = 3_600_000;

export type OpcaoPrazo = '1d' | '2d' | '7d' | '30d' | 'personalizado' | 'indeterminado';

/** Estado da escolha na tela; vira `Validade` só na hora de enviar. */
export interface EscolhaPrazo {
  opcao: OpcaoPrazo;
  /** Dentro de "personalizado": por quanto tempo, ou até quando. */
  forma: 'duracao' | 'data';
  quantidade: string;
  unidade: 'horas' | 'dias';
  /** Valor de `<input type="datetime-local">`, na hora local do aparelho. */
  data: string;
}

const RAPIDOS: Array<{ opcao: OpcaoPrazo; rotulo: string; horas: number }> = [
  { opcao: '1d', rotulo: '1 dia', horas: 24 },
  { opcao: '2d', rotulo: '2 dias', horas: 48 },
  { opcao: '7d', rotulo: '7 dias', horas: 7 * 24 },
  { opcao: '30d', rotulo: '30 dias', horas: 30 * 24 },
];

export function escolhaInicial(opcao: OpcaoPrazo = '2d'): EscolhaPrazo {
  return { opcao, forma: 'duracao', quantidade: '3', unidade: 'dias', data: '' };
}

/** `datetime-local` trabalha com a hora local, sem fuso: "2026-10-03T11:30". */
export function paraEntradaData(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** O que o servidor recebe — ou a mensagem que explica por que ainda não dá. */
export function paraValidade(e: EscolhaPrazo): Validade | string {
  if (e.opcao === 'indeterminado') return { tipo: 'indeterminado' };
  const rapido = RAPIDOS.find((r) => r.opcao === e.opcao);
  if (rapido) return { tipo: 'horas', horas: rapido.horas };

  if (e.forma === 'duracao') {
    const n = Number(e.quantidade.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return 'Informe um prazo maior que zero.';
    return { tipo: 'horas', horas: e.unidade === 'dias' ? n * 24 : n };
  }

  // Sem fuso explícito, o navegador lê a data na hora local — a mesma em que
  // o administrador a escolheu.
  const ate = new Date(e.data).getTime();
  if (!e.data || Number.isNaN(ate)) return 'Escolha a data e a hora em que o acesso termina.';
  if (ate <= Date.now()) return 'A data escolhida já passou.';
  return { tipo: 'ate', ate };
}

/** Quando o acesso terminaria; `null` é sem prazo. */
export function previsaoFim(v: Validade, agora: number): number | null {
  if (v.tipo === 'indeterminado') return null;
  if (v.tipo === 'horas') return agora + v.horas * HORA;
  return v.ate;
}

/** Resumo curto, para a frase do botão de confirmar. */
export function descreverValidade(v: Validade): string {
  if (v.tipo === 'indeterminado') return 'sem prazo';
  if (v.tipo === 'ate') return `até ${dataHoraBr(v.ate)}`;
  if (v.horas % 24 === 0) {
    const d = v.horas / 24;
    return `por ${d} ${d === 1 ? 'dia' : 'dias'}`;
  }
  return `por ${duracaoCurta(v.horas * HORA)}`;
}

const opcoes: Array<{ opcao: OpcaoPrazo; rotulo: string }> = [
  ...RAPIDOS,
  { opcao: 'personalizado', rotulo: 'Outro prazo' },
  { opcao: 'indeterminado', rotulo: 'Sem prazo' },
];

function classeOpcao(ativa: boolean): string {
  return [
    'min-h-12 rounded-xl border px-3 text-base font-semibold transition',
    ativa
      ? 'border-abb-red bg-red-50 text-abb-red shadow-sm'
      : 'border-abb-line-botao bg-abb-offwhite text-abb-black hover:bg-abb-offwhite-hover',
  ].join(' ');
}

const campo =
  'min-h-12 rounded-xl border border-abb-line bg-white px-3 text-base focus:border-abb-red';

interface Props {
  valor: EscolhaPrazo;
  onChange: (valor: EscolhaPrazo) => void;
  /** Relógio do servidor, para a prévia bater com o que ele vai gravar. */
  agora: number;
}

export function SeletorPrazo({ valor, onChange, agora }: Props) {
  const validade = paraValidade(valor);
  const fim = typeof validade === 'string' ? undefined : previsaoFim(validade, agora);

  return (
    <fieldset>
      <legend className="mb-2 text-base font-semibold">Por quanto tempo?</legend>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {opcoes.map((o) => (
          <button
            key={o.opcao}
            type="button"
            aria-pressed={valor.opcao === o.opcao}
            className={classeOpcao(valor.opcao === o.opcao)}
            onClick={() => onChange({ ...valor, opcao: o.opcao })}
          >
            {o.opcao === 'indeterminado' ? (
              <span className="inline-flex items-center gap-1.5">
                <IconeInfinito className="h-5 w-5" />
                {o.rotulo}
              </span>
            ) : (
              o.rotulo
            )}
          </button>
        ))}
      </div>

      {valor.opcao === 'personalizado' ? (
        <div className="mt-3 rounded-xl border border-abb-line bg-neutral-50 p-3 motion-safe:animate-surgir">
          <div className="inline-flex rounded-lg bg-neutral-200/70 p-1" role="group">
            {(
              [
                ['duracao', 'Por tempo'],
                ['data', 'Até uma data'],
              ] as const
            ).map(([forma, rotulo]) => (
              <button
                key={forma}
                type="button"
                aria-pressed={valor.forma === forma}
                onClick={() => onChange({ ...valor, forma })}
                className={[
                  'min-h-10 rounded-md px-3 text-sm font-semibold transition',
                  valor.forma === forma
                    ? 'bg-white text-abb-black shadow-sm'
                    : 'text-abb-gray hover:text-abb-black',
                ].join(' ')}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {valor.forma === 'duracao' ? (
            <div className="mt-3 flex gap-2">
              <input
                type="number"
                min={1}
                step="any"
                inputMode="decimal"
                aria-label="Quantidade"
                className={`${campo} w-28`}
                value={valor.quantidade}
                onChange={(e) => onChange({ ...valor, quantidade: e.target.value })}
              />
              <select
                aria-label="Unidade"
                className={`${campo} flex-1`}
                value={valor.unidade}
                onChange={(e) =>
                  onChange({ ...valor, unidade: e.target.value as EscolhaPrazo['unidade'] })
                }
              >
                <option value="horas">horas</option>
                <option value="dias">dias</option>
              </select>
            </div>
          ) : (
            <input
              type="datetime-local"
              aria-label="Acesso válido até"
              className={`${campo} mt-3 w-full`}
              min={paraEntradaData(Date.now())}
              value={valor.data}
              onChange={(e) => onChange({ ...valor, data: e.target.value })}
            />
          )}
        </div>
      ) : null}

      <div
        aria-live="polite"
        className={[
          'mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm',
          typeof validade === 'string'
            ? 'bg-red-50 text-red-800'
            : fim === null
              ? 'bg-neutral-100 text-abb-black'
              : 'bg-green-50 text-green-900',
        ].join(' ')}
      >
        {fim === null ? (
          <IconeInfinito className="mt-px h-5 w-5 shrink-0" />
        ) : (
          <IconeRelogio className="mt-px h-5 w-5 shrink-0" />
        )}
        <span>
          {typeof validade === 'string' ? (
            validade
          ) : fim === null ? (
            'Sem data para terminar: o acesso fica liberado até você retirar.'
          ) : (
            <>
              Termina em <strong>{dataHoraBr(fim!)}</strong> — daqui a{' '}
              {duracaoCurta(fim! - agora)}.
            </>
          )}
        </span>
      </div>
    </fieldset>
  );
}
