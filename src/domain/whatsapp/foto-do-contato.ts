/**
 * A foto de perfil do contato na caixa do WhatsApp (pedido do dono em
 * 14/10/2026: "não aparece a foto da pessoa").
 *
 * De onde vem: todo ReceivedCallback do Z-API traz `photo`, o link da foto do
 * contato no CDN do WhatsApp (pps.whatsapp.net) — inclusive o eco das nossas
 * próprias mensagens. Para quem não escreveu desde então, o Z-API responde
 * GET /profile-picture?phone= com `[{ "link": "…" }]`.
 *
 * Por que guardar cópia: o link é assinado e vence. O parâmetro `oe` é o
 * vencimento em hexadecimal (segundos Unix); nos links que chegaram aqui dava
 * ~10 dias. O Whaticket guarda o link cru e a foto quebra depois de uns dias;
 * aqui o servidor baixa a imagem para o bucket privado e a tela mostra a cópia.
 *
 * Funções puras: o servidor (whatsapp-fotos.server.ts) busca e grava.
 */

/** Só baixamos de hosts do próprio WhatsApp/Meta — nunca de um link qualquer. */
const HOSTS_DA_FOTO = [/(^|\.)whatsapp\.net$/i, /(^|\.)fbcdn\.net$/i, /(^|\.)cdninstagram\.com$/i];

/** Teto da cópia: foto de perfil tem dezenas de KB; mais que isso não é foto. */
export const TAMANHO_MAXIMO_DA_FOTO = 1_000_000;

/** Sem foto (privacidade do contato), tentar de novo depois de tantos dias. */
export const DIAS_ENTRE_TENTATIVAS = 7;

/** O link, se for https e de um host do WhatsApp; senão `null`. */
export function urlDeFotoConfiavel(valor: unknown): URL | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  let u: URL;
  try {
    u = new URL(valor.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (!HOSTS_DA_FOTO.some((h) => h.test(u.hostname))) return null;
  return u;
}

/**
 * A identidade da foto: o caminho do link, sem a assinatura (`oh`, `oe`…), que
 * muda a cada evento. Mesma chave = mesma foto; chave nova = o contato trocou.
 */
export function chaveDaFoto(url: URL): string {
  return `${url.hostname}${url.pathname}`;
}

/** Quando o link vence (parâmetro `oe`, hexadecimal); `null` se não diz. */
export function vencimentoDoLink(url: URL): Date | null {
  const oe = url.searchParams.get("oe");
  if (!oe || !/^[0-9a-f]{6,10}$/i.test(oe)) return null;
  return new Date(parseInt(oe, 16) * 1000);
}

/** O link ainda serve para baixar? Uma hora de folga antes do vencimento. */
export function linkAindaVale(url: URL, agora: Date): boolean {
  const vence = vencimentoDoLink(url);
  return vence === null || vence.getTime() - agora.getTime() > 3_600_000;
}

const DIGITOS = /^\d{10,15}$/;

/**
 * A foto que um evento do webhook traz, de quem é, e a chave dela. Só para
 * mensagem de pessoa (não grupo, não canal, não lista de transmissão) e com
 * link confiável. Inclui as que o sistema ignora para a conversa (eco do que a
 * própria API mandou): a foto do contato vem nelas também.
 */
export function fotoDoEvento(payload: unknown): { telefone: string; url: URL; chave: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== "ReceivedCallback") return null;
  if (p.isGroup === true || p.isNewsletter === true || p.broadcast === true) return null;
  const telefone = typeof p.phone === "string" ? p.phone.replace(/\D/g, "") : "";
  if (!DIGITOS.test(telefone) || /[@-]/.test(String(p.phone))) return null;
  const url = urlDeFotoConfiavel(p.photo);
  if (!url) return null;
  return { telefone, url, chave: chaveDaFoto(url) };
}

/** O link da resposta do GET /profile-picture (`[{link}]` ou `{link}`). */
export function linkDaRespostaDoZapi(corpo: unknown): URL | null {
  const item = Array.isArray(corpo) ? corpo[0] : corpo;
  if (!item || typeof item !== "object") return null;
  return urlDeFotoConfiavel((item as Record<string, unknown>).link);
}

/** Precisa (re)fazer a cópia? Sem cópia, ou a foto mudou. */
export function precisaGuardar(
  conversa: { foto_path: string | null; foto_chave: string | null },
  chave: string,
): boolean {
  return !conversa.foto_path || conversa.foto_chave !== chave;
}

/** Onde a cópia mora no bucket `whatsapp-midias`. Um arquivo por conversa. */
export function caminhoDaFoto(conversaId: string): string {
  return `fotos/${conversaId}.jpg`;
}

/** É imagem de verdade? Pelo tipo e pelos primeiros bytes (JPEG, PNG, WebP). */
export function ehImagem(tipo: string | null, bytes: Uint8Array): boolean {
  if (tipo && !/^image\/(jpeg|png|webp)\b/i.test(tipo)) return false;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return jpeg || png || webp;
}
