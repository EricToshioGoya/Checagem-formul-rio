/**
 * Erro com código HTTP; o servidor traduz em resposta JSON. Fica num módulo
 * próprio, sem dependências, para os módulos de base (como `midias`) o usarem
 * sem importar as rotas.
 */
export class ErroHttp extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    /** Motivo legível por máquina, para a tela reagir sem ler o texto. */
    readonly codigo?: string,
  ) {
    super(mensagem);
  }
}
