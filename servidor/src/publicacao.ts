import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { plural } from '../../compartilhado/plural';
import { banco } from './banco';
import { ADMIN_INICIAL } from './admin';
import { configuracaoBackup, listarBackups } from './backup';
import { situacaoAvisos } from './avisos';
import { CONFIAR_PROXY, HTTPS_ATIVO, PASTA_APP } from './configuracao';

/**
 * "Pronto para publicar?": a lista do que falta antes de pôr o sistema no ar
 * para os parceiros. Aparece na tela Sistema e em `npm run admin -- verificar`.
 */

export interface ItemPublicacao {
  item: string;
  ok: boolean;
  detalhe: string;
}

/** Domínios e nomes que só aparecem em conta de teste. */
const PARECE_TESTE = /(@[^@]*\.(local|test|example|invalid)$)|(@(example|exemplo|x)\.com$)|(^teste|\.teste@|teste\.)/i;

function contasDeTeste(): string[] {
  return (banco.prepare('SELECT email FROM usuarios ORDER BY email').all() as Array<{ email: string }>)
    .map((u) => u.email)
    .filter((email) => PARECE_TESTE.test(email));
}

/** Arquivo mais recente de uma pasta, olhando as subpastas. */
function maisRecente(caminho: string): number {
  if (!existsSync(caminho)) return 0;
  const info = statSync(caminho);
  if (!info.isDirectory()) return info.mtimeMs;
  return readdirSync(caminho).reduce((maior, nome) => Math.max(maior, maisRecente(join(caminho, nome))), 0);
}

export function verificarPublicacao(): ItemPublicacao[] {
  const itens: ItemPublicacao[] = [];

  const teste = contasDeTeste();
  itens.push({
    item: 'Contas de teste removidas',
    ok: teste.length === 0,
    detalhe: teste.length
      ? `${plural(teste.length, 'conta com cara de teste', 'contas com cara de teste')}: ${teste.slice(0, 6).join(', ')}${teste.length > 6 ? '…' : ''}. Exclua em Administração → Contas.`
      : 'Nenhuma conta com e-mail de teste.',
  });

  const admin = banco
    .prepare("SELECT ativo FROM usuarios WHERE email = ? AND papel = 'admin'")
    .get(ADMIN_INICIAL) as { ativo: number } | undefined;
  itens.push({
    item: 'Administrador principal com conta',
    ok: Boolean(admin?.ativo),
    detalhe: admin?.ativo
      ? `${ADMIN_INICIAL} é administrador.`
      : `A conta ${ADMIN_INICIAL} ainda não existe ou não é administradora: crie-a antes de divulgar o endereço.`,
  });

  const indice = join(PASTA_APP, 'index.html');
  const compilado = existsSync(indice) ? statSync(indice).mtimeMs : 0;
  const fontes = Math.max(
    ...['src', 'public', 'compartilhado', 'index.html', 'vite.config.ts'].map(maisRecente),
  );
  itens.push({
    item: 'Aplicativo compilado e atualizado',
    ok: compilado > 0 && compilado >= fontes,
    detalhe: !compilado
      ? `Não há ${indice}: rode "npm run build".`
      : compilado < fontes
        ? `O código mudou depois do último build: rode "npm run build".`
        : `${indice} está em dia com o código.`,
  });

  itens.push({
    item: 'HTTPS',
    ok: HTTPS_ATIVO || CONFIAR_PROXY > 0,
    detalhe: HTTPS_ATIVO
      ? 'O servidor atende em HTTPS (certificado próprio).'
      : CONFIAR_PROXY > 0
        ? 'Atrás de proxy: confirme que o proxy atende em HTTPS.'
        : 'Sem HTTPS. Coloque um proxy com HTTPS na frente (ex.: Caddy) e defina CONFIAR_PROXY=1, ou use HTTPS_CERTIFICADO e HTTPS_CHAVE.',
  });

  const avisos = situacaoAvisos();
  itens.push({
    item: 'Avisos de pedidos',
    ok: avisos.email.configurado || avisos.webhook.configurado,
    detalhe:
      avisos.email.configurado || avisos.webhook.configurado
        ? `${[avisos.email.configurado && 'e-mail', avisos.webhook.configurado && 'Teams/webhook']
            .filter(Boolean)
            .join(' e ')} ${avisos.email.configurado && avisos.webhook.configurado ? 'configurados' : 'configurado'}.`
        : 'Ninguém é avisado de pedidos novos: configure SMTP_* ou AVISO_WEBHOOK_URL.',
  });
  itens.push({
    item: 'Endereço público (APP_URL)',
    ok: Boolean(avisos.linkApp),
    detalhe: avisos.linkApp
      ? `Os avisos levam a ${avisos.linkApp}.`
      : 'Sem APP_URL, os avisos chegam sem o link para a tela certa.',
  });

  const backup = configuracaoBackup();
  const ultimo = listarBackups()[0];
  const recente = ultimo && Date.now() - ultimo.criadoEm < 26 * 3_600_000;
  itens.push({
    item: 'Backup diário',
    ok: !backup.desligado && Boolean(recente),
    detalhe: backup.desligado
      ? 'Desligado (BACKUP_DESLIGADO=1).'
      : recente
        ? `Último: ${ultimo.arquivo}, guardados por ${backup.dias} dias em ${backup.pasta}. Copie essa pasta para fora do servidor.`
        : 'Nenhum backup nas últimas 26 horas.',
  });

  return itens;
}
