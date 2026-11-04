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
 * Revisão de 03/11/2026 (o lote ainda não tinha gerado nenhuma foto de verdade):
 *   - quem tem foto não é gerado de novo: foto enviada à mão nunca é trocada pela
 *     IA, e a gerada só é trocada quando a pessoa pede "Gerar outra". A leitura da
 *     foto atual vem ANTES de pagar a geração, e a gravação só troca se a foto
 *     ainda é a que foi lida (outra pessoa pode ter enviado a real no meio);
 *   - serviço (Deslocamento, Ilhós na lona...) não leva foto gerada, como a nota
 *     "Pronto para a IA" já dizia;
 *   - a imagem que subiu e não foi gravada, e a gerada que a nova substitui, saem
 *     do armazenamento (a gerada só sai se nenhum outro produto aponta para ela:
 *     "duplicar produto" copia o endereço da foto);
 *   - o pedido pode vir com o texto que a tela mostra (nome, família, descrição),
 *     para "o pedido que a IA recebe" ser exatamente o que a IA recebe.
 *
 * Segunda rodada, 04/11/2026 (revisão do PR 428):
 *   - o produto é RESERVADO no banco (produto_foto_reservas) antes de pagar a IA, e a reserva sai ao fim
 *     (também em erro): duas abas, dois administradores ou o lote mais o botão da pasta pagavam a mesma
 *     foto duas vezes. Quem chega com o produto reservado recebe "em_andamento", sem gastar nada. Reserva
 *     de mais de 5 minutos (a chamada que a fez morreu) não segura ninguém;
 *   - perder a gravação depois de pagar é "mudou_no_meio" (a imagem é descartada e a mensagem diz que o saldo
 *     foi gasto), não "já tem foto";
 *   - erro ao gravar o produto pode ser só a resposta que se perdeu, com o UPDATE já feito: o banco é relido
 *     antes de apagar o arquivo, e na dúvida o arquivo fica.
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
  /** "servico" não leva foto gerada. */
  tipo?: string | null;
};

/** O texto do pedido que a tela mostra; vale sobre o salvo no banco. */
export type TextosDoPedido = { nome?: string | null; descricao?: string | null; familia?: string | null };

export type ImagemGerada =
  | { estado: "ok"; bytes: Uint8Array; mime: string; modelo: string }
  | { estado: "sem_ia" }
  | { estado: "sem_saldo" }
  | { estado: "limite" }
  | { estado: "falhou"; detalhe: string };

export type FotoGerada =
  | { estado: "ok"; url: string; modelo: string }
  /** Já tem foto (enviada à mão, ou gerada e a pessoa não pediu outra): nada foi gasto. */
  | { estado: "ja_tem_foto" }
  /** Serviço não leva foto gerada: nada foi gasto. */
  | { estado: "servico" }
  /** Outra pessoa ou outra aba já está gerando a foto deste produto (reserva no banco): nada foi gasto. */
  | { estado: "em_andamento" }
  /** A IA desenhou e a foto do produto mudou enquanto isso: a imagem nova foi descartada. O saldo foi gasto. */
  | { estado: "mudou_no_meio" }
  | Exclude<ImagemGerada, { estado: "ok" }>;

export type DecisaoDaFoto = "gerar" | "servico" | "ja_tem_foto";

/**
 * O que fazer antes de gastar saldo de IA. Serviço não leva foto. Sem foto, gera.
 * Com foto, só gera de novo quando a atual é uma gerada E a pessoa pediu "outra":
 * foto enviada à mão nunca é trocada pela IA.
 */
export function decidirGeracao(p: { tipo?: string | null; imagem_url?: string | null }, substituir: boolean): DecisaoDaFoto {
  if (p.tipo === "servico") return "servico";
  const atual = (p.imagem_url ?? "").trim();
  if (!atual) return "gerar";
  return substituir && fotoFoiGerada(atual) ? "gerar" : "ja_tem_foto";
}

/**
 * O pedido usa o texto que a tela mostrou, quando ela mandou (a pessoa pode ter mexido na
 * descrição e ainda não salvo), e o salvo no banco quando não mandou. Nome vazio na tela não
 * vale: não existe produto sem nome.
 */
export function produtoDoPedido(salvo: ProdutoParaFoto, textos?: TextosDoPedido | null): ProdutoParaFoto {
  const da = (chave: keyof TextosDoPedido): string | null | undefined =>
    textos && Object.prototype.hasOwnProperty.call(textos, chave) ? textos[chave] : salvo[chave];
  const nome = limpar(da("nome"), 120) ? (da("nome") as string) : salvo.nome;
  return { ...salvo, nome, descricao: da("descricao"), familia: da("familia") };
}

/**
 * "…/object/public/produtos-fotos/ia/<id>/<arquivo>" vira "ia/<id>/<arquivo>". Só devolve o
 * caminho de arquivo gerado DESTE produto: foto enviada à mão e arquivo de outro produto
 * nunca são removidos por aqui.
 */
