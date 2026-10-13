/**
 * Os painéis iniciais — só a semente do primeiro boot. Depois dela os painéis
 * vivem no banco e se cadastram na aba Painéis da administração.
 *
 * O responsável de um painel é sempre um administrador, identificado pelo
 * e-mail: recebe os avisos de pedido de acesso e preenche o painel sem pedir
 * acesso. Quem aprova ou recusa os pedidos é qualquer administrador.
 */

/** Responsável usado enquanto os definitivos de cada linha não são informados. */
const RESPONSAVEL_PADRAO = process.env.RESPONSAVEL_PADRAO ?? 'ericg10456@gmail.com';

/** Quem assina o certificado (ABB). Não é o responsável do painel no sistema. */
export interface Signatario {
  nome: string;
  cargo: string;
  area: string;
  empresa: string;
  email: string;
}

export interface PainelFixo {
  slug: string;
  nome: string;
  descricao: string;
  responsavelEmail: string;
  /** `verificacao` (dossiê em PDF) ou `certificacao` (solicitação, validação e emissão). */
  fluxo: 'verificacao' | 'certificacao';
  /** Modelo do certificado, em `public/certificados`; só no fluxo de certificação. */
  certificado?: string;
  signatario?: Signatario;
}

export const PAINEIS: PainelFixo[] = [
  {
    slug: 'sen-plus',
    nome: 'SEN Plus',
    descricao: 'Checklist de montagem (38 etapas) e verificação de rotina.',
    responsavelEmail: process.env.RESPONSAVEL_SEN_PLUS ?? RESPONSAVEL_PADRAO,
    fluxo: 'verificacao',
  },
  {
    slug: 'system-pro-e-power',
    nome: 'System Pro E Power',
    descricao: 'Solicitação de certificado: ensaios de rotina da NBR IEC 61439.',
    responsavelEmail: process.env.RESPONSAVEL_PRO_E_POWER ?? RESPONSAVEL_PADRAO,
    fluxo: 'certificacao',
    certificado: 'spep',
    signatario: { nome: 'Carlos Eduardo Silva', cargo: 'Especialista de Produto – Distribution Enclosures – ELSP', area: 'Electrification Products', empresa: 'ABB Ltda', email: 'carlos.e.silva@br.abb.com' },
  },
  {
    slug: 'system-pro-e-energy',
    nome: 'System Pro E Energy',
    descricao: 'Solicitação de certificado: ensaios de rotina da NBR IEC 61439.',
    responsavelEmail: process.env.RESPONSAVEL_PRO_E_ENERGY ?? RESPONSAVEL_PADRAO,
    fluxo: 'certificacao',
    certificado: 'spee',
    signatario: { nome: 'Tainá Gioia', cargo: 'Especialista de Produto – Enclosures – ELSB', area: 'Electrification Products', empresa: 'ABB Ltda', email: 'taina.gioia@br.abb.com' },
  },
  {
    slug: 'safr',
    nome: 'SAFR',
    descricao: 'Solicitação de certificado: ensaios de rotina da NBR IEC 61439.',
    responsavelEmail: process.env.RESPONSAVEL_SAFR ?? RESPONSAVEL_PADRAO,
    fluxo: 'certificacao',
    certificado: 'safr',
    signatario: { nome: 'Tainá Gioia', cargo: 'Especialista de Produto – Enclosures – ELSB', area: 'Electrification Products', empresa: 'ABB Ltda', email: 'taina.gioia@br.abb.com' },
  },
  {
    slug: 'mns',
    nome: 'MNS',
    descricao: 'Checklist de montagem ainda não cadastrado.',
    responsavelEmail: process.env.RESPONSAVEL_MNS ?? RESPONSAVEL_PADRAO,
    fluxo: 'verificacao',
  },
];
