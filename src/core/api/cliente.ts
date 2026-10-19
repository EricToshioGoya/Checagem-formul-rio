/**
 * Cliente da API de acesso.
 *
 * O token fica em `localStorage` porque a sessão precisa sobreviver a
 * recarregamentos e ao fechamento do aplicativo — o montador entra uma vez e
 * passa semanas na obra. Cookie `HttpOnly` seria mais resistente a XSS, mas
 * exigiria a API na mesma origem do PWA em toda modalidade de entrega, o que
 * a modalidade portátil (localhost) não garante.
 */

import type { EntradaCatalogo } from '../forms/tipos';

const CHAVE_TOKEN = 'sessao-token';
const CHAVE_USUARIO = 'sessao-usuario';

/**
 * Disparado quando o servidor recusa o token de uma sessão aberta (401): a
 * sessão venceu, foi encerrada ou o papel foi retirado. O contexto de sessão
 * escuta e leva para o login, em vez de cada tela mostrar o erro solta.
 */
export const EVENTO_SESSAO_ENCERRADA = 'sessao-encerrada';

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    /** Motivo legível por máquina, quando o servidor informa (ex.: `nao-admin`). */
    readonly codigo?: string,
  ) {
    super(mensagem);
  }

  /** Sessão ausente, vencida ou revogada pelo servidor. */
  get precisaEntrar(): boolean {
    return this.status === 401;
  }

  /** O aparelho está sem rede — distinto de "o servidor recusou". */
  get semRede(): boolean {
    return this.status === 0;
  }
}

export function lerToken(): string | null {
  try {
    return localStorage.getItem(CHAVE_TOKEN);
  } catch {
    return null;
  }
}

export function gravarToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(CHAVE_TOKEN, token);
    else localStorage.removeItem(CHAVE_TOKEN);
  } catch {
    // Navegador com armazenamento bloqueado: a sessão dura só esta aba.
  }
}

/**
 * Última conta e perfil confirmados pelo servidor. É o que deixa o montador
 * entrar no aplicativo sem rede — ou com o servidor fora do ar — para abrir
 * os projetos que já estão no aparelho. Não autoriza nada no servidor.
 */
export function lerUsuarioGuardado(): { usuario: UsuarioSessao; perfil: Perfil } | null {
  try {
    const bruto = localStorage.getItem(CHAVE_USUARIO);
    return bruto ? (JSON.parse(bruto) as { usuario: UsuarioSessao; perfil: Perfil }) : null;
  } catch {
    return null;
  }
}

export function gravarUsuarioGuardado(valor: { usuario: UsuarioSessao; perfil: Perfil } | null): void {
  try {
    if (valor) localStorage.setItem(CHAVE_USUARIO, JSON.stringify(valor));
    else localStorage.removeItem(CHAVE_USUARIO);
  } catch {
    // Armazenamento bloqueado: sem rede, o aparelho não lembrará da conta.
  }
}

