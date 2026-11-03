import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Foto de produto gerada pela IA do Lovable (01/11/2026).
 *
 * O dono viu o catálogo do Holdprint, todo com foto, e pediu: "se não tiver
 * foto, gera, no padrão da Bex Print". Aqui 0 de 55 produtos tinham foto. A
 * foto gerada é um quebra-galho honesto: sobe para o bucket `produtos-fotos`
 * na pasta `ia/`, aponta em `produtos.imagem_url` e some no dia em que alguém
 * enviar a foto real pelo mesmo botão de sempre.
 *
 * Regras:
 *   - só admin e gestor (a mesma regra da escrita no bucket);
 *   - a IA recebe nome, família e descrição do produto. Nunca custo ou preço;
 *   - a chave (`LOVABLE_API_KEY`) só existe no servidor. Sem ela a resposta é
 *     "sem_ia" e a tela oferece o pedido pronto para copiar e gerar fora;
 *   - 402 = saldo de IA acabou; 429 = muitas chamadas seguidas. A tela diz isso
 *     com essas palavras, sem fingir que "não deu".
 *
 * O modelo vem de `LOVABLE_IMAGE_MODEL` quando o projeto define; sem isso a
 * função tenta a lista abaixo em ordem e para no primeiro que o gateway aceita.
 *
 * Os ids abaixo são os que o próprio gateway lista hoje (03/11/2026, perguntado ao
 * agente do Lovable, que consultou a lista de modelos com a chave do projeto). Os
 * dois ids "-preview" que estavam aqui deixaram de existir. Só entram os modelos
 * que falam pelo endpoint de chat com `modalities`, que é o que esta função usa:
 * os GPT Image e o Gemini 3.1 Flash Lite Image só atendem em /v1/images/generations.
 */

export const GATEWAY_DE_IMAGEM = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const MODELOS_DE_IMAGEM = [
  // Nano Banana 2: o que a documentação do Lovable indica para mockups.
  "google/gemini-3.1-flash-image",
  "google/gemini-2.5-flash-image",
  // Nano Banana Pro: o melhor com texto na imagem, e o mais caro; só entra se os outros falharem.
  "google/gemini-3-pro-image",
] as const;
export const BUCKET_DE_FOTOS = "produtos-fotos";
export const PASTA_DAS_GERADAS = "ia";
const PAPEIS_QUE_GERAM = ["admin", "gestor"];
const TEMPO_LIMITE_MS = 60_000;
const TAMANHO_MAXIMO_BYTES = 6 * 1024 * 1024;

export type ProdutoParaFoto = {
  nome: string;
  descricao?: string | null;
  familia?: string | null;
  categoria?: string | null;
};

export type ImagemGerada =
  | { estado: "ok"; bytes: Uint8Array; mime: string; modelo: string }
  | { estado: "sem_ia" }
  | { estado: "sem_saldo" }
  | { estado: "limite" }
  | { estado: "falhou"; detalhe: string };

export type FotoGerada =
  | { estado: "ok"; url: string; modelo: string }
  | Exclude<ImagemGerada, { estado: "ok" }>;

const limpar = (texto: unknown, maximo: number) =>
  typeof texto === "string" ? texto.replace(/\s+/g, " ").trim().slice(0, maximo) : "";

