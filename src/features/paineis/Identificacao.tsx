import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dominioDoEmail, dominioPermitido } from '../../core/paineis/permissoes';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Aviso, Erro } from '../../shared/componentes/Estado';
import { usePainelAtivo } from './PainelAtivo';

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Identificação de quem vai preencher, exigida pelos painéis que a pedem.
 *
 * Não há espera nem código: o montador informa quem é e entra. O que a
 * ferramenta confere é o domínio do e-mail contra a lista de empresas
 * liberadas naquele painel, mantida na aba de administração.
 */
export function Identificacao() {
  const navegar = useNavigate();
  const { painel, permissao, identificacao, identificar } = usePainelAtivo();
  const [nome, setNome] = useState(identificacao?.nome ?? '');
  const [email, setEmail] = useState(identificacao?.email ?? '');
  const [empresa, setEmpresa] = useState(identificacao?.empresa ?? '');
  const [erro, setErro] = useState<string | null>(null);

  if (!painel) return <Erro detalhe="Escolha um painel antes de se identificar." />;

  const entrar = () => {
    const limpo = email.trim().toLowerCase();
    if (!nome.trim()) {
      setErro('Informe o seu nome.');
      return;
    }
    if (!FORMATO_EMAIL.test(limpo)) {
      setErro('Informe um e-mail válido.');
      return;
    }
    if (!dominioPermitido(limpo, permissao)) {
      setErro(
        permissao.aviso?.trim() ||
          `O painel ${painel.nome} está liberado apenas para as empresas parceiras cadastradas. ` +
            `O domínio ${dominioDoEmail(limpo)} não está na lista — fale com o responsável ABB.`,
      );
      return;
    }
    identificar({ nome: nome.trim(), email: limpo, empresa: empresa.trim() });
    navegar(
      painel.fluxo === 'certificacao'
        ? `/paineis/${painel.id}/solicitacoes`
        : `/paineis/${painel.id}/projetos`,
      { replace: true },
    );
  };

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Identificação</h1>
        <p className="mt-1 text-base text-abb-gray">
          O painel {painel.nome} pede que você se identifique antes de preencher.
        </p>
      </div>

      {erro ? <Erro titulo="Não foi possível entrar" detalhe={erro} /> : null}

      <div className="space-y-4 rounded-lg border border-abb-line bg-white p-4">
        <CampoTexto rotulo="Nome" valor={nome} onChange={setNome} obrigatorio autoFoco />
        <CampoTexto
          rotulo="E-mail da empresa"
          formato="email"
          valor={email}
          onChange={setEmail}
          placeholder="nome@empresa.com.br"
          obrigatorio
          ajuda={
            permissao.dominios.length
              ? `Empresas liberadas neste painel: ${permissao.dominios.join(', ')}.`
              : undefined
          }
        />
        <CampoTexto rotulo="Empresa" valor={empresa} onChange={setEmpresa} />
        <Botao variante="primario" larguraTotal onClick={entrar}>
          Entrar
        </Botao>
      </div>

      <Aviso>
        A identificação fica gravada neste aparelho e vale para o painel {painel.nome}.
        Ela registra quem preencheu — não substitui a validação técnica da ABB.
      </Aviso>
    </div>
  );
}
