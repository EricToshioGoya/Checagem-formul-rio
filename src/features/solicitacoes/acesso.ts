import { useEffect, useState } from 'react';
import { conferirAcessoPorSlug, type Bloqueio } from '../../core/api/acessoLocal';
import { useSessao } from '../../core/api/SessaoContexto';

/**
 * Confere, a cada entrada na tela, se a conta ainda pode preencher o painel.
 *
 * É a mesma regra dos projetos de verificação: quem decide é o servidor e,
 * sem rede, vale a última situação vista. Retirar o acesso fecha as
 * solicitações do painel; o que já foi preenchido fica no aparelho.
 */
export function useAcessoCertificacao(slug: string | undefined): {
  conferindo: boolean;
  bloqueio: Bloqueio | null;
} {
  const { usuario } = useSessao();
  const [estado, setEstado] = useState<{ conferindo: boolean; bloqueio: Bloqueio | null }>({
    conferindo: true,
    bloqueio: null,
  });

  useEffect(() => {
    if (!usuario || !slug) return;
    let vivo = true;
    setEstado({ conferindo: true, bloqueio: null });
    void conferirAcessoPorSlug(usuario.id, slug).then((bloqueio) => {
      if (vivo) setEstado({ conferindo: false, bloqueio });
    });
    return () => {
      vivo = false;
    };
  }, [usuario, slug]);

  return estado;
}
