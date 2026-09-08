import { descreverErro, templateCertificadoSchema } from './schema';
import type { TemplateCertificado } from './tipos';

const base = import.meta.env.BASE_URL;
const cache = new Map<string, TemplateCertificado>();

/** Carrega e valida o template de certificado de um painel. */
export async function carregarTemplateCertificado(
  id: string,
  forcar = false,
): Promise<TemplateCertificado> {
  if (!forcar && cache.has(id)) return cache.get(id)!;
  const resposta = await fetch(`${base}certificados/${id}.json`, { cache: 'no-cache' });
  if (!resposta.ok) {
    throw new Error(
      `Template de certificado "${id}" não encontrado (HTTP ${resposta.status}).`,
    );
  }
  const analise = templateCertificadoSchema.safeParse(await resposta.json());
  if (!analise.success) {
    throw new Error(
      `Template de certificado "${id}" inválido:\n${descreverErro(analise.error)}`,
    );
  }
  cache.set(id, analise.data);
  return analise.data;
}

export function limparCacheCertificados(): void {
  cache.clear();
}
