import type { Projeto } from '../../core/db/tipos';
import { useEstadoSincronizacao } from '../../core/sync/useSincronizacao';

/** Onde está a cópia do projeto: só neste aparelho, a caminho, salva no servidor ou com algum problema. */
export function SituacaoSincronizacao({
  projeto,
}: {
  projeto: Pick<Projeto, 'id' | 'painelId' | 'atualizadoEm' | 'sincronizadoEm'>;
}) {
  const sync = useEstadoSincronizacao();
  const doProjeto = projeto.id === undefined ? undefined : sync.projetos[projeto.id];
  const pendente = (projeto.sincronizadoEm ?? 0) < projeto.atualizadoEm;

  let texto: string;
  let classe = 'text-abb-gray';
  if (projeto.painelId === undefined) {
    texto = 'Só neste aparelho (projeto sem painel não sincroniza)';
  } else if (doProjeto?.fase === 'sem-acesso') {
    texto = 'Sem acesso a este painel agora: o projeto não está sendo enviado.';
    classe = 'text-amber-800';
  } else if (doProjeto?.fase === 'enviando') {
    texto = 'Enviando ao servidor…';
  } else if (pendente && sync.fase === 'sem-rede') {
    texto = 'Sem conexão: as alterações seguem quando a rede voltar.';
  } else if (pendente && doProjeto?.fase === 'erro') {
    texto = `Não foi possível enviar ao servidor: ${doProjeto.erro ?? 'erro desconhecido'}`;
    classe = 'text-abb-red';
  } else if (pendente) {
    texto = 'Alterações a enviar ao servidor';
  } else {
    texto = '☁ Salvo no servidor';
  }

  return (
    <p className={`text-xs ${classe}`} role="status">
      {texto}
    </p>
  );
}
