import { supabase } from "@/integrations/supabase/client";

/** O bucket das artes e arquivos de cliente é privado: só se vê por URL assinada. */
export const BUCKET_DOS_ARQUIVOS = "arquivos-clientes";

/**
 * URLs assinadas de uma vez só. Falhar aqui NÃO derruba quem chama: sem a URL a
 * capa vira ficha com o nome do arquivo, que é melhor que quadro em branco.
 */
export async function urlsAssinadas(caminhos: string[], segundos = 3600): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const unicos = [...new Set(caminhos.filter(Boolean))];
  if (unicos.length === 0) return mapa;
  try {
    const { data, error } = await supabase.storage.from(BUCKET_DOS_ARQUIVOS).createSignedUrls(unicos, segundos);
    if (error) return mapa;
    for (const linha of data ?? []) {
      if (linha.path && linha.signedUrl) mapa.set(linha.path, linha.signedUrl);
    }
  } catch {
    /* segue sem imagem */
  }
  return mapa;
}
