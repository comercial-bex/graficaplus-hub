import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Decoracao, LinhaDoTrofeu } from "@/domain/trofeus/conta";
import type { CatalogoParaFicha, ModeloParaComparar } from "@/domain/trofeus/ficha-comparar";
import {
  argumentosDaResposta,
  faltaSaldo,
  motorDaFicha,
  pedidoParaOProvedor,
  TIPOS_DE_IMAGEM,
  type EntradaDaLeitura,
  type Motor,
} from "@/domain/trofeus/ficha-ia";
import { lerBlocoDaFicha, normalizarFichaDaIa, temBlocoDaFicha, type FichaLida, type OrigemDaLeitura } from "@/domain/trofeus/ficha-lida";

/**
 * LER A FICHA DO TROFÉU (22/11/2026), do lado do servidor. As regras moram em `src/domain/trofeus/ficha-lida.ts`,
 * `ficha-ia.ts` e `ficha-comparar.ts`.
 *
 * Fala só com quem orça: a permissão (`orcamentos.create`, a mesma de gravar o troféu) é conferida ANTES de qualquer
 * leitura do banco e antes de gastar uma chamada de IA. O resultado é só uma SUGESTÃO para pré-preencher a calculadora:
 * nada é gravado aqui e preço nenhum é lido nem devolvido (o preço continua sendo de `cotarTrofeu`).
 *
 * Três caminhos, do mais barato ao mais caro:
 *   1. bloco FICHA-BEX colado, sem imagem: lido por regra (`lerBlocoDaFicha`), sem IA, sem custo, sem chave;
 *   2. imagem (com ou sem texto): modelo de visão com a chave da AGÊNCIA (Claude, depois OpenAI; nunca o saldo do Lovable);
 *   3. texto livre sem bloco (o pedido do cliente): o mesmo modelo, só com texto.
 * A imagem não é guardada: vai ao provedor, volta como campos e se perde.
 */

const SEM_PERMISSAO = "A leitura da ficha é de quem cria orçamentos.";
const FALHA_GENERICA = "Não consegui ler a ficha agora. Tente de novo; se continuar, avise a gerência.";
const TEMPO_LIMITE_MS = 60_000;
const TEXTO_MAXIMO = 12_000;
/** ~5 MB de imagem em base64. A tela reduz a imagem antes de mandar; isto é a trava do servidor. */
const BASE64_MAXIMO = 7_000_000;

