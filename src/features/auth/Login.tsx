import { useState, type FormEvent } from 'react';
import { NOME_APLICACAO } from '../../core/config';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Erro } from '../../shared/componentes/Estado';
import { useSessao } from './SessaoContexto';

/**
 * Porta de entrada da aplicação: o montador se identifica pelo e-mail antes
 * de qualquer tela. Não é autenticação — não há servidor — e sim a
 * identificação que o pedido de acesso ao painel leva ao responsável.
 */
export function Login() {
  const { entrar } = useSessao();
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível entrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="bg-abb-red text-white shadow-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <span className="text-xl font-black tracking-tight">ABB</span>
          <span className="text-base font-semibold">{NOME_APLICACAO}</span>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-10">
        <form
          onSubmit={aoEnviar}
          className="space-y-4 rounded-lg border-2 border-abb-line bg-white p-5"
        >
          <div>
            <h1 className="text-2xl font-bold">Entrar</h1>
            <p className="mt-1 text-base text-abb-gray">
              Informe o seu e-mail. Ele identifica você no pedido de acesso
              enviado ao responsável pelo painel.
            </p>
          </div>

          <CampoTexto
            id="email-montador"
            rotulo="E-mail"
            valor={email}
            onChange={setEmail}
            placeholder="nome@empresa.com"
            obrigatorio
            autoFoco
          />

          {erro ? <Erro titulo="Não foi possível entrar" detalhe={erro} /> : null}

          <Botao
            type="submit"
            variante="primario"
            larguraTotal
            disabled={enviando || !email.trim()}
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </Botao>
        </form>
      </main>
    </div>
  );
}
