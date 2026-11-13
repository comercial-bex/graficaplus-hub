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

import {
  MENSAGEM_NAO_SUPORTADA,
  quandoFoi,
  rotuloDoTipo,
  type MensagemDaCaixa,
} from "@/domain/whatsapp/caixa-de-entrada";

export type CategoriaDaMidia = "imagem" | "video" | "audio" | "documento" | "outra";

/**
 * Contrato da onda 1 (12/11/2026), dono MIDIA. A CONVERSA chama estas duas
 * para desenhar a bolha: a figurinha vem sem fundo de bolha (como no
 * WhatsApp), e o visor de fotos anda entre as fotos carregadas da conversa.
 */
export function bolhaSemFundo(m: Pick<MensagemDaCaixa, "tipo">): boolean {
  return m.tipo === "sticker";
}

/** As fotos carregadas da conversa, da mais antiga para a mais nova (o visor anda nelas). */
export function fotosDaConversa<T extends MensagemDaCaixa>(mensagens: readonly T[]): T[] {
  return mensagens
    .filter((m) => m.tipo === "imagem" && temArquivo(m))
    .slice()
    .sort((a, b) => quandoFoi(a).localeCompare(quandoFoi(b)));
}

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

/**
 * A frase para a mensagem de mídia que chegou SEM o arquivo (o Z-API não
 * mandou o link, ou a cópia falhou antes de existir). Vale dizer o que houve:
 * bolha vazia se lê como "o cliente não mandou nada".
 */
const SEM_ARQUIVO: Record<string, string> = {
  imagem: "A foto não chegou com o arquivo. Peça para o cliente enviar de novo.",
  sticker: "A figurinha não chegou com o arquivo.",
  video: "O vídeo não chegou com o arquivo. Peça para o cliente enviar de novo.",
  audio: "O áudio não chegou com o arquivo. Peça para o cliente enviar de novo.",
  documento: "O documento não chegou com o arquivo. Peça para o cliente enviar de novo.",
};

const SEM_ARQUIVO_DA_EQUIPE = "O arquivo desta mensagem não foi guardado.";

function semExtensao(nome: string): string {
  return nome.replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

function mesmoNome(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === y || semExtensao(x) === semExtensao(y);
}

/**
 * O texto que vai EMBAIXO da mídia na bolha (onda 1, 12/11/2026). Dono: MIDIA.
 *
 * - Texto ou legenda da mensagem: vai como veio, MENOS quando é igual ao nome
 *   do arquivo (o cartão do documento já mostra o nome; repetir é ruído).
 * - Mídia que aparece (tem arquivo) e não tem texto: vazio. O "[Documento]"
 *   que a bolha mostrava some, e o tipo fica no `aria-label` da mídia.
 * - Mídia sem arquivo: uma frase clara do que houve, nunca bolha vazia.
 * - Localização e contato sem texto: dizem o que são, sem colchete.
 * - Aviso do sistema sem texto: a frase de mensagem não suportada.
 */
export function legendaDaBolha(m: MensagemDaCaixa): string {
  const texto = m.texto?.trim() || m.legenda?.trim() || "";
  const categoria = categoriaDaMidia(m.tipo);
  if (categoria !== "outra" && temArquivo(m)) {
    if (!texto) return "";
    return mesmoNome(texto, nomeParaBaixar(m)) ? "" : texto;
  }
  if (texto) return texto;
  if (m.tipo === "sistema") return MENSAGEM_NAO_SUPORTADA;
  if (categoria !== "outra") {
    return m.direcao === "saida" ? SEM_ARQUIVO_DA_EQUIPE : (SEM_ARQUIVO[m.tipo] ?? SEM_ARQUIVO_DA_EQUIPE);
  }
  if (m.tipo === "localizacao") return "Localização enviada.";
  if (m.tipo === "contato") return "Contato enviado.";
  return rotuloDoTipo(m.tipo);
}

/** O nome que o leitor de tela diz para a mídia da bolha: "Foto", "Documento: planta.pdf". */
export function rotuloAcessivelDaMidia(m: MensagemDaCaixa): string {
  const rotulo = rotuloDoTipo(m.tipo);
  return m.tipo === "documento" ? `${rotulo}: ${nomeParaBaixar(m)}` : rotulo;
}
