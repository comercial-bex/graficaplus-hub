/**
 * A mídia que chega (e sai) pelo WhatsApp, como a conversa a mostra.
 *
 * Até 19/10/2026 toda foto, vídeo e áudio virava uma linha de texto ("Abrir
 * foto (link do Z-API, vale 30 dias)") com a data: sem prévia, sem tocar, sem
 * baixar. Agora a foto aparece na bolha, o vídeo e o áudio tocam ali mesmo e
 * todo arquivo tem o botão "Baixar".
 *
 * O arquivo vem de dois lugares: da NOSSA cópia (bucket whatsapp-midias, link
 * assinado) ou, enquanto ela não existe, do link do Z-API, que vale 30 dias.
 * Mensagem que chegou só com o link é copiada sozinha na primeira vez que
 * alguém a abre (`precisaArquivar`), para o arquivo não sumir do histórico.
 */

import type { MensagemDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";

export type CategoriaDaMidia = "imagem" | "video" | "audio" | "documento" | "outra";

/** Figurinha é imagem; localização e contato não têm arquivo para mostrar. */
export function categoriaDaMidia(tipo: string): CategoriaDaMidia {
  if (tipo === "imagem" || tipo === "sticker") return "imagem";
  if (tipo === "video") return "video";
  if (tipo === "audio") return "audio";
  if (tipo === "documento") return "documento";
  return "outra";
}

type ComArquivo = Pick<MensagemDaCaixa, "storage_bucket" | "storage_path" | "media_url">;

/** Tem arquivo para mostrar: a cópia nossa ou o link do Z-API. */
export function temArquivo(m: ComArquivo): boolean {
  return !!(m.storage_bucket && m.storage_path) || !!m.media_url;
}

/** A cópia nossa existe: o arquivo não vence. */
export function temCopiaNossa(m: ComArquivo): boolean {
  return !!(m.storage_bucket && m.storage_path);
}

/**
 * Chegou só com o link do Z-API, que vence em 30 dias: vale copiar agora. Não
 * tenta de novo mensagem cuja cópia já falhou (a causa fica em `erro`, e o
 * Monitor tem o "Reprocessar mídia" para quem decidir).
 */
export function precisaArquivar(
  m: Pick<MensagemDaCaixa, "direcao" | "storage_path" | "media_url" | "erro">,
): boolean {
  return m.direcao === "entrada" && !m.storage_path && !!m.media_url && !m.erro;
}

const NOME_BASE: Record<string, string> = {
  imagem: "foto",
  sticker: "figurinha",
  video: "video",
  audio: "audio",
  documento: "documento",
};

const EXTENSAO_PADRAO: Record<CategoriaDaMidia, string> = {
  imagem: "jpg",
  video: "mp4",
  audio: "ogg",
  documento: "pdf",
  outra: "bin",
};

/** A extensão do arquivo pelo endereço ("…/abc==.jpg?x=1" → "jpg"). */
export function extensaoDoLink(link: string | null | undefined): string | null {
  if (!link) return null;
  let caminho = link;
  try {
    caminho = new URL(link).pathname;
  } catch {
    caminho = link.split("?")[0];
  }
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(caminho);
  return m ? m[1].toLowerCase() : null;
}

/** "2026-10-18T16:53:48Z" → "2026-10-18-1353" (Belém: três horas a menos). */
function carimbo(iso: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "00";
  return `${p("year")}-${p("month")}-${p("day")}-${p("hour")}${p("minute")}`;
}

/**
 * O nome do arquivo que a pessoa baixa. Cópia nossa: o nome original, sem o
 * número de instante que o armazenamento coloca na frente. Só o link: o tipo e
 * a hora em que chegou ("foto-2026-10-18-1353.jpg"), porque o nome do Z-API é
 * um código sem sentido.
 */
export function nomeParaBaixar(
  m: Pick<MensagemDaCaixa, "tipo" | "storage_path" | "media_url" | "recebido_em" | "enviado_em" | "created_at">,
): string {
  if (m.storage_path) {
    const base = m.storage_path.split("/").pop() ?? "";
    const limpo = base.replace(/^\d{10,}-/, "");
    if (limpo) return limpo;
  }
  const categoria = categoriaDaMidia(m.tipo);
  const extensao = extensaoDoLink(m.storage_path) ?? extensaoDoLink(m.media_url) ?? EXTENSAO_PADRAO[categoria];
  const base = NOME_BASE[m.tipo] ?? "arquivo";
  const quando = m.recebido_em ?? m.enviado_em ?? m.created_at;
  return `${base}-${carimbo(quando)}.${extensao}`;
}
