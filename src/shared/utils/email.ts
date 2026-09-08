/**
 * Abre o cliente de e-mail sem trocar a página atual.
 *
 * Atribuir o `mailto:` a `window.location.href` navega a própria janela. Em
 * iframes restritos — a pré-visualização que o montador compartilha — o
 * navegador barra essa navegação e troca a tela por "This content is blocked".
 * O clique num link com destino próprio, quando barrado, apenas não faz nada e
 * o aplicativo continua no ar.
 */
export function abrirEmail(destinatario: string, assunto: string, corpo: string): void {
  const link = document.createElement('a');
  link.href = `mailto:${encodeURIComponent(destinatario)}?subject=${encodeURIComponent(
    assunto,
  )}&body=${encodeURIComponent(corpo)}`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
