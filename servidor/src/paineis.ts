/**
 * Os painéis do sistema e quem aprova o acesso a cada um.
 *
 * São fixos: não há cadastro de painel pela interface. Quem aprova é o
 * responsável da linha, identificado pelo e-mail — assim trocar o responsável
 * é trocar uma linha aqui, sem mexer em banco nem em conta de usuário.
 *
 * O vínculo é por e-mail, e não por id de usuário, de propósito: o responsável
 * pode ainda não ter criado a conta. Quando criar, os pedidos acumulados
 * aparecem para ele.
 */

/** Responsável usado enquanto os definitivos de cada linha não são informados. */
const RESPONSAVEL_PADRAO = process.env.RESPONSAVEL_PADRAO ?? 'ericg10456@gmail.com';

export interface PainelFixo {
  slug: string;
  nome: string;
  descricao: string;
  responsavelEmail: string;
}

export const PAINEIS: PainelFixo[] = [
  {
    slug: 'sen-plus',
    nome: 'SEN Plus',
    descricao: 'Checklist de montagem (38 etapas) e verificação de rotina.',
    responsavelEmail: process.env.RESPONSAVEL_SEN_PLUS ?? RESPONSAVEL_PADRAO,
  },
  {
    slug: 'system-pro-e-power',
    nome: 'System Pro E Power',
    descricao: 'Checklist de montagem ainda não cadastrado.',
    responsavelEmail: process.env.RESPONSAVEL_PRO_E_POWER ?? RESPONSAVEL_PADRAO,
  },
  {
    slug: 'system-pro-e-energy',
    nome: 'System Pro E Energy',
    descricao: 'Checklist de montagem ainda não cadastrado.',
    responsavelEmail: process.env.RESPONSAVEL_PRO_E_ENERGY ?? RESPONSAVEL_PADRAO,
  },
  {
    slug: 'mns',
    nome: 'MNS',
    descricao: 'Checklist de montagem ainda não cadastrado.',
    responsavelEmail: process.env.RESPONSAVEL_MNS ?? RESPONSAVEL_PADRAO,
  },
];
