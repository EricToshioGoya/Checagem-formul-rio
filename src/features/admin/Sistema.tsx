import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type SituacaoAvisos, type SituacaoSistema } from '../../core/api/cliente';
import { AvisoFlutuante } from '../../shared/componentes/AvisoFlutuante';
import { Botao } from '../../shared/componentes/Botao';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeCheck } from '../../shared/componentes/Icones';
import { plural } from '../../../compartilhado/plural';
import { dataHoraBr, formatarBytes } from '../../shared/utils/texto';
import { sessaoAdminAcabou } from './sessaoAdmin';

function Cartao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-abb-line bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">{titulo}</h3>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Situacao({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${ok ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}
    >
      {ok ? <IconeCheck className="h-3 w-3" /> : '!'} {children}
    </span>
  );
}

/**
 * Sistema: o que falta para publicar, o backup diário e os avisos de pedidos.
 * A configuração é por variável de ambiente no servidor; aqui se vê o efeito
 * e se testa.
 */
export function Sistema({ onSessaoVencida }: { onSessaoVencida: () => void }) {
  const [dados, setDados] = useState<SituacaoSistema | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<'backup' | 'aviso' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const temporizador = useRef<number | undefined>(undefined);

  const carregar = useCallback(async () => {
    try {
      setDados(await api.get<SituacaoSistema>('/api/admin/sistema'));
      setErro(null);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível ler a situação do sistema.');
    }
  }, [onSessaoVencida]);

  useEffect(() => {
    void carregar();
  }, [carregar]);
  useEffect(() => () => window.clearTimeout(temporizador.current), []);

  const avisar = (texto: string) => {
    setAviso(texto);
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setAviso(null), 3500);
  };

  const fazerBackup = async () => {
    setOcupado('backup');
    try {
      const { backup } = await api.post<{ backup: { arquivo: string } }>('/api/admin/sistema/backup', {});
      await carregar();
      avisar(`Backup gravado: ${backup.arquivo}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível fazer o backup.');
    } finally {
      setOcupado(null);
    }
  };

  const testarAviso = async () => {
    setOcupado('aviso');
    try {
      const { avisos } = await api.post<{ avisos: SituacaoAvisos }>('/api/admin/sistema/aviso-teste', {});
      setDados((d) => (d ? { ...d, avisos } : d));
      const ultimo = avisos.recentes[0];
      avisar(ultimo?.enviadoEm ? 'Aviso de teste enviado.' : 'Aviso de teste na fila — veja o resultado abaixo.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar o teste.');
    } finally {
      setOcupado(null);
    }
  };

  if (!dados && !erro) return <Carregando mensagem="Lendo a situação do sistema…" />;

  const pendentes = dados?.publicacao.filter((i) => !i.ok).length ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Sistema</h2>
        <p className="text-sm text-abb-gray">Publicação, backup e avisos de pedidos.</p>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      {dados ? (
        <>
          <Cartao
            titulo="Pronto para publicar?"
            acao={<Situacao ok={pendentes === 0}>{pendentes === 0 ? 'tudo certo' : plural(pendentes, 'pendência', 'pendências')}</Situacao>}
          >
            <ul className="space-y-2">
              {dados.publicacao.map((i) => (
                <li key={i.item} className="flex gap-2.5 text-sm">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i.ok ? 'bg-green-600 text-white' : 'bg-amber-400 text-amber-950'}`}
                  >
                    {i.ok ? <IconeCheck className="h-3 w-3" /> : '!'}
                  </span>
                  <span>
                    <strong className="font-semibold">{i.item}.</strong>{' '}
                    <span className="text-abb-gray">{i.detalhe}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Cartao>

          <Cartao
            titulo="Backup"
            acao={
              <Botao tamanho="compacto" disabled={ocupado === 'backup'} onClick={() => void fazerBackup()}>
                {ocupado === 'backup' ? 'Gravando…' : 'Fazer backup agora'}
              </Botao>
            }
          >
            <p className="text-sm text-abb-gray">
              {dados.backup.desligado
                ? 'O backup automático está desligado (BACKUP_DESLIGADO=1).'
                : `Um backup por dia, guardados por ${dados.backup.dias} dias em ${dados.backup.pasta}. Copie essa pasta para fora do servidor com frequência.`}
            </p>
            {dados.backup.recentes.length ? (
              <ul className="mt-3 divide-y divide-abb-line/70 rounded-lg border border-abb-line/70 text-sm">
                {dados.backup.recentes.map((b) => (
                  <li key={b.arquivo} className="flex justify-between gap-2 px-3 py-1.5">
                    <span className="truncate font-mono text-xs">{b.arquivo}</span>
                    <span className="shrink-0 text-xs text-abb-gray">
                      {formatarBytes(b.tamanho)} · {dataHoraBr(b.criadoEm)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-amber-900">Nenhum backup ainda.</p>
            )}
            <details className="mt-3 text-sm text-abb-gray">
              <summary className="cursor-pointer font-semibold text-abb-black">Como restaurar</summary>
              <p className="mt-1">
                Pare o servidor, copie o arquivo do backup por cima de <code>acesso.db</code>, apague os arquivos
                <code> acesso.db-wal</code> e <code>acesso.db-shm</code> ao lado dele, e suba o servidor de novo. As
                fotos sincronizadas ficam na subpasta <code>midias</code> do backup.
              </p>
            </details>
          </Cartao>

          <Cartao
            titulo="Avisos de pedidos novos"
            acao={
              <Botao
                tamanho="compacto"
                disabled={ocupado === 'aviso' || (!dados.avisos.email.configurado && !dados.avisos.webhook.configurado)}
                onClick={() => void testarAviso()}
              >
                {ocupado === 'aviso' ? 'Enviando…' : 'Enviar aviso de teste'}
              </Botao>
            }
          >
            <div className="flex flex-wrap gap-2 text-sm">
              <Situacao ok={dados.avisos.email.configurado}>
                E-mail {dados.avisos.email.configurado ? `(${dados.avisos.email.servidor})` : 'não configurado'}
              </Situacao>
              <Situacao ok={dados.avisos.webhook.configurado}>
                Teams/webhook{' '}
                {dados.avisos.webhook.configurado
                  ? `(${dados.avisos.webhook.destino}, ${dados.avisos.webhook.formato})`
                  : 'não configurado'}
              </Situacao>
              <Situacao ok={Boolean(dados.avisos.linkApp)}>
                {dados.avisos.linkApp ? `Link: ${dados.avisos.linkApp}` : 'Sem APP_URL'}
              </Situacao>
            </div>
            <p className="mt-2 text-sm text-abb-gray">
              Pedidos de acesso avisam os responsáveis do painel e os administradores; pedidos para ser administrador
              avisam os administradores. {dados.avisos.pendentes ? `${dados.avisos.pendentes} na fila.` : ''}{' '}
              {dados.avisos.falharam
                ? `${plural(dados.avisos.falharam, 'aviso não saiu', 'avisos não saíram')} depois de 6 tentativas.`
                : ''}
            </p>
            {dados.avisos.recentes.length ? (
              <ul className="mt-3 divide-y divide-abb-line/70 rounded-lg border border-abb-line/70 text-sm">
                {dados.avisos.recentes.map((a) => (
                  <li key={a.id} className="px-3 py-1.5">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="truncate">{a.assunto}</span>
                      <span
                        className={`shrink-0 text-xs font-semibold ${a.enviadoEm ? 'text-green-700' : a.tentativas >= 6 ? 'text-abb-red' : 'text-amber-800'}`}
                      >
                        {a.enviadoEm ? 'enviado' : a.tentativas >= 6 ? 'falhou' : 'na fila'}
                      </span>
                    </p>
                    <p className="truncate text-xs text-abb-gray">
                      {a.canal === 'email' ? `e-mail → ${a.destino}` : 'Teams/webhook'} · {dataHoraBr(a.criadoEm)}
                      {a.erro ? ` · ${a.erro}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
            <details className="mt-3 text-sm text-abb-gray">
              <summary className="cursor-pointer font-semibold text-abb-black">Como configurar</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>
                  E-mail: <code>SMTP_HOST</code>, <code>SMTP_PORTA</code> (587), <code>SMTP_USUARIO</code>,{' '}
                  <code>SMTP_SENHA</code> e <code>SMTP_REMETENTE</code>.
                </li>
                <li>
                  Teams: crie no canal o fluxo “Postar em um canal quando uma solicitação de webhook for recebida” e
                  ponha o endereço em <code>AVISO_WEBHOOK_URL</code>.
                </li>
                <li>
                  <code>APP_URL</code>: o endereço público do sistema, para o aviso levar direto à tela certa.
                </li>
              </ul>
            </details>
          </Cartao>
        </>
      ) : null}

      <AvisoFlutuante texto={aviso} />
    </div>
  );
}
