/**
 * Freio contra adivinhação de senha: depois de 5 erros para o mesmo e-mail,
 * vindos do mesmo endereço, novas tentativas esperam 15 minutos.
 *
 * Por e-mail e endereço juntos, e não só por e-mail, para que alguém de fora
 * não consiga trancar a conta de outra pessoa errando a senha de propósito.
 *
 * Fica em memória: reiniciar o servidor zera a contagem. O objetivo é tornar
 * o chute em massa lento demais para valer a pena, não registrar o ataque.
 */

const MAX_FALHAS = 5;
const JANELA_MS = 15 * 60 * 1000;

const falhas = new Map<string, { n: number; ate: number }>();

export function chaveTentativa(email: string, ip: string): string {
  return `${email}|${ip}`;
}

/** Quanto falta para poder tentar de novo; zero é liberado. */
export function esperaRestante(chave: string): number {
  const f = falhas.get(chave);
  if (!f) return 0;
  const resta = f.ate - Date.now();
  if (resta <= 0) {
    falhas.delete(chave);
    return 0;
  }
  return f.n >= MAX_FALHAS ? resta : 0;
}

export function registrarFalha(chave: string): void {
  const agora = Date.now();
  const f = falhas.get(chave);
  // Erros espaçados não se acumulam para sempre: a janela recomeça.
  if (!f || f.ate < agora) falhas.set(chave, { n: 1, ate: agora + JANELA_MS });
  else falhas.set(chave, { n: f.n + 1, ate: agora + JANELA_MS });
}

export function limparFalhas(chave: string): void {
  falhas.delete(chave);
}

/** Chamado a cada hora, junto da limpeza de sessões. */
export function limparTentativasVencidas(): void {
  const agora = Date.now();
  for (const [chave, f] of falhas) if (f.ate < agora) falhas.delete(chave);
}