/** O pedido que vai para a IA, nas palavras do catálogo. Também é o que a tela oferece para copiar. */
export function promptDaFotoDoProduto(p: ProdutoParaFoto): string {
  const nome = limpar(p.nome, 120);
  const familia = limpar(p.familia, 80);
  const descricao = limpar(p.descricao, 300);
  return [
    "Foto de catálogo para uma gráfica de comunicação visual (Bex Print, Macapá).",
    `Produto: ${nome}.`,
    familia ? `Família: ${familia}.` : "",
    descricao ? `Como é: ${descricao}.` : "",
    "Mostre o produto pronto, de frente, centralizado, em fundo branco liso de estúdio, luz suave, sem pessoas, sem texto solto e sem marca d'água.",
    "Onde couber impressão, aplique a marca \"BEX PRINT\" em azul-marinho (#121f3b) com um detalhe verde-água (#0ebfa6), como se fosse um trabalho impresso de exemplo.",
    "Imagem quadrada, realista e nítida.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** "image/png" vira "png"; tipo estranho vira "png" também. */
export function extensaoDoMime(mime: string): string {
  const m = /^image\/([a-z0-9]+)/i.exec(mime);
  const ext = (m?.[1] ?? "png").toLowerCase();
  return ext === "jpeg" ? "jpg" : ext;
}

/** Onde a imagem vem na resposta do gateway (formato OpenAI com `images`, ou parte de conteúdo). */
export function urlDaImagemNaResposta(corpo: unknown): string | null {
  const mensagem = (corpo as { choices?: { message?: Record<string, unknown> }[] })?.choices?.[0]?.message;
  if (!mensagem) return null;
  const imagens = mensagem.images as { image_url?: { url?: string } }[] | undefined;
  const direta = imagens?.[0]?.image_url?.url;
  if (typeof direta === "string" && direta) return direta;
  const conteudo = mensagem.content;
  if (Array.isArray(conteudo)) {
    for (const parte of conteudo as { type?: string; image_url?: { url?: string } }[]) {
      const url = parte?.image_url?.url;
      if (typeof url === "string" && url) return url;
    }
  }
  return null;
}

/** data:image/png;base64,... vira bytes. Qualquer outra coisa devolve nulo. */
export function bytesDaDataUrl(url: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(url);
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(Buffer.from(m[2].replace(/\s/g, ""), "base64"));
    return bytes.length > 0 ? { bytes, mime: m[1].toLowerCase() } : null;
  } catch {
    return null;
  }
}

/** Erro do gateway que quer dizer "esse modelo não existe aqui": vale tentar o próximo da lista. */
function modeloRecusado(status: number, corpo: string): boolean {
  return (status === 400 || status === 404) && /model/i.test(corpo);
}

/**
 * O coração: pede a imagem ao gateway e devolve os bytes. Sem framework, para o
 * teste exercitar com um `fetch` falso.
 */
export async function gerarImagemPeloGateway(
  prompt: string,
  chave: string | undefined,
  buscar: typeof fetch = fetch,
  modelos: readonly string[] = MODELOS_DE_IMAGEM,
): Promise<ImagemGerada> {
  if (!chave) return { estado: "sem_ia" };
  if (modelos.length === 0) return { estado: "falhou", detalhe: "nenhum modelo de imagem configurado" };

  let ultimoDetalhe = "";
  for (const modelo of modelos) {
    const controle = new AbortController();
    const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
    let resposta: Response;
    try {
      resposta = await buscar(GATEWAY_DE_IMAGEM, {
        method: "POST",
        headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelo,
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
        signal: controle.signal,
      });
    } catch {
      return { estado: "falhou", detalhe: "o serviço de IA não respondeu" };
    } finally {
      clearTimeout(limite);
    }

    if (resposta.status === 429) return { estado: "limite" };
    if (resposta.status === 402) return { estado: "sem_saldo" };
    if (!resposta.ok) {
      const texto = await resposta.text().catch(() => "");
      if (modeloRecusado(resposta.status, texto)) {
        ultimoDetalhe = `o gateway não aceitou o modelo ${modelo}`;
        continue;
      }
      return { estado: "falhou", detalhe: `o serviço de IA respondeu HTTP ${resposta.status}` };
    }

    let corpo: unknown;
    try {
      corpo = await resposta.json();
    } catch {
      return { estado: "falhou", detalhe: "resposta da IA ilegível" };
    }
    const url = urlDaImagemNaResposta(corpo);
    if (!url) {
      // O modelo respondeu só com texto (recusa, ou formato que este não devolve): vale o próximo.
      ultimoDetalhe = "a IA respondeu sem imagem";
      continue;
    }

    let imagem = bytesDaDataUrl(url);
    if (!imagem && /^https?:\/\//i.test(url)) {
      // Alguns modelos devolvem um endereço em vez do conteúdo: baixa uma vez e segue igual.
      try {
        const baixada = await buscar(url);
        if (!baixada.ok) return { estado: "falhou", detalhe: "não consegui baixar a imagem gerada" };
        const mime = baixada.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
        imagem = { bytes: new Uint8Array(await baixada.arrayBuffer()), mime };
      } catch {
        return { estado: "falhou", detalhe: "não consegui baixar a imagem gerada" };
      }
    }
    if (!imagem) return { estado: "falhou", detalhe: "a imagem veio num formato que não entendo" };
    if (imagem.bytes.byteLength > TAMANHO_MAXIMO_BYTES) {
      return { estado: "falhou", detalhe: "a imagem gerada passou de 6 MB" };
    }
    return { estado: "ok", bytes: imagem.bytes, mime: imagem.mime, modelo };
  }
  return { estado: "falhou", detalhe: ultimoDetalhe || "nenhum modelo de imagem respondeu" };
}

/** A lista de modelos a tentar: o do projeto primeiro, se houver. */
export function modelosParaTentar(doAmbiente: string | undefined): string[] {
  const escolhido = limpar(doAmbiente, 80);
  return escolhido ? [escolhido, ...MODELOS_DE_IMAGEM.filter((m) => m !== escolhido)] : [...MODELOS_DE_IMAGEM];
}

export const gerarFotoDoProduto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { produtoId: string }) => input)
  .handler(async ({ data, context }): Promise<FotoGerada> => {
    const produtoId = limpar(data.produtoId, 64);
    if (!/^[0-9a-f-]{36}$/i.test(produtoId)) throw new Error("Produto inválido.");

    const { data: papeis, error: erroPapeis } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (erroPapeis) throw new Error("Não foi possível conferir o seu perfil. Tente de novo.");
    if (!(papeis ?? []).some((p) => PAPEIS_QUE_GERAM.includes(String(p.role)))) {
      throw new Error("Gerar foto de produto é de administrador e gerência.");
    }

    // A view operacional: nome, família e descrição, sem preço nem custo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: produto, error: erroProduto } = await (context.supabase as any)
      .from("produtos_operacional")
      .select("id, nome, descricao, familia, categoria")
      .eq("id", produtoId)
      .maybeSingle();
    if (erroProduto) throw new Error("Não foi possível ler o produto.");
    if (!produto) throw new Error("Produto não encontrado.");

    const imagem = await gerarImagemPeloGateway(
      promptDaFotoDoProduto(produto as ProdutoParaFoto),
      process.env.LOVABLE_API_KEY,
      fetch,
      modelosParaTentar(process.env.LOVABLE_IMAGE_MODEL),
    );
    if (imagem.estado !== "ok") return imagem;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const caminho = `${PASTA_DAS_GERADAS}/${produtoId}/${Date.now()}.${extensaoDoMime(imagem.mime)}`;
    const { error: erroEnvio } = await supabaseAdmin.storage
      .from(BUCKET_DE_FOTOS)
      .upload(caminho, imagem.bytes, { contentType: imagem.mime, cacheControl: "31536000", upsert: false });
    if (erroEnvio) return { estado: "falhou", detalhe: "a imagem foi gerada mas não consegui guardar no armazenamento" };

    const url = supabaseAdmin.storage.from(BUCKET_DE_FOTOS).getPublicUrl(caminho).data.publicUrl;
    const { error: erroGravacao } = await supabaseAdmin.from("produtos").update({ imagem_url: url }).eq("id", produtoId);
    if (erroGravacao) return { estado: "falhou", detalhe: "a imagem subiu mas o produto não aceitou a foto" };

    return { estado: "ok", url, modelo: imagem.modelo };
  });

/** A foto veio da IA? (pela pasta no endereço; sem coluna nova no banco.) */
export function fotoFoiGerada(url: string | null | undefined): boolean {
  return !!url && url.includes(`/${BUCKET_DE_FOTOS}/${PASTA_DAS_GERADAS}/`);
}

/** O que a tela diz para cada estado que não é "ok". */
export function mensagemDaFotoGerada(r: Exclude<FotoGerada, { estado: "ok" }>): string {
  switch (r.estado) {
    case "sem_ia":
      return "A IA não está ligada neste projeto. Copie o pedido, gere a imagem fora e envie pelo botão Enviar foto.";
    case "sem_saldo":
      return "O saldo de IA do projeto acabou. Reponha o crédito no Lovable ou envie a foto à mão.";
    case "limite":
      return "Muitas fotos seguidas. Espere um minuto e tente de novo.";
    default:
      return `Não deu para gerar a foto: ${r.detalhe}.`;
  }
}
