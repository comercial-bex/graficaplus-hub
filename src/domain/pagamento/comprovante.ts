import { nomeSeguro } from "@/domain/portal/envio-de-arquivo";

/** Comprovante de Pix: foto de tela ou PDF do banco. Teto menor que o do portal: é um recibo, não uma arte. */
export const TIPOS_DE_COMPROVANTE = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"] as const;
export const TAMANHO_MAXIMO_COMPROVANTE_MB = 10;
export const TAMANHO_MAXIMO_COMPROVANTE_BYTES = TAMANHO_MAXIMO_COMPROVANTE_MB * 1024 * 1024;

export function problemaNoComprovante(a: { nome: string; tipo: string; tamanho: number }): string | null {
  if (!a.nome.trim()) return "Escolha o arquivo.";
  if (!(TIPOS_DE_COMPROVANTE as readonly string[]).includes(a.tipo)) return "Mande uma foto (JPG, PNG) ou o PDF do comprovante.";
  if (a.tamanho <= 0) return "O arquivo está vazio.";
  if (a.tamanho > TAMANHO_MAXIMO_COMPROVANTE_BYTES) return `Arquivo maior que ${TAMANHO_MAXIMO_COMPROVANTE_MB} MB.`;
  return null;
}

/** Pasta e nome no bucket `comprovantes`: orcamento/<id>/<ms>-<nome seguro>. */
export function caminhoDoComprovante(orcamentoId: string, nome: string, agora: Date = new Date()): string {
  return `orcamento/${orcamentoId}/${agora.getTime()}-${nomeSeguro(nome)}`;
}

export const FORMATO_DO_CAMINHO_DO_COMPROVANTE = /^orcamento\/[0-9a-f-]{36}\/[0-9]{10,16}-[A-Za-z0-9._-]{1,110}$/;
