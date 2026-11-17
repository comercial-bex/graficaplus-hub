import { supabase } from "@/integrations/supabase/client";
import {
  BUCKET_DA_GALERIA,
  COLUNAS_DA_GALERIA,
  MENSAGEM_DA_MIGRACAO_AUSENTE,
  caminhoDoEnvio,
  caminhoNoBucket,
  emOrdem,
  migracaoDaGaleriaAusente,
  movimentoNaOrdem,
  podeApagarOArquivo,
  proximaOrdem,
  validarArquivoDaFoto,
  type ImagemDaGaleria,
} from "@/domain/catalogo/galeria-do-produto";

/**
 * Leitura e escrita da galeria de fotos do produto (17/11/2026), do navegador, com a sessão da pessoa
 * (a RLS decide: leem quem lê o produto, escrevem só admin e gestor).
 *
 * Duas regras que valem para toda função daqui:
 *   - Falha nunca vira lista vazia: toda função lança `ErroDaGaleria`, e `migracaoAusente` diz quando a
 *     causa é a tabela ainda não existir. A tela mostra o erro; ela NUNCA cai num UPDATE direto em
 *     `produtos.imagem_url` (que, sem a galeria, deixaria a capa e a coluna desencontradas).
 *   - O arquivo do bucket só sai se nenhum outro registro aponta para ele, e na dúvida fica.
 */

export class ErroDaGaleria extends Error {
  migracaoAusente: boolean;
  constructor(mensagem: string, migracaoAusente = false) {
    super(mensagem);
    this.name = "ErroDaGaleria";
    this.migracaoAusente = migracaoAusente;
  }
}

const TABELA = "produto_imagens";
// A tabela nova não está nos tipos gerados do Supabase até a migração ser aplicada e os tipos regerados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabela = () => (supabase as any).from(TABELA);

function traduzir(erro: unknown, padrao: string): ErroDaGaleria {
  if (migracaoDaGaleriaAusente(erro)) return new ErroDaGaleria(MENSAGEM_DA_MIGRACAO_AUSENTE, true);
  const e = erro as { code?: string; message?: string } | null;
  if (e?.code === "42501" || /row-level security|permission denied/i.test(e?.message ?? "")) {
    return new ErroDaGaleria("Só administrador e gerência mexem nas fotos do produto.");
  }
  return new ErroDaGaleria(padrao);
}

