import { LOGO_ABB } from '../marca/logoAbb';

/**
 * Logotipo ABB em vetor. A cor vem de `currentColor`: vermelho ABB por padrão,
 * branco sobre fundo vermelho com `text-white`.
 */
export function LogoAbb({ className = 'h-6 w-auto text-abb-red' }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${LOGO_ABB.largura} ${LOGO_ABB.altura}`}
      className={className}
      fill="currentColor"
      role="img"
      aria-label="ABB"
    >
      {LOGO_ABB.caminhos.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
