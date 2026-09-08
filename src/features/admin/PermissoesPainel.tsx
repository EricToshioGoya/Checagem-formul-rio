import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissaoRepository } from '../../core/db/repositorios';
import {
  PERMISSAO_LIVRE,
  limparCachePermissoes,
  normalizarDominio,
  permissaoDoPainel,
  permissaoPainelSchema,
  permissoesSchema,
  type PermissaoPainel,
} from '../../core/paineis/permissoes';
import type { Painel } from '../../core/paineis/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';
import { baixarBlob } from '../../shared/utils/download';

type Estado = 'ocioso' | 'salvando' | 'salvo';

/**
 * Permissões de uso do painel em edição.
 *
 * A lista é de **empresas**, não de pessoas: parceiro entra e sai devagar,
 * montador entra e sai toda hora. Cada painel tem a sua — liberar alguém no
 * SEN Plus não libera no System pro E Power.
 */
export function PermissoesPainel({ painel }: { painel: Painel }) {
  const [permissao, setPermissao] = useState<PermissaoPainel | null>(null);
  /** Texto cru dos domínios: normalizar a cada tecla atrapalharia a digitação. */
  const [dominiosTexto, setDominiosTexto] = useState('');
  const [estado, setEstado] = useState<Estado>('ocioso');
  const [erro, setErro] = useState<string | null>(null);
  const entradaArquivo = useRef<HTMLInputElement>(null);
  const gravacaoAgendada = useRef<number>(0);

  const adotar = useCallback((regras: PermissaoPainel) => {
    setPermissao(regras);
    setDominiosTexto(regras.dominios.join('\n'));
  }, []);

  useEffect(() => {
    setPermissao(null);
    permissaoDoPainel(painel.id)
      .then(adotar)
      .catch(() => adotar(PERMISSAO_LIVRE));
  }, [painel.id, adotar]);

  const gravar = useCallback(
    async (nova: PermissaoPainel) => {
      try {
        const validada = permissaoPainelSchema.parse(nova);
        await PermissaoRepository.salvar(painel.id, validada);
        limparCachePermissoes();
        setEstado('salvo');
        setErro(null);
      } catch (e) {
        setEstado('ocioso');
        setErro(e instanceof Error ? e.message : 'Falha ao gravar a permissão.');
      }
    },
    [painel.id],
  );

  /**
   * A tela responde na hora e a gravação vai atrás. Sem isso, cada tecla
   * esperaria uma ida ao banco para reaparecer no campo.
   */
  const alterar = (mudanca: Partial<PermissaoPainel>) => {
    if (!permissao) return;
    const nova = { ...permissao, ...mudanca };
    setPermissao(nova);
    setEstado('salvando');
    window.clearTimeout(gravacaoAgendada.current);
    gravacaoAgendada.current = window.setTimeout(() => void gravar(nova), 400);
  };

  useEffect(() => () => window.clearTimeout(gravacaoAgendada.current), []);

  /** Exporta o arquivo completo, com todos os painéis já configurados. */
  const exportar = async () => {
    const gravadas = await PermissaoRepository.listar();
    const paineis: Record<string, unknown> = {};
    for (const registro of gravadas) {
      const analise = permissaoPainelSchema.safeParse(registro.permissao);
      if (analise.success) paineis[registro.painelId] = analise.data;
    }
    const conteudo = JSON.stringify({ paineis }, null, 2);
    baixarBlob(new Blob([conteudo], { type: 'application/json' }), 'permissoes.json');
  };

  const importar = async (arquivo: File) => {
    try {
      const lido = permissoesSchema.parse(JSON.parse(await arquivo.text()));
      for (const [painelId, regras] of Object.entries(lido.paineis)) {
        await PermissaoRepository.salvar(painelId, regras);
      }
      limparCachePermissoes();
      adotar(await permissaoDoPainel(painel.id));
      setEstado('salvo');
      setErro(null);
    } catch (e) {
      setErro(
        e instanceof Error ? `Arquivo inválido:\n${e.message}` : 'Arquivo inválido.',
      );
    }
  };

  if (!permissao) return <Carregando mensagem="Lendo as permissões…" />;

  return (
    <div className="space-y-4">
      {erro ? <Erro titulo="Erro" detalhe={erro} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-base font-semibold">
          Painel {painel.nome}
          {estado === 'salvando' ? ' — salvando…' : estado === 'salvo' ? ' — salvo' : ''}
        </p>
        <Botao onClick={() => void exportar()}>Exportar JSON</Botao>
        <Botao onClick={() => entradaArquivo.current?.click()}>Importar JSON</Botao>
        <Botao
          variante="perigo"
          onClick={async () => {
            await PermissaoRepository.restaurarPublicada(painel.id);
            limparCachePermissoes();
            adotar(await permissaoDoPainel(painel.id));
            setEstado('salvo');
          }}
        >
          Restaurar publicada
        </Botao>
      </div>
      <input
        ref={entradaArquivo}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = '';
          if (arquivo) void importar(arquivo);
        }}
      />

      <div className="space-y-4 rounded-lg border border-abb-line bg-white p-4">
        <label className="flex min-h-12 items-center gap-3">
          <input
            type="checkbox"
            className="h-6 w-6"
            checked={permissao.exigirIdentificacao}
            onChange={(e) => alterar({ exigirIdentificacao: e.target.checked })}
          />
          <span className="text-base font-semibold">
            Exigir identificação para usar o painel {painel.nome}
          </span>
        </label>

        <CampoTexto
          rotulo="Empresas liberadas (um domínio por linha)"
          multilinha
          valor={dominiosTexto}
          placeholder={'parceiro1.com.br\nparceiro2.com.br'}
          ajuda="Vazio aceita qualquer domínio: pede o e-mail, mas não restringe a empresa."
          onChange={(v) => {
            setDominiosTexto(v);
            alterar({ dominios: v.split('\n').map(normalizarDominio).filter(Boolean) });
          }}
        />

        <CampoTexto
          rotulo="Aviso a quem for recusado"
          multilinha
          valor={permissao.aviso ?? ''}
          placeholder="Vazio usa a mensagem padrão, que já cita o painel e o domínio recusado."
          onChange={(v) => alterar({ aviso: v.trim() || undefined })}
        />
      </div>

      <Aviso>
        Isto é declaração, não autenticação: a ferramenta confere o domínio do e-mail
        informado, e barra o uso casual por quem não é do parceiro. Não barra quem edita
        o pacote JavaScript. A trava com consequência continua sendo a validação técnica
        da ABB, que numera o certificado.
      </Aviso>

      <Aviso>
        A alteração vale neste aparelho. Para valer nos demais, exporte o JSON e
        publique-o como <code>/public/paineis/permissoes.json</code> na próxima
        publicação.
      </Aviso>
    </div>
  );
}