export async function listarImagens(produtoId: string): Promise<ImagemDaGaleria[]> {
  const { data, error } = await tabela()
    .select(COLUNAS_DA_GALERIA)
    .eq("produto_id", produtoId)
    .order("ordem", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw traduzir(error, "Não foi possível carregar as fotos do produto. Tente de novo.");
  return emOrdem((data ?? []) as ImagemDaGaleria[]);
}

/** Sobe o arquivo para a pasta manual do bucket e devolve o endereço público. Valida tipo e tamanho antes. */
export async function enviarArquivoDaFoto(
  produtoId: string,
  arquivo: File,
): Promise<{ url: string; caminho: string }> {
  const v = validarArquivoDaFoto(arquivo);
  if (!v.ok) throw new ErroDaGaleria(v.motivo);
  const caminho = caminhoDoEnvio(produtoId, v.extensao, crypto.randomUUID());
  const { error } = await supabase.storage.from(BUCKET_DA_GALERIA).upload(caminho, arquivo, {
    cacheControl: "31536000",
    contentType: arquivo.type,
    upsert: false,
  });
  if (error)
    throw new ErroDaGaleria(
      "Não foi possível enviar a foto. Só administrador e gerência enviam fotos de produto.",
    );
  return {
    url: supabase.storage.from(BUCKET_DA_GALERIA).getPublicUrl(caminho).data.publicUrl,
    caminho,
  };
}

async function descartarArquivoRecemEnviado(caminho: string): Promise<void> {
  try {
    await supabase.storage.from(BUCKET_DA_GALERIA).remove([caminho]);
  } catch {
    /* sobra um arquivo sem registro; inofensivo */
  }
}

/**
 * Adiciona uma foto. Nunca tira a capa de quem já tem (o banco faz a primeira virar capa). Se o registro
 * falha, o arquivo que acabou de subir é descartado: não fica arquivo sem dono.
 */
export async function adicionarFoto(
  produtoId: string,
  arquivo: File,
  atuais: readonly ImagemDaGaleria[],
): Promise<ImagemDaGaleria> {
  const { url, caminho } = await enviarArquivoDaFoto(produtoId, arquivo);
  const { data, error } = await tabela()
    .insert({ produto_id: produtoId, url, origem: "manual", ordem: proximaOrdem(atuais) })
    .select(COLUNAS_DA_GALERIA)
    .single();
  if (error) {
    await descartarArquivoRecemEnviado(caminho);
    throw traduzir(
      error,
      "A foto subiu mas não consegui guardar na galeria. Nada foi perdido: tente de novo.",
    );
  }
  return data as ImagemDaGaleria;
}

export async function definirCapa(id: string): Promise<void> {
  const { error } = await tabela().update({ capa: true }).eq("id", id);
  if (error) throw traduzir(error, "Não foi possível definir a capa. Tente de novo.");
}

export async function atualizarLegenda(id: string, legenda: string): Promise<void> {
  const { error } = await tabela()
    .update({ legenda: legenda.trim() || null })
    .eq("id", id);
  if (error) throw traduzir(error, "Não foi possível guardar a legenda. Tente de novo.");
}

/** Sobe ou desce uma foto na fila. Duas ou mais gravações; se uma falha, a fila é relida pela tela. */
export async function moverFoto(
  atuais: readonly ImagemDaGaleria[],
  id: string,
  direcao: "subir" | "descer",
): Promise<void> {
  for (const mudanca of movimentoNaOrdem(atuais, id, direcao)) {
    const { error } = await tabela().update({ ordem: mudanca.ordem }).eq("id", mudanca.id);
    if (error) throw traduzir(error, "Não foi possível mudar a ordem das fotos. Tente de novo.");
  }
}

/**
 * Quantos OUTROS registros apontam para o endereço: outras linhas da galeria (deste ou de outro produto)
 * e a coluna produtos.imagem_url de qualquer produto. `null` = não consegui conferir.
 */
export async function contarOutrosRegistros(
  url: string,
  ignorarImagemId: string,
): Promise<number | null> {
  try {
    const [galeria, produtos] = await Promise.all([
      tabela()
        .select("id", { count: "exact", head: true })
        .eq("url", url)
        .neq("id", ignorarImagemId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("produtos_operacional")
        .select("id", { count: "exact", head: true })
        .eq("imagem_url", url),
    ]);
    if (galeria.error || produtos.error) return null;
    return (galeria.count ?? 0) + (produtos.count ?? 0);
  } catch {
    return null;
  }
}

export type ResultadoDaTroca = { arquivoApagado: boolean };

/**
 * Remove a foto da galeria. A linha sai primeiro (o banco passa a capa para a próxima, se era a capa); só
 * depois, e só se nenhum outro registro aponta para o arquivo, o arquivo sai do bucket. A conferência é feita
 * DEPOIS de a linha sair: a coluna do produto já foi acertada pelo gatilho e não conta contra a própria foto.
 */
export async function removerFoto(img: ImagemDaGaleria): Promise<ResultadoDaTroca> {
  const { error } = await tabela().delete().eq("id", img.id);
  if (error) throw traduzir(error, "Não foi possível remover a foto. Tente de novo.");
  return { arquivoApagado: await apagarArquivoSeSobrou(img.url, img.id) };
}

async function apagarArquivoSeSobrou(url: string, imagemId: string): Promise<boolean> {
  const caminho = caminhoNoBucket(url);
  if (!caminho) return false;
  const outros = await contarOutrosRegistros(url, imagemId);
  if (!podeApagarOArquivo({ url, outrosRegistros: outros })) return false;
  try {
    const { error } = await supabase.storage.from(BUCKET_DA_GALERIA).remove([caminho]);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Troca o arquivo de uma foto, mantendo o lugar, a legenda e a capa dela. O arquivo antigo só sai se nenhum
 * outro registro aponta para ele; se a gravação do novo endereço falha, o arquivo novo é descartado.
 */
export async function trocarFoto(img: ImagemDaGaleria, arquivo: File): Promise<ResultadoDaTroca> {
  const { url, caminho } = await enviarArquivoDaFoto(img.produto_id, arquivo);
  const { error } = await tabela().update({ url, origem: "manual" }).eq("id", img.id);
  if (error) {
    await descartarArquivoRecemEnviado(caminho);
    throw traduzir(error, "A foto nova subiu mas não consegui trocar. A antiga continua no lugar.");
  }
  return { arquivoApagado: await apagarArquivoSeSobrou(img.url, img.id) };
}