const entradaDaFicha = z
  .object({
    texto: z.string().max(TEXTO_MAXIMO).optional(),
    imagem: z
      .object({ tipo: z.enum(TIPOS_DE_IMAGEM), base64: z.string().min(200).max(BASE64_MAXIMO).regex(/^[A-Za-z0-9+/=\r\n]+$/) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((d) => (d.texto ?? "").trim().length >= 5 || !!d.imagem, { message: "vazio" });

export type EntradaDeLerFicha = z.input<typeof entradaDaFicha>;

function frasesDoZod(erro: z.ZodError): string {
  const p = erro.issues[0];
  if (!p) return "Confira a ficha enviada.";
  if (p.code === "unrecognized_keys") return "Confira a ficha enviada: campo não aceito.";
  const campo = String(p.path[p.path.length - 1] ?? "");
  if (campo === "base64" && p.code === "too_big") return "A imagem é grande demais. Use uma de até 5 MB.";
  if (campo === "base64") return "A imagem não pôde ser lida. Tente outra.";
  if (campo === "tipo") return "Use uma imagem PNG, JPEG ou WEBP.";
  if (campo === "texto" && p.code === "too_big") return `O texto colado passa de ${TEXTO_MAXIMO.toLocaleString("pt-BR")} caracteres.`;
  if (p.code === "custom") return "Cole o bloco FICHA-BEX ou anexe a imagem da ficha.";
  return "Confira a ficha enviada.";
}

export type ResultadoDaFicha =
  | {
      estado: "ok";
      origem: OrigemDaLeitura;
      ficha: FichaLida;
      avisos: string[];
      duvidas: string[];
      /** Quem leu a imagem, só para a tela dizer. Nulo quando foi o bloco, sem IA. */
      motor: "claude" | "openai" | null;
      catalogo: CatalogoParaFicha;
    }
  | { estado: "sem_ia" }
  | { estado: "limite" }
  | { estado: "sem_saldo" }
  | { estado: "falhou"; detalhe: string };

type ResultadoDaIa =
  | { estado: "ok"; ficha: FichaLida; avisos: string[]; duvidas: string[] }
  | { estado: "sem_ia" }
  | { estado: "limite" }
  | { estado: "sem_saldo" }
  | { estado: "falhou"; detalhe: string };

/** O coração da leitura por IA, sem framework: é o que o teste exercita, com a rede injetada. */
export async function lerFichaComIa(entrada: EntradaDaLeitura, motor: Motor | null, buscar: typeof fetch = fetch): Promise<ResultadoDaIa> {
  if (!motor) return { estado: "sem_ia" };
  const pedido = pedidoParaOProvedor(motor, entrada);
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resposta: Response;
  try {
    resposta = await buscar(pedido.url, { method: "POST", headers: pedido.cabecalhos, body: JSON.stringify(pedido.corpo), signal: controle.signal });
  } catch {
    return { estado: "falhou", detalhe: "o serviço de IA não respondeu a tempo" };
  } finally {
    clearTimeout(limite);
  }
  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    if (faltaSaldo(resposta.status, texto)) return { estado: "sem_saldo" };
    if (resposta.status === 429) return { estado: "limite" };
    if (resposta.status === 401 || resposta.status === 403) return { estado: "falhou", detalhe: "o provedor da IA recusou a chave da agência" };
    return { estado: "falhou", detalhe: `o serviço de IA respondeu HTTP ${resposta.status}` };
  }
  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    return { estado: "falhou", detalhe: "resposta da IA ilegível" };
  }
  const lido = normalizarFichaDaIa(argumentosDaResposta(motor.provedor, corpo));
  if (!lido) return { estado: "falhou", detalhe: "a IA não conseguiu ler dados de troféu nesta ficha" };
  return { estado: "ok", ...lido };
}

// ---------------------------------------------------------------------------------------------------------
// O catálogo para comparar: só nomes e medidas
// ---------------------------------------------------------------------------------------------------------

type Resposta = { data: unknown; error: { message?: string } | null };
interface Consulta extends PromiseLike<Resposta> {
  select(colunas: string): Consulta;
  eq(coluna: string, valor: unknown): Consulta;
  in(coluna: string, valores: unknown[]): Consulta;
  order(coluna: string): Consulta;
  maybeSingle(): PromiseLike<Resposta>;
}
interface Banco {
  from(tabela: string): Consulta;
}

const linhas = <T>(r: Resposta): T[] => (Array.isArray(r.data) ? (r.data as T[]) : []);
const numero = (v: unknown): number => Number(v);

/** Lê o catálogo com a chave de serviço. Só chamar DEPOIS de conferir a permissão. Nunca lê custo nem multiplicador. */
async function lerOCatalogo(db: Banco): Promise<CatalogoParaFicha> {
  const [rModelos, rRegras, rMateriais] = await Promise.all([
    db.from("trofeu_modelos").select("id, nome, linha, altura_referencia_m").eq("ativo", true).order("nome"),
    db.from("trofeu_regras").select("altura_minima_m, altura_maxima_m, espessura_maxima_de_corte_mm").eq("unica", true).maybeSingle(),
    db.from("materiais").select("id, nome, espessura_mm, status, unidade"),
  ]);
  for (const r of [rModelos, rRegras, rMateriais]) if (r.error) throw new Error(r.error.message ?? "falha ao ler");
  const modelos = linhas<{ id: string; nome: string; linha: LinhaDoTrofeu; altura_referencia_m: unknown }>(rModelos);
  const rPecas = modelos.length ? await db.from("trofeu_pecas").select("modelo_id, ordem, nome, material_id, espessura_mm, largura_m, altura_m, quantidade, decoracao").in("modelo_id", modelos.map((m) => m.id)).order("ordem") : { data: [], error: null };
  if (rPecas.error) throw new Error(rPecas.error.message ?? "falha ao ler");

  const regras = rRegras.data as { altura_minima_m?: unknown; altura_maxima_m?: unknown; espessura_maxima_de_corte_mm?: unknown } | null;
  if (!regras) throw new Error("regras do troféu ausentes");
  const materiais = linhas<{ id: string; nome: string; espessura_mm: unknown; status: unknown; unidade?: unknown }>(rMateriais);
  const nomeDe = new Map(materiais.map((m) => [m.id, m.nome]));
  const pecas = linhas<{ modelo_id: string; nome: string; material_id: string; espessura_mm: unknown; largura_m: unknown; altura_m: unknown; quantidade: unknown; decoracao: Decoracao }>(rPecas);

  const paraComparar: ModeloParaComparar[] = modelos.map((m) => ({
    id: m.id,
    nome: m.nome,
    linha: m.linha,
    alturaReferenciaCm: Math.round(numero(m.altura_referencia_m) * 1000) / 10,
    pecas: pecas
      .filter((p) => p.modelo_id === m.id)
      .map((p) => ({
        nome: p.nome,
        material: nomeDe.get(p.material_id) ?? "Material sem nome",
        espessuraMm: numero(p.espessura_mm),
        larguraCm: Math.round(numero(p.largura_m) * 1000) / 10,
        alturaCm: Math.round(numero(p.altura_m) * 1000) / 10,
        quantidade: numero(p.quantidade),
        decoracao: p.decoracao,
      })),
  }));
  return {
    modelos: paraComparar,
    // Só materiais ativos: o que está inativo no cadastro é como se não existisse. Sem olhar estoque.
    materiais: materiais
      .filter((m) => m.status === "ativo" || m.status == null)
      .map((m) => ({ id: m.id, nome: m.nome, espessuraMm: m.espessura_mm == null ? null : numero(m.espessura_mm), unidade: typeof m.unidade === "string" ? m.unidade : null })),
    alturaMinimaCm: Math.round(numero(regras.altura_minima_m) * 1000) / 10,
    alturaMaximaCm: Math.round(numero(regras.altura_maxima_m) * 1000) / 10,
    espessuraMaximaDeCorteMm: numero(regras.espessura_maxima_de_corte_mm),
  };
}

// ---------------------------------------------------------------------------------------------------------
// A função do servidor
// ---------------------------------------------------------------------------------------------------------

export const lerFichaDoTrofeu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const r = entradaDaFicha.safeParse(d);
    if (!r.success) throw new Error(frasesDoZod(r.error));
    return r.data;
  })
  .handler(async ({ data, context }): Promise<ResultadoDaFicha> => {
    // 1) Permissão primeiro: sem ela nada é lido e nenhuma chamada de IA é feita.
    const { data: pode, error: erroDePermissao } = await (context.supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<Resposta> }).rpc("has_permission", {
      _user_id: context.userId,
      _permission: "orcamentos.create",
    });
    if (erroDePermissao) {
      console.error("[lerFichaDoTrofeu] has_permission falhou:", erroDePermissao.message ?? "");
      throw new Error("Não foi possível conferir o seu perfil. Tente de novo.");
    }
    if (pode !== true) throw new Error(SEM_PERMISSAO);

    // 2) O catálogo, só com nomes e medidas.
    let catalogo: CatalogoParaFicha;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      catalogo = await lerOCatalogo(supabaseAdmin as unknown as Banco);
    } catch (e) {
      console.error("[lerFichaDoTrofeu] falha ao ler o catálogo:", e instanceof Error ? e.message : "");
      throw new Error(FALHA_GENERICA);
    }

    const texto = (data.texto ?? "").trim();

    // 3) Bloco colado e nenhuma imagem: regra pura, sem IA.
    if (!data.imagem && texto && temBlocoDaFicha(texto)) {
      const bloco = lerBlocoDaFicha(texto);
      if (!bloco.ok) return { estado: "falhou", detalhe: bloco.erro };
      return { estado: "ok", origem: "bloco", ficha: bloco.ficha, avisos: bloco.avisos, duvidas: [], motor: null, catalogo };
    }

    // 4) Imagem (ou texto livre): a IA da agência.
    const motor = motorDaFicha(process.env);
    const leitura = await lerFichaComIa({ texto: texto || null, imagem: data.imagem ?? null }, motor);
    if (leitura.estado !== "ok") return leitura;
    return {
      estado: "ok",
      origem: data.imagem ? "imagem" : "texto",
      ficha: leitura.ficha,
      avisos: leitura.avisos,
      duvidas: leitura.duvidas,
      motor: motor?.provedor === "anthropic" ? "claude" : "openai",
      catalogo,
    };
  });
