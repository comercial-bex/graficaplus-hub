/**
 * Galeria de fotos do produto (17/11/2026): regras puras, sem React e sem banco.
 *
 * Antes, o produto tinha UMA foto (`produtos.imagem_url`). Agora cada foto é uma linha de
 * `produto_imagens`, e uma delas é a capa. O banco mantém `produtos.imagem_url` igual à capa
 * (gatilho), então parceiro, orçamento e tabela de preços continuam lendo a coluna de sempre.
 *
 * As regras que a tela e o servidor precisam repetir moram aqui, com teste:
 *   - quem é a capa e o que acontece com ela quando a capa sai;
 *   - a ordem das fotos;
 *   - o arquivo do bucket só sai quando NENHUM outro registro aponta para ele (e na dúvida fica);
 *   - tipo e tamanho do arquivo antes de subir;
 *   - reconhecer "a tabela ainda não existe" (migração não aplicada), para a tela dizer isso em
 *     vez de mostrar uma galeria vazia.
 */

export const BUCKET_DA_GALERIA = "produtos-fotos";
export const PASTA_DAS_MANUAIS = "manual";
export const LIMITE_DA_FOTO_MB = 5;
export const TIPOS_DA_FOTO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type OrigemDaImagem = "manual" | "ia";

export type ImagemDaGaleria = {
  id: string;
  produto_id: string;
  url: string;
  legenda: string | null;
  ordem: number;
  capa: boolean;
  origem: OrigemDaImagem;
  created_by: string | null;
};

/** As colunas que a tela lê. Todas existem na tabela da migração 20261117210000. */
export const COLUNAS_DA_GALERIA = "id, produto_id, url, legenda, ordem, capa, origem, created_by";

export type ValidacaoDoArquivo = { ok: true; extensao: string } | { ok: false; motivo: string };

/** Tipo e tamanho antes de gastar o envio. O texto é o que a pessoa lê na tela. */
export function validarArquivoDaFoto(arquivo: { type: string; size: number }): ValidacaoDoArquivo {
  const extensao = TIPOS_DA_FOTO[arquivo.type.toLowerCase()];
  if (!extensao) return { ok: false, motivo: "Escolha uma imagem JPG, PNG ou WebP." };
  if (!(arquivo.size > 0))
    return { ok: false, motivo: "O arquivo está vazio. Escolha outra imagem." };
  if (arquivo.size > LIMITE_DA_FOTO_MB * 1024 * 1024) {
    return {
      ok: false,
      motivo: `A foto passa de ${LIMITE_DA_FOTO_MB} MB. Reduza e tente de novo.`,
    };
  }
  return { ok: true, extensao };
}

/** Caminho de um arquivo novo: sempre na pasta manual do produto, com nome sorteado. */
export function caminhoDoEnvio(produtoId: string, extensao: string, sorteio: string): string {
  return `${PASTA_DAS_MANUAIS}/${produtoId}/${sorteio}.${extensao}`;
}

/** Fotos na ordem em que aparecem: pela coluna `ordem`, e pelo id quando empatam (ordem estável). */
export function emOrdem<T extends Pick<ImagemDaGaleria, "id" | "ordem">>(
  imagens: readonly T[],
): T[] {
  return [...imagens].sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
}

/**
 * A capa é a foto marcada como capa, e só ela. Sem marca não há capa: não se escolhe "a primeira"
 * às escondidas, porque `produtos.imagem_url` (o que o parceiro vê) seguiria vazio e a tela mentiria.
 */
export function capaDaGaleria<T extends Pick<ImagemDaGaleria, "capa">>(
  imagens: readonly T[],
): T | null {
  return imagens.find((i) => i.capa) ?? null;
}

/** A ordem da próxima foto: depois da última, para a nova nunca furar a fila. */
export function proximaOrdem(imagens: readonly Pick<ImagemDaGaleria, "ordem">[]): number {
  return imagens.reduce((maior, i) => Math.max(maior, i.ordem), -1) + 1;
}

/**
 * Como a galeria fica depois de uma foto entrar. Adicionar NUNCA tira a capa de quem já tem: a nova
 * é capa só se a galeria não tinha nenhuma (a primeira foto do produto vira a capa sozinha).
 */
export function depoisDeAdicionar<T extends ImagemDaGaleria>(
  imagens: readonly T[],
  nova: Omit<T, "capa" | "ordem">,
): T[] {
  const temCapa = imagens.some((i) => i.capa);
  const entra = { ...nova, capa: !temCapa, ordem: proximaOrdem(imagens) } as T;
  return [...imagens, entra];
}

