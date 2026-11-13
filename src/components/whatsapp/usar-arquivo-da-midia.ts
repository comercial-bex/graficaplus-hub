import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";
import { linkDaMidia } from "@/components/whatsapp/usar-caixa-de-entrada";
import type { MensagemDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import { temCopiaNossa } from "@/domain/whatsapp/midia";

/**
 * De onde vem o arquivo de uma mensagem e como baixar ou abrir (onda 1,
 * 12/11/2026). Mora fora da bolha porque três pedaços usam: a mídia na bolha,
 * o cartão do documento e o visor de fotos (que anda entre mensagens).
 */

/** Quanto vale o link assinado da nossa cópia: o suficiente para uma conversa longa. */
export const VALIDADE_DO_LINK_S = 60 * 60;

type ComArquivo = Pick<MensagemDaCaixa, "storage_bucket" | "storage_path" | "media_url">;

/**
 * A fonte do arquivo: a nossa cópia (link assinado, não vence) ou, enquanto
 * ela não existe, o link do Z-API (vale 30 dias).
 */
export function useOrigemDaMidia(m: ComArquivo, habilitado = true) {
  const naCopia = temCopiaNossa(m);
  const link = useQuery({
    queryKey: ["wa-midia-link", m.storage_bucket, m.storage_path],
    enabled: naCopia && habilitado,
    staleTime: (VALIDADE_DO_LINK_S - 300) * 1000,
    queryFn: () => linkDaMidia(m.storage_bucket as string, m.storage_path as string, VALIDADE_DO_LINK_S),
  });
  return {
    naCopia,
    origem: naCopia ? link.data : (m.media_url ?? undefined),
    aguardando: naCopia && link.isPending,
    semLink: naCopia && link.isError,
    erroDoLink: link.error,
  };
}

function iniciarDownload(href: string, nome: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = nome;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Baixa o arquivo com o nome legível (foto-2026-10-18-1353.jpg), nunca com o código da mensagem. */
export async function baixarMidia(m: ComArquivo, nome: string): Promise<void> {
  try {
    if (temCopiaNossa(m)) {
      // O armazenamento manda o arquivo como anexo, com o nome certo.
      const url = await linkDaMidia(m.storage_bucket as string, m.storage_path as string, 60, nome);
      iniciarDownload(url, nome);
      return;
    }
    try {
      // O Z-API aceita o nosso endereço (CORS): dá para baixar com o nome certo.
      const r = await fetch(m.media_url as string);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const objeto = URL.createObjectURL(blob);
      iniciarDownload(objeto, nome);
      setTimeout(() => URL.revokeObjectURL(objeto), 10_000);
    } catch {
      // Sem como ler o arquivo daqui: abre o link, e o navegador baixa ou mostra.
      window.open(m.media_url as string, "_blank", "noopener,noreferrer");
    }
  } catch (e) {
    toast.error(`Não foi possível baixar: ${mensagemErro(e)}`);
  }
}

/** Abre o arquivo em outra aba. */
export async function abrirMidia(m: ComArquivo): Promise<void> {
  // A aba abre no clique e o endereço chega depois: abrir só depois do await
  // faz o celular tratar como janela não pedida e bloquear.
  const janela = window.open("", "_blank");
  try {
    const url = temCopiaNossa(m)
      ? await linkDaMidia(m.storage_bucket as string, m.storage_path as string)
      : (m.media_url as string);
    if (janela) {
      janela.opener = null;
      janela.location.href = url;
    }
  } catch (e) {
    janela?.close();
    toast.error(`Não foi possível abrir o arquivo: ${mensagemErro(e)}`);
  }
}
