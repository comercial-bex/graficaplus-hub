import { supabase } from "@/integrations/supabase/client";
import { bucketDoArquivo, nomeParaBaixar, type ArquivoDaOs } from "@/domain/os/arquivos-da-os";

/**
 * Baixar e abrir arquivo do Storage (14/11/2026).
 *
 * Pedido do dono: a produção tem de BAIXAR a arte e o arquivo de impressão. O
 * "Baixar" da tela da OS só abria uma aba com o arquivo (e, para CDR/AI/3MF, o
 * navegador decidia o que fazer, com o nome da chave do Storage: "1730…_x.cdr").
 *
 * Como baixa de verdade: a URL assinada vai com `download: <nome>`, e o Storage
 * responde com "Content-Disposition: attachment; filename=<nome>". O atributo
 * `download` de um <a> não serve para endereço de outro site (o Storage não é
 * o site do sistema) — é o mesmo motivo registrado na caixa do WhatsApp. Com o
 * cabeçalho, um clique num <a> invisível baixa sem sair da página e sem pop-up
 * (o Safari do celular bloqueia aba aberta depois de um `await`).
 *
 * O bucket é o da linha (`arquivos.bucket`); nulo é `arquivos-clientes`. O
 * arquivo que veio pelo WhatsApp mora em `whatsapp-midias` — assinado no bucket
 * fixo, como estava, ele nunca abria.
 */

type Arquivo = Pick<ArquivoDaOs, "nome" | "caminho" | "bucket">;

/** URL assinada que BAIXA (Content-Disposition: attachment), com o nome legível. */
export async function linkParaBaixar(a: Arquivo, segundos = 120): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucketDoArquivo(a))
    .createSignedUrl(a.caminho, segundos, { download: nomeParaBaixar(a) });
  if (error || !data?.signedUrl) throw new Error(error?.message || "o arquivo não respondeu");
  return data.signedUrl;
}

/** Clique num <a> invisível: com o cabeçalho de anexo, baixa sem sair da página. */
export function dispararDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function baixarArquivo(a: Arquivo): Promise<void> {
  dispararDownload(await linkParaBaixar(a));
}

/**
 * Abrir para ver (imagem, PDF) numa aba nova. A aba abre JÁ, no clique, e
 * recebe o endereço depois: aberta só depois do `await`, o Safari do celular
 * trata como pop-up e bloqueia (o mesmo cuidado de design/miniatura-da-arte).
 */
export async function abrirArquivo(a: Arquivo, segundos = 600): Promise<void> {
  const janela = window.open("", "_blank");
  try {
    const { data, error } = await supabase.storage.from(bucketDoArquivo(a)).createSignedUrl(a.caminho, segundos);
    if (error || !data?.signedUrl) throw new Error(error?.message || "o arquivo não respondeu");
    if (!janela) throw new Error("o navegador bloqueou a nova aba — permita pop-ups para este endereço");
    janela.opener = null;
    janela.location.href = data.signedUrl;
  } catch (e) {
    janela?.close();
    throw e;
  }
}

/**
 * URLs para VER (miniatura, visualizador), de uma vez, bucket por bucket.
 * Falhar não derruba quem chama: sem a URL o arquivo aparece com o nome.
 */
export async function urlsParaVer(arquivos: Arquivo[], segundos = 900): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const porBucket = new Map<string, string[]>();
  for (const a of arquivos) {
    if (!a.caminho) continue;
    const b = bucketDoArquivo(a);
    porBucket.set(b, [...new Set([...(porBucket.get(b) ?? []), a.caminho])]);
  }
  await Promise.all(
    [...porBucket].map(async ([bucket, caminhos]) => {
      try {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrls(caminhos, segundos);
        if (error) return;
        for (const linha of data ?? []) if (linha.path && linha.signedUrl) mapa.set(linha.path, linha.signedUrl);
      } catch {
        /* segue sem imagem */
      }
    }),
  );
  return mapa;
}
