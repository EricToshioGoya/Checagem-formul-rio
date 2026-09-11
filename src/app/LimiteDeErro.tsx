import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Botao } from '../shared/componentes/Botao';

interface Props {
  children: ReactNode;
}

interface Estado {
  erro: Error | null;
}

/**
 * Última barreira antes da tela em branco.
 *
 * Um registro inválido no banco — de uma importação estragada, por exemplo —
 * derrubava a renderização inteira, e como o registro continuava lá, a
 * aplicação abria em branco a cada nova abertura, sem caminho de volta. Aqui o
 * montador vê o que houve e tem duas saídas: tentar de novo, ou apagar os
 * projetos deste aparelho, que é o que destrava o caso do registro corrompido.
 */
export class LimiteDeErro extends Component<Props, Estado> {
  state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo): void {
    console.error('Falha na renderização', erro, info.componentStack);
  }

  private apagarBase = async (): Promise<void> => {
    const confirmado = window.confirm(
      'Isto apaga TODOS os projetos, respostas e fotos gravados neste aparelho.\n\n' +
        'Use apenas se a aplicação não abrir de outro jeito. Se conseguir abrir, ' +
        'exporte os projetos antes.\n\nApagar mesmo assim?',
    );
    if (!confirmado) return;
    indexedDB.deleteDatabase('verificacao-montagem');
    // Esperar o fechamento das conexões abertas não é confiável entre
    // navegadores; recarregar resolve os dois casos.
    window.location.reload();
  };

  render(): ReactNode {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="text-2xl font-bold text-abb-red">A aplicação encontrou um erro</h1>
        <p className="text-base">
          Os dados gravados neste aparelho continuam onde estavam. Tente abrir de
          novo; se a tela voltar a falhar sempre no mesmo ponto, é sinal de que
          algum projeto foi gravado com defeito — provavelmente vindo de uma
          importação.
        </p>
        <pre className="overflow-x-auto rounded-md border border-abb-line bg-neutral-50 p-3 text-sm">
          {erro.message}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Botao variante="primario" onClick={() => window.location.reload()}>
            Tentar de novo
          </Botao>
          <Botao onClick={() => void this.apagarBase()} variante="perigo">
            Apagar os dados deste aparelho
          </Botao>
        </div>
        <p className="text-sm text-abb-gray">
          Apagar os dados é irreversível e só deve ser usado quando a aplicação
          não abre de nenhuma outra forma.
        </p>
      </div>
    );
  }
}