async function pedir<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const token = lerToken();
  let resposta: Response;

  try {
    resposta = await fetch(caminho, {
      method: metodo,
      headers: {
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor. Verifique a rede e tente de novo.');
  }

  const texto = await resposta.text();
  let dados: unknown = {};
  try {
    dados = texto ? (JSON.parse(texto) as unknown) : {};
  } catch {
    // Um proxy no caminho (nginx, o próprio Vite) responde HTML quando a API
    // está fora do ar; sem isto, a tela mostrava "Unexpected token <".
    throw new ErroApi(
      resposta.ok ? 500 : resposta.status,
      'O servidor não respondeu como esperado. Tente de novo em instantes.',
    );
  }

  if (!resposta.ok) {
    // `/api/sessao` fica de fora: ali o 401 é senha errada, ou é a própria
    // conferência da sessão na abertura, que o contexto já trata.
    if (resposta.status === 401 && token && caminho !== '/api/sessao') {
      window.dispatchEvent(new Event(EVENTO_SESSAO_ENCERRADA));
    }
    const { erro, codigo } = dados as { erro?: string; codigo?: string };
    throw new ErroApi(resposta.status, erro ?? 'Falha na comunicação com o servidor.', codigo);
  }
  return dados as T;
}

/** Envia um arquivo (foto ou anexo sincronizado) como corpo da requisição; devolve o JSON da resposta. */
async function enviarArquivo<T = unknown>(caminho: string, arquivo: Blob): Promise<T> {
  const token = lerToken();
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      method: 'PUT',
      headers: {
        'Content-Type': arquivo.type || 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: arquivo,
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor.');
  }
  if (!resposta.ok) {
    const dados = (await resposta.json().catch(() => ({}))) as { erro?: string; codigo?: string };
    if (resposta.status === 401 && token) window.dispatchEvent(new Event(EVENTO_SESSAO_ENCERRADA));
    throw new ErroApi(resposta.status, dados.erro ?? 'Falha ao enviar o arquivo.', dados.codigo);
  }
  return (await resposta.json().catch(() => ({}))) as T;
}

/** Baixa um arquivo (foto ou anexo sincronizado) como Blob. */
async function baixarArquivo(caminho: string): Promise<Blob> {
  const token = lerToken();
  let resposta: Response;
  try {
    resposta = await fetch(caminho, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor.');
  }
  if (!resposta.ok) {
    const dados = (await resposta.json().catch(() => ({}))) as { erro?: string; codigo?: string };
    throw new ErroApi(resposta.status, dados.erro ?? 'Falha ao baixar o arquivo.', dados.codigo);
  }
  return resposta.blob();
}

export const api = {
  get: <T,>(caminho: string) => pedir<T>('GET', caminho),
  post: <T,>(caminho: string, corpo?: unknown) => pedir<T>('POST', caminho, corpo ?? {}),
  put: <T,>(caminho: string, corpo?: unknown) => pedir<T>('PUT', caminho, corpo ?? {}),
  delete: <T,>(caminho: string) => pedir<T>('DELETE', caminho),
  enviarArquivo,
  baixarArquivo,
};

/** Monta `?a=1&b=2` só com os parâmetros preenchidos. */
export function consulta(parametros: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') p.set(chave, String(valor));
  }
  const texto = p.toString();
  return texto ? `?${texto}` : '';
}

/** Cabeçalho comum das listas paginadas. */
export interface Paginado {
  pagina: number;
  porPagina: number;
  total: number;
}

/** Quem mexeu por último, vindo do histórico. */
export interface Edicao {
  autorNome: string;
  em: number;
}

/** Painel como a administração o vê: responsáveis e checklists do painel. */
export interface PainelAdmin {
  id: number;
  slug: string;
  nome: string;
  descricao: string | null;
  /** Modelo do certificado e signatário, usados pelos checklists que emitem certificado. */
  certificado: string | null;
  signatario: Signatario | null;
  responsaveis: string[];
  montadoresAprovados: number;
  editado: Edicao | null;
  /** Checklists deste painel, inclusive os desativados. */
  formularios: Array<EntradaCatalogo & { editado: Edicao | null }>;
}

/** Papel da conta: o que ela pode ser. */
export type Papel = 'montador' | 'admin';

/** Como a sessão foi aberta: pelo login de montador ou pelo de administrador. */
export type Perfil = 'montador' | 'admin';

export interface UsuarioSessao {
  id: number;
  email: string;
  nome: string;
  papel?: Papel;
}

/** Administrador como a aba "Administradores" o mostra. */
export interface AdministradorApi {
  id: number;
  nome: string;
  email: string;
  /** Nulo para o administrador inicial, que não passou por aprovação. */
  aprovadoEm: number | null;
  aprovadoPor: string | null;
}

export interface PedidoAdminApi {
  id: number;
  status: 'pendente' | 'recusado' | 'removido';
  criadoEm: number;
  decididoEm: number | null;
  decididoPor: string | null;
  usuario: UsuarioSessao & { criadoEm: number };
}

export interface ResumoAdmin {
  pedidosAdmin: number;
  acessosPendentes: number;
  /** PDFs de verificação aguardando aprovação. */
  verificacoesPendentes?: number;
  /** Solicitações de certificação enviadas, à espera de validação. */
  certificacoesPendentes?: number;
}

/**
 * Situação de um acesso. `expirada` é a aprovação com prazo vencido;
 * `revogada` é o acesso retirado pela administração.
 */
export type StatusAcesso = 'pendente' | 'aprovada' | 'recusada' | 'revogada' | 'expirada';

export type AcessoPainel = 'dono' | StatusAcesso | 'nenhum';

/** Painel como aparece na tela de login, antes de haver sessão. */
export interface PainelPublico {
  id: number;
  slug: string;
  nome: string;
  descricao: string | null;
}

/** Quem assina o certificado (ABB), nos checklists que emitem certificado. */
export interface Signatario {
  nome: string;
  cargo: string;
  area: string;
  empresa: string;
  email: string;
}

export interface PainelApi extends PainelPublico {
  /** Modelo do certificado; só nos painéis com checklist que emite certificado. */
  certificado: string | null;
  signatario: Signatario | null;
  responsaveis: string[];
  meuAcesso: AcessoPainel;
  podePreencher: boolean;
  /** Até quando o acesso aprovado vale, ou quando venceu; nulo é sem prazo. */
  acessoExpiraEm: number | null;
  /** Checklists ativos do painel; zero mostra o aviso no cartão. */
  formularios: number;
  /** Dos ativos, quantos emitem certificado (preenchidos numa solicitação). */
  formulariosCertificado: number;
}

/** Tipo de checklist como a administração o vê. */
export interface TipoChecklistAdmin {
  id: string;
  rotulo: string;
  /** Quantos checklists usam o tipo; com algum, não pode ser excluído. */
  checklists: number;
  /** O tipo com que todo painel novo nasce; não pode ser excluído. */
  padrao: boolean;
}

export interface SolicitacaoApi {
  id: number;
  status: StatusAcesso;
  mensagem: string | null;
  criadoEm: number;
  decididoEm: number | null;
  expiraEm: number | null;
  painel: { id: number; nome: string };
  solicitante: { nome: string; email: string };
}

/** Por quanto tempo um acesso liberado pela administração vale. */
export type Validade =
  | { tipo: 'indeterminado' }
  | { tipo: 'horas'; horas: number }
  | { tipo: 'ate'; ate: number };

/** Um acesso (pedido ou liberação) como a administração o vê. */
export interface AcessoAdmin {
  id: number;
  status: StatusAcesso;
  mensagem: string | null;
  criadoEm: number;
  decididoEm: number | null;
  /** Fim do acesso; nulo é sem prazo. */
  expiraEm: number | null;
  /** Nome de quem decidiu, ou "Administração". Nulo enquanto pendente. */
  decididoPor: string | null;
  painel: { id: number; nome: string };
  usuario: UsuarioSessao;
}

export interface ContaAdmin extends UsuarioSessao {
  criadoEm: number;
}

/** `total` conta contas, e não registros de acesso. */
export interface RespostaAcessosAdmin extends Paginado {
  /** Relógio do servidor no momento da leitura. */
  agora: number;
  /** Contagem de todos os acessos, para os cartões do topo — não só da página. */
  contagem: { ativos: number; temporarios: number; vencendo: number; pendentes: number; encerrados: number };
  /** A página é de contas: cada uma com todos os seus acessos que passam nos filtros. */
  contas: Array<{ usuario: UsuarioSessao; acessos: AcessoAdmin[] }>;
  paineis: Array<{ id: number; nome: string }>;
}

/** Situação de uma conta em cada painel, para o "Liberar acesso". */
export interface AcessosDaConta {
  acessos: Array<{ painelId: number; status: StatusAcesso; expiraEm: number | null }>;
  responsavelPor: number[];
}

/** Conta como a aba Contas a mostra. */
export interface ContaLinha {
  id: number;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  criadoEm: number;
  desativadoEm: number | null;
  ultimoAcessoEm: number | null;
  acessosAtivos: number;
  projetos: number;
  responsavelPor: number;
}

export interface RespostaContas extends Paginado {
  contagem: { todas: number; ativas: number; desativadas: number; admins: number };
  contas: ContaLinha[];
}

export interface RegistroHistorico {
  id: number;
  em: number;
  autor: string;
  acao: string;
  alvoTipo: string;
  alvo: string;
  detalhe: string | null;
}

export interface RespostaHistorico extends Paginado {
  registros: RegistroHistorico[];
}

/**
 * Documento guardado no servidor (documentação de garantia): PDF emitido pelo
 * montador ou certificado anexado pela administração.
 */
export interface DocumentoArquivado {
  categoria: 'verificacao' | 'checklist' | 'certificado';
  uid: string;
  nomeArquivo: string;
  /** Emissão do PDF ou anexação do certificado. */
  em: number;
  tamanho: number;
  sha256: string;
  empresa: string;
  projeto: string;
  titulo: string;
  painel: string | null;
  /** Nulo quando a conta de quem emitiu foi excluída. */
  montador: string | null;
  verificacaoId: number | null;
  /** Situação da aprovação (PDF de verificação) ou `aprovada` (certificado). */
  situacao: string | null;
  versao: number | null;
  numero: string | null;
  certificacaoId: number | null;
  /** Última conferência do SHA-256; nula se ainda não conferido. */
  integridade: { situacao: 'ok' | 'reparado' | 'corrompido' | 'ausente'; verificadoEm: number } | null;
}

export interface RespostaDocumentos extends Paginado {
  documentos: DocumentoArquivado[];
}

/** Andamento de um projeto de um montador num painel, do que ele sincronizou. */
export interface ItemAndamento {
  painel: { id: number; nome: string };
  usuario: { id: number; nome: string; email: string };
  /** Nulo para quem tem acesso e ainda não enviou projeto nenhum. */
  projeto: { uid: string; nome: string | null } | null;
  empresa: string | null;
  tags: number;
  total: number;
  respondidas: number;
  percentual: number;
  /** Última sincronização; nulo é quem tem acesso e ainda não enviou nada. */
  enviadoEm: number | null;
  alteradoEm: number | null;
}

/** Detalhe de um projeto no andamento: TAG → checklist → seção → etapa. */
export interface ContagemAndamento {
  total: number;
  respondidas: number;
}

export interface EtapaAndamento {
  id: string;
  codigo: string;
  descricao: string;
  respondida: boolean;
  fotos: number;
}

export interface SecaoAndamento extends ContagemAndamento {
  id: string;
  codigo: string;
  titulo: string;
  etapas: EtapaAndamento[];
}

export interface ChecklistAndamento extends ContagemAndamento {
  formId: string;
  nome: string;
  tipo: string;
  secoes: SecaoAndamento[];
}

export interface TagAndamento extends ContagemAndamento {
  uid: string;
  nome: string;
  checklists: ChecklistAndamento[];
}

export interface DetalheAndamento {
  enviadoEm: number;
  tags: TagAndamento[];
}

export interface RespostaAndamento extends Paginado {
  itens: ItemAndamento[];
  paineis: Array<{ id: number; nome: string }>;
}

export interface ItemPublicacao {
  item: string;
  ok: boolean;
  detalhe: string;
}

export interface AvisoRecente {
  id: number;
  canal: 'email' | 'webhook';
  destino: string;
  assunto: string;
  criadoEm: number;
  enviadoEm: number | null;
  tentativas: number;
  erro: string | null;
}

export interface SituacaoAvisos {
  email: { configurado: boolean; servidor?: string };
  webhook: { configurado: boolean; destino?: string; formato?: string };
  linkApp: string | null;
  pendentes: number;
  falharam: number;
  recentes: AvisoRecente[];
}

export interface DestinoBackup {
  rotulo: string;
  caminho: string;
  /** Destino de `BACKUP_DESTINOS` (outro disco ou rede), e não a pasta local. */
  externo: boolean;
  /** Fica no mesmo disco dos dados: não protege contra a falha desse disco. */
  mesmoDisco: boolean;
  espaco: { livre: number; total: number } | null;
  ultimaRodada: { em: number; ok: boolean; resumo: unknown } | null;
  ultimoSucesso: number | null;
}

export interface ResultadoVerificacao {
  ok: boolean;
  iniciadoEm: number;
  concluidoEm: number;
  bancoIntegro: boolean;
  problemasBanco: string[];
  documentos: number;
  conferidos: number;
  copiasConferidas: number;
  reparados: number;
  semReparo: number;
  copiasComFalha: number;
  problemas: Array<{ uid: string; onde: string; problema: 'ausente' | 'corrompido'; reparado: boolean }>;
}

export interface SituacaoArmazenamento {
  destinos: DestinoBackup[];
  verificacao: { em: number; ok: boolean; resumo: unknown } | null;
  documentos: { pdfs: number; certificados: number; fotos: number; comProblema: number };
  alertas: Array<{ nivel: 'erro' | 'aviso'; mensagem: string }>;
}

export interface SituacaoSistema {
  avisos: SituacaoAvisos;
  backup: {
    pasta: string;
    dias: number;
    desligado: boolean;
    destinos?: string[];
    recentes: Array<{ arquivo: string; tamanho: number; criadoEm: number }>;
  };
  armazenamento?: SituacaoArmazenamento;
  publicacao: ItemPublicacao[];
}
