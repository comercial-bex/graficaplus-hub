/**
 * Onde moram a foto do modelo e o print do fatiador de um orçamento 3D.
 *
 * O Storage libera cada um por um caminho: `orcamentos-3d/<instante>_modelo_…`
 * (foto: quem lê o 3D vê, porque ela vai para o PDF do cliente) e
 * `orcamentos-3d/<instante>_slicer_…` (print: quem vê custo ou cria orçamento).
 * As regras do banco conferem esse formato — mude os dois juntos
 * (migração 20261013210000).
 */
export const BUCKET_DOS_ARQUIVOS_3D = "arquivos-clientes";

export type ArquivoDoOrcamento3d = "modelo" | "slicer";

/**
 * Sanitiza o nome do arquivo para uso como chave do Supabase Storage.
 * O Storage rejeita chaves com espaço/acento/símbolo ("Invalid key") — e os
 * prints do macOS vêm como "Captura de Tela 2026-07-14 às 18.37.36.png".
 */
export function slugFile(name: string) {
  const semAcento = (name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const ponto = semAcento.lastIndexOf(".");
  const base =
    (ponto > 0 ? semAcento.slice(0, ponto) : semAcento)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "arquivo";
  const ext = (ponto > 0 ? semAcento.slice(ponto + 1) : "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  return ext ? `${base}.${ext}` : base;
}

export function caminhoDoArquivo3d(tipo: ArquivoDoOrcamento3d, nome: string, agora = Date.now()) {
  return `orcamentos-3d/${agora}_${tipo}_${slugFile(nome)}`;
}

/**
 * O material como o cliente entende: "PLA · cor Natural". Só tipo e cor —
 * o nome do cadastro traz a marca do fornecedor ("PLA 3DX Natural"), que não
 * é assunto do cliente.
 */
export function descreverFilamento(f: { tipo?: string | null; cor?: string | null } | null | undefined) {
  const tipo = f?.tipo?.trim();
  const cor = f?.cor?.trim();
  if (!tipo && !cor) return null;
  return [tipo, cor ? `cor ${cor}` : null].filter(Boolean).join(" · ");
}