export function caminhoDaFotoGerada(url: string | null | undefined, produtoId: string): string | null {
  if (!url) return null;
  const marca = `/${BUCKET_DE_FOTOS}/${PASTA_DAS_GERADAS}/${produtoId}/`;
  const i = url.indexOf(marca);
  if (i < 0) return null;
  const arquivo = url.slice(i + marca.length).split(/[?#]/)[0];
  if (!arquivo || arquivo.includes("/") || arquivo.includes("..")) return null;
  return `${PASTA_DAS_GERADAS}/${produtoId}/${arquivo}`;
}

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

/** Só o que a gravação precisa do cliente de serviço; o teste passa um falso. */
export type GravadorDeFotos = {
  storage: {
    from: (bucket: string) => {
      upload: (
        caminho: string,
        bytes: Uint8Array,
        opcoes: { contentType: string; cacheControl: string; upsert: boolean },
      ) => PromiseLike<{ error: unknown }>;
      getPublicUrl: (caminho: string) => { data: { publicUrl: string } };
      remove: (caminhos: string[]) => PromiseLike<unknown>;
    };
  };
  // O construtor de consultas do cliente de verdade é genérico demais para descrever aqui.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (tabela: string) => any;
};

/**
 * Guarda a imagem gerada: sobe o arquivo, troca `produtos.imagem_url` SÓ se a foto ainda é a que foi
 * lida antes de pagar a geração, e limpa o que ficaria sem dono (o arquivo novo se a troca não valeu,
 * a gerada anterior se nenhum outro produto aponta para ela).
 */
export async function guardarFotoGerada(a: {
  admin: GravadorDeFotos;
  produtoId: string;
  /** A foto que o produto tinha quando foi lido ("" ou nulo = sem foto). */
  fotoLida: string | null;
  imagem: { bytes: Uint8Array; mime: string; modelo: string };
  agora?: () => number;
  sufixoUnico?: () => string;
}): Promise<FotoGerada> {
  const { admin, produtoId, imagem } = a;
  const fotoLida = a.fotoLida ?? "";
  const baldes = admin.storage.from(BUCKET_DE_FOTOS);
  // Limpeza é de boa-fé: arquivo que sobra no armazenamento não é motivo para dizer que a foto falhou.
  const tirarDoArmazenamento = async (caminhos: string[]) => {
    try {
      await baldes.remove(caminhos);
    } catch {
      /* sobra um arquivo; a próxima geração não depende disso */
    }
  };
  // Nome único mesmo para duas gerações no mesmo milissegundo.
  const sufixo = (a.sufixoUnico ?? (() => crypto.randomUUID().slice(0, 8)))();
  const caminho = `${PASTA_DAS_GERADAS}/${produtoId}/${(a.agora ?? Date.now)()}-${sufixo}.${extensaoDoMime(imagem.mime)}`;

  const { error: erroEnvio } = await baldes.upload(caminho, imagem.bytes, {
    contentType: imagem.mime,
    cacheControl: "31536000",
    upsert: false,
  });
  if (erroEnvio) return { estado: "falhou", detalhe: "a imagem foi gerada mas não consegui guardar no armazenamento" };

  const url = baldes.getPublicUrl(caminho).data.publicUrl;

  // Só troca se a foto ainda é a que foi lida: se outra pessoa enviou a real (ou outra geração
  // terminou) enquanto a IA desenhava, a gravação não acha a linha e nada é sobrescrito.
  const troca = admin.from("produtos").update({ imagem_url: url }).eq("id", produtoId);
  const { data: gravados, error: erroGravacao } = await (fotoLida.trim()
    ? troca.eq("imagem_url", fotoLida)
    : troca.or("imagem_url.is.null,imagem_url.eq.")
  ).select("id");
  if (erroGravacao) {
    // Erro ambíguo: a rede pode ter perdido só a RESPOSTA, com o UPDATE já feito. Olha o banco antes de apagar o
    // arquivo que a linha talvez já aponte; se nem a leitura funciona, o arquivo fica (sobrar um arquivo é inofensivo).
    const { data: atual, error: erroLeitura } = await admin.from("produtos").select("imagem_url").eq("id", produtoId).maybeSingle();
    if (erroLeitura) return { estado: "falhou", detalhe: "não consegui confirmar se o produto aceitou a foto" };
    if (atual && String(atual.imagem_url ?? "") === url) return { estado: "ok", url, modelo: imagem.modelo };
    await tirarDoArmazenamento([caminho]);
    return { estado: "falhou", detalhe: "a imagem subiu mas o produto não aceitou a foto" };
  }
  if ((gravados ?? []).length === 0) {
    // A foto do produto mudou enquanto a IA desenhava (e a IA já foi paga): o arquivo novo não tem produto e sai.
    await tirarDoArmazenamento([caminho]);
    return { estado: "mudou_no_meio" };
  }

  // A gerada anterior deste produto sai do armazenamento, se nenhum outro produto aponta para ela
  // ("duplicar produto" copia o endereço da foto).
  const anterior = caminhoDaFotoGerada(fotoLida, produtoId);
  if (anterior) {
    try {
      const { data: outros, error: erroOutros } = await admin
        .from("produtos")
        .select("id")
        .eq("imagem_url", fotoLida)
        .neq("id", produtoId)
        .limit(1);
      // Na dúvida (a consulta falhou) o arquivo fica: apagar o que outro produto usa é pior que sobrar um.
      if (!erroOutros && (outros ?? []).length === 0) await tirarDoArmazenamento([anterior]);
    } catch {
      /* sem a resposta não se apaga nada */
    }
  }
  return { estado: "ok", url, modelo: imagem.modelo };
}

/** Uma reserva de mais de 5 minutos é de uma chamada que morreu sem liberar: não segura ninguém. */
export const RESERVA_VALE_MS = 5 * 60_000;
export const TABELA_DE_RESERVAS = "produto_foto_reservas";

/**
 * Reserva o produto no banco antes de pagar a IA. A chave primária é o produto: o segundo a chegar leva
 * 23505 e recebe "em_andamento". Sem a reserva, duas abas ou duas pessoas pagavam a mesma foto duas vezes.
 */
export async function reservarGeracao(
  admin: GravadorDeFotos,
  produtoId: string,
  usuarioId: string | null,
  agora: () => number = Date.now,
): Promise<{ estado: "reservado" } | { estado: "em_andamento" } | { estado: "falhou"; detalhe: string }> {
  try {
    await admin
      .from(TABELA_DE_RESERVAS)
      .delete()
      .eq("produto_id", produtoId)
      .lt("reservado_em", new Date(agora() - RESERVA_VALE_MS).toISOString());
    const { error } = await admin.from(TABELA_DE_RESERVAS).insert({ produto_id: produtoId, por: usuarioId });
    if (!error) return { estado: "reservado" };
    if ((error as { code?: string }).code === "23505") return { estado: "em_andamento" };
    return { estado: "falhou", detalhe: "não consegui reservar o produto para gerar a foto" };
  } catch {
    return { estado: "falhou", detalhe: "não consegui reservar o produto para gerar a foto" };
  }
}

/** Solta a reserva (também quando a geração falha): reserva esquecida bloquearia o produto até vencer. */
export async function liberarGeracao(admin: GravadorDeFotos, produtoId: string): Promise<void> {
  try {
    await admin.from(TABELA_DE_RESERVAS).delete().eq("produto_id", produtoId);
  } catch {
    /* a reserva vence sozinha em 5 minutos */
  }
}

export const gerarFotoDoProduto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { produtoId: string; substituir?: boolean; textos?: TextosDoPedido }) => input)
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as GravadorDeFotos;

    // Reserva ANTES de ler e de pagar: com a reserva na mão, a leitura abaixo é a verdade até a gravação.
    const reserva = await reservarGeracao(admin, produtoId, context.userId);
    if (reserva.estado !== "reservado") return reserva;
    try {
      // A view operacional: nome, família, descrição, tipo e a foto de agora, sem preço nem custo.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: produto, error: erroProduto } = await (context.supabase as any)
        .from("produtos_operacional")
        .select("id, nome, descricao, familia, categoria, tipo, imagem_url")
        .eq("id", produtoId)
        .maybeSingle();
      if (erroProduto) throw new Error("Não foi possível ler o produto.");
      if (!produto) throw new Error("Produto não encontrado.");

      // Antes de pagar a geração: serviço não leva foto, e quem já tem foto não é gerado de novo.
      const decisao = decidirGeracao(produto as { tipo?: string | null; imagem_url?: string | null }, data.substituir === true);
      if (decisao !== "gerar") return { estado: decisao };

      const imagem = await gerarImagemPeloGateway(
        promptDaFotoDoProduto(produtoDoPedido(produto as ProdutoParaFoto, data.textos)),
        process.env.LOVABLE_API_KEY,
        fetch,
        modelosParaTentar(process.env.LOVABLE_IMAGE_MODEL),
      );
      if (imagem.estado !== "ok") return imagem;

      return await guardarFotoGerada({
        admin,
        produtoId,
        fotoLida: String((produto as { imagem_url?: string | null }).imagem_url ?? ""),
        imagem,
      });
    } finally {
      await liberarGeracao(admin, produtoId);
    }
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
    case "ja_tem_foto":
      return "Este produto já tem foto, e a IA não troca a que já existe. Remova a atual e salve para gerar outra.";
    case "servico":
      return "Serviço não leva foto gerada: a tabela usa o ícone do serviço. Se quiser uma foto, envie pelo botão Enviar foto.";
    case "em_andamento":
      return "Outra pessoa ou outra aba já está gerando a foto deste produto: espere ela chegar.";
    case "mudou_no_meio":
      return "A foto do produto mudou enquanto a IA desenhava (outra pessoa ou outra aba): a imagem nova foi descartada e o saldo desta geração foi gasto à toa.";
    default: {
      // Um estado que esta versão da tela não conhece nunca pode virar "undefined" na mensagem.
      const detalhe = (r as { detalhe?: string }).detalhe;
      return detalhe ? `Não deu para gerar a foto: ${detalhe}.` : "Não deu para gerar a foto: resposta inesperada do servidor.";
    }
  }
}
