/**
 * As fotos do catálogo de fornecedor.
 *
 * Duas origens, as mesmas do CHECK `fornecedor_fotos_caminho_opaco`:
 *   repositorio  as 766 fotos da LUGA, em `public/catalogo/<16 hex>.webp`,
 *                servidas pelo próprio site
 *   storage      as que a equipe sobe pela tela, no bucket `catalogo-fotos`,
 *                em `<catálogo>/<uuid>.<ext>`
 *
 * O nome do arquivo é OPACO nas duas: o cliente vê a URL da imagem, e um
 * "LG3561.webp" contaria o código do fornecedor. O código só vale no envio —
 * a pessoa sobe "LG3561.jpg", a tela grava com nome sorteado e diz ao banco
 * qual código era (`catalogo_registrar_fotos`).
 *
 * Domínio puro.
 */

export const BUCKET_DE_FOTOS = "catalogo-fotos";

/** O mesmo limite do bucket (2 MB) e os mesmos tipos aceitos. */
export const TAMANHO_MAXIMO_DA_FOTO = 2 * 1024 * 1024;
export const TIPOS_DE_FOTO: Record<string, "webp" | "jpg" | "png"> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export type FotoDoItem = { origem: "repositorio" | "storage"; caminho: string };

const CAMINHO_DO_REPOSITORIO = /^\/catalogo\/[0-9a-f]{16,32}\.(webp|jpg|jpeg|png)$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CAMINHO_DO_STORAGE = new RegExp(`^${UUID}/${UUID}\\.(webp|jpg|jpeg|png)$`);

/**
 * O endereço da imagem. `urlPublica` é quem sabe montar a URL do bucket (o
 * cliente do Supabase, no navegador). Caminho fora do formato não vira URL:
 * devolve `null` e a tela mostra "sem foto".
 */
export function urlDaFoto(
  foto: FotoDoItem | null | undefined,
  urlPublica: (caminho: string) => string,
): string | null {
  if (!foto) return null;
  if (foto.origem === "repositorio") {
    return CAMINHO_DO_REPOSITORIO.test(foto.caminho) ? foto.caminho : null;
  }
  return CAMINHO_DO_STORAGE.test(foto.caminho) ? urlPublica(foto.caminho) : null;
}

/** "LG3561.webp" → "LG3561"; "6035-8ZN.JPG" → "6035-8ZN". O banco normaliza para casar. */
export function codigoDoArquivo(nome: string): string {
  return nome.replace(/\.[A-Za-z0-9]{2,5}$/, "").trim();
}

/** Onde a foto sobe: pasta do catálogo, nome sorteado, extensão do tipo real. */
export function caminhoDaFotoNoStorage(catalogoId: string, id: string, tipo: string): string | null {
  const extensao = TIPOS_DE_FOTO[tipo];
  if (!extensao) return null;
  const caminho = `${catalogoId}/${id}.${extensao}`;
  return CAMINHO_DO_STORAGE.test(caminho) ? caminho : null;
}

export type ProblemaDaFoto = { arquivo: string; motivo: string };

/** Confere o lote antes de subir: tipo, tamanho e nome com código. */
export function conferirFotos(arquivos: { name: string; type: string; size: number }[]): {
  validas: { indice: number; codigo: string }[];
  problemas: ProblemaDaFoto[];
} {
  const validas: { indice: number; codigo: string }[] = [];
  const problemas: ProblemaDaFoto[] = [];
  arquivos.forEach((a, indice) => {
    if (!TIPOS_DE_FOTO[a.type]) {
      problemas.push({ arquivo: a.name, motivo: "não é WEBP, JPG nem PNG" });
      return;
    }
    if (a.size > TAMANHO_MAXIMO_DA_FOTO) {
      problemas.push({ arquivo: a.name, motivo: "maior que 2 MB" });
      return;
    }
    const codigo = codigoDoArquivo(a.name);
    if (!codigo) {
      problemas.push({ arquivo: a.name, motivo: "o nome do arquivo tem de ser o código do fornecedor" });
      return;
    }
    validas.push({ indice, codigo });
  });
  return { validas, problemas };
}