/** Define a capa: só uma foto é capa, e as outras continuam na galeria. Id que não existe não muda nada. */
export function depoisDeDefinirCapa<T extends Pick<ImagemDaGaleria, "id" | "capa">>(
  imagens: readonly T[],
  id: string,
): T[] {
  if (!imagens.some((i) => i.id === id)) return [...imagens];
  return imagens.map((i) => ({ ...i, capa: i.id === id }));
}

/**
 * Como a galeria fica depois de uma foto sair. Se a que saiu era a capa, a primeira da fila passa a
 * ser a capa (o produto não fica sem foto enquanto tiver alguma). Se era outra, a capa não muda.
 */
export function depoisDeRemover<T extends Pick<ImagemDaGaleria, "id" | "ordem" | "capa">>(
  imagens: readonly T[],
  id: string,
): { restantes: T[]; novaCapaId: string | null } {
  const saiu = imagens.find((i) => i.id === id);
  const restantes = imagens.filter((i) => i.id !== id);
  if (!saiu || !saiu.capa || restantes.length === 0) {
    return { restantes: [...restantes], novaCapaId: null };
  }
  const nova = emOrdem(restantes)[0];
  return {
    restantes: restantes.map((i) => ({ ...i, capa: i.id === nova.id })),
    novaCapaId: nova.id,
  };
}

/**
 * Sobe ou desce uma foto na fila trocando de lugar com a vizinha. Devolve só as linhas cuja ordem
 * muda, ou lista vazia quando já está na ponta. A fila é renumerada em 0..n-1 para a troca valer
 * mesmo quando duas fotos tinham a mesma ordem (o que muda pode ser mais de duas linhas nesse caso).
 */
export function movimentoNaOrdem(
  imagens: readonly Pick<ImagemDaGaleria, "id" | "ordem">[],
  id: string,
  direcao: "subir" | "descer",
): { id: string; ordem: number }[] {
  const fila = emOrdem(imagens);
  const i = fila.findIndex((x) => x.id === id);
  const j = direcao === "subir" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= fila.length) return [];
  const nova = fila.map((x, k) => ({ id: x.id, ordem: k }));
  [nova[i].ordem, nova[j].ordem] = [nova[j].ordem, nova[i].ordem];
  return nova.filter((n, k) => fila[k].ordem !== n.ordem);
}

/**
 * "…/object/public/produtos-fotos/<caminho>" vira "<caminho>". Endereço de outro bucket, de outro
 * site, vazio ou com ".." nunca vira caminho: o que não é do bucket não é apagado por aqui.
 */
export function caminhoNoBucket(url: string | null | undefined): string | null {
  if (!url) return null;
  const marca = `/${BUCKET_DA_GALERIA}/`;
  const i = url.indexOf(marca);
  if (i < 0) return null;
  let caminho = url.slice(i + marca.length).split(/[?#]/)[0];
  try {
    caminho = decodeURIComponent(caminho);
  } catch {
    return null;
  }
  if (!caminho || caminho.startsWith("/") || caminho.split("/").some((p) => p === ".." || p === ""))
    return null;
  return caminho;
}

/**
 * O arquivo do bucket pode ser apagado? Só se o endereço é do bucket E nenhum outro registro (outra
 * foto da galeria, deste ou de outro produto, ou a coluna `produtos.imagem_url` de outro produto)
 * aponta para ele. `null` quer dizer "não consegui conferir": na dúvida o arquivo fica, porque
 * sobrar um arquivo é inofensivo e apagar o que alguém usa quebra uma foto na tela do parceiro.
 */
export function podeApagarOArquivo(a: { url: string; outrosRegistros: number | null }): boolean {
  if (caminhoNoBucket(a.url) === null) return false;
  return a.outrosRegistros === 0;
}

/** A tabela de fotos ainda não existe no banco (migração não aplicada)? Pelo código do Postgres ou do PostgREST. */
export function migracaoDaGaleriaAusente(erro: unknown): boolean {
  const e = erro as { code?: string; message?: string } | null | undefined;
  if (!e) return false;
  if (e.code === "42P01" || e.code === "PGRST205") return true;
  return (
    /produto_imagens/i.test(e.message ?? "") &&
    /(does not exist|schema cache|não existe)/i.test(e.message ?? "")
  );
}

export const MENSAGEM_DA_MIGRACAO_AUSENTE =
  "A galeria de fotos ainda não foi ativada no banco. A foto atual do produto continua valendo. Peça para aplicar a migração produto_imagens.";
