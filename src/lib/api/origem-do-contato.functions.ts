import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  produtoDoAnuncio,
  tipoDoAnuncio,
  validarPalavra,
  type ConjuntoDeAnuncio,
  type TipoDeContato,
} from "@/domain/whatsapp/origem-do-contato";

/**
 * Origem do contato: telas de gestão e a etiqueta da conversa.
 *
 * Gestão (configuracoes.manage): o servidor confere a permissão pela sessão de
 * quem pediu e só então chama as funções origem_* do banco, que conferem de
 * novo com require_permission. A leitura passa pela RLS normal. Ninguém grava
 * nas três tabelas direto.
 *
 * Etiqueta da conversa (whatsapp.reply): vai pela função SQL que só o
 * service_role executa, como o resto das ações da caixa.
 *
 * Nada aqui toca em parceiros, clientes, orçamentos ou preço. O tipo é uma
 * etiqueta interna: o cliente nunca vê.
 */

const ID_NUMERICO = z.string().trim().regex(/^\d{6,40}$/, "O id tem só números, de 6 a 40 dígitos.");
const TEXTO_CURTO = z.string().trim().max(200);
const TIPO = z.enum(["cliente_final", "parceiro"]);

async function exigir(supabase: any, userId: string, permissao: string) {
  const { data, error } = await supabase.rpc("has_permission", {
    _user_id: userId,
    _permission: permissao,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Seu perfil não tem a permissão ${permissao.replace(".", " › ")}.`);
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

function vazioVira(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

// ---- leitura -------------------------------------------------------------

export type ConjuntoDaTela = ConjuntoDeAnuncio & {
  campanha_id: string | null;
  campanha_nome: string | null;
  anuncios_ligados: number;
};

export type AnuncioDaTela = {
  anuncio_id: string;
  conjunto_id: string | null;
  nome_interno: string | null;
  titulo_criativo: string | null;
  produto: string | null;
  ultimo_link: string | null;
  primeira_vez: string | null;
  ultima_vez: string | null;
  total_contatos: number;
  ativo: boolean;
  /** Tipo do conjunto ativo do anúncio; nulo quer dizer "tipo a confirmar". */
  tipo_efetivo: TipoDeContato | null;
  motivo_sem_tipo: "ok" | "sem_conjunto" | "conjunto_inativo" | "conjunto_desconhecido";
  produto_efetivo: string | null;
};

export type PalavraDaTela = { palavra: string; ativo: boolean };

const COLUNAS_CONJUNTO = "conjunto_id, nome, campanha_id, campanha_nome, tipo, produto_padrao, ativo";
const COLUNAS_ANUNCIO =
  "anuncio_id, conjunto_id, nome_interno, titulo_criativo, produto, ultimo_link, primeira_vez, ultima_vez, total_contatos, ativo";

async function lerConjuntos(supabase: any): Promise<(Omit<ConjuntoDaTela, "anuncios_ligados">)[]> {
  const { data, error } = await supabase.from("conjuntos_anuncio").select(COLUNAS_CONJUNTO).order("nome");
  if (error) throw new Error(error.message);
  return (data ?? []) as Omit<ConjuntoDaTela, "anuncios_ligados">[];
}

export const listarConjuntos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConjuntoDaTela[]> => {
    await exigir(context.supabase, context.userId, "configuracoes.manage");
    const conjuntos = await lerConjuntos(context.supabase);
    const { data, error } = await (context.supabase as any).from("anuncios_origem").select("conjunto_id");
    if (error) throw new Error(error.message);
    const contagem = new Map<string, number>();
    for (const a of (data ?? []) as { conjunto_id: string | null }[]) {
      if (a.conjunto_id) contagem.set(a.conjunto_id, (contagem.get(a.conjunto_id) ?? 0) + 1);
    }
    return conjuntos.map((c) => ({ ...c, anuncios_ligados: contagem.get(c.conjunto_id) ?? 0 }));
  });

export const listarAnunciosOrigem = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AnuncioDaTela[]> => {
    await exigir(context.supabase, context.userId, "configuracoes.manage");
    const conjuntos = await lerConjuntos(context.supabase);
    const { data, error } = await (context.supabase as any)
      .from("anuncios_origem")
      .select(COLUNAS_ANUNCIO)
      .order("ultima_vez", { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Omit<AnuncioDaTela, "tipo_efetivo" | "motivo_sem_tipo" | "produto_efetivo">[]).map((a) => {
      const { tipo, motivo } = tipoDoAnuncio(a, conjuntos);
      const conjunto = conjuntos.find((c) => c.conjunto_id === a.conjunto_id) ?? null;
      return { ...a, tipo_efetivo: tipo, motivo_sem_tipo: motivo, produto_efetivo: produtoDoAnuncio(a, conjunto) };
    });
  });

export const listarPalavras = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PalavraDaTela[]> => {
    await exigir(context.supabase, context.userId, "configuracoes.manage");
    const { data, error } = await (context.supabase as any)
      .from("palavras_de_origem")
      .select("palavra, ativo")
      .order("palavra");
    if (error) throw new Error(error.message);
    return (data ?? []) as PalavraDaTela[];
  });

// ---- escrita da gestão ---------------------------------------------------

const conjuntoSchema = z.object({
  conjuntoId: ID_NUMERICO,
  nome: z.string().trim().min(1, "Dê um nome ao conjunto.").max(200),
  tipo: TIPO,
  campanhaId: z.string().trim().max(60).nullish(),
  campanhaNome: TEXTO_CURTO.nullish(),
  produtoPadrao: TEXTO_CURTO.nullish(),
  ativo: z.boolean().default(true),
});

export const salvarConjunto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => conjuntoSchema.parse(d))
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "configuracoes.manage");
    const { data: r, error } = await (context.supabase as any).rpc("origem_salvar_conjunto", {
      p_conjunto_id: data.conjuntoId,
      p_nome: data.nome,
      p_tipo: data.tipo,
      p_campanha_id: vazioVira(data.campanhaId),
      p_campanha_nome: vazioVira(data.campanhaNome),
      p_produto_padrao: vazioVira(data.produtoPadrao),
      p_ativo: data.ativo,
    });
    if (error) throw new Error(error.message);
    const d = (r ?? {}) as { tipo_mudou?: boolean; anuncios_ligados?: number };
    return { ok: true as const, tipoMudou: d.tipo_mudou === true, anunciosLigados: d.anuncios_ligados ?? 0 };
  });

/**
 * Liga o anúncio a um conjunto e, se vier, ajusta produto, nome interno e
 * ativo. Campo ausente não muda. conjuntoId nulo tira o anúncio do conjunto
 * (fica "tipo a confirmar"). Trocar o criativo mantendo o id não precisa disto.
 */
const anuncioSchema = z.object({
  anuncioId: ID_NUMERICO,
  conjuntoId: ID_NUMERICO.nullable().optional(),
  produto: TEXTO_CURTO.nullable().optional(),
  nomeInterno: TEXTO_CURTO.nullable().optional(),
  ativo: z.boolean().optional(),
});

export const classificarAnuncio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => anuncioSchema.parse(d))
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "configuracoes.manage");
    const db = context.supabase as any;

    const mudaCadastro = data.produto !== undefined || data.nomeInterno !== undefined || data.ativo !== undefined;
    if (mudaCadastro) {
      // origem_salvar_anuncio regrava os três campos; parte do que já existe.
      const { data: atual, error: erroLeitura } = await db
        .from("anuncios_origem")
        .select("nome_interno, produto, ativo")
        .eq("anuncio_id", data.anuncioId)
        .maybeSingle();
      if (erroLeitura) throw new Error(erroLeitura.message);
      const { error } = await db.rpc("origem_salvar_anuncio", {
        p_anuncio_id: data.anuncioId,
        p_nome_interno: data.nomeInterno !== undefined ? vazioVira(data.nomeInterno) : (atual?.nome_interno ?? null),
        p_produto: data.produto !== undefined ? vazioVira(data.produto) : (atual?.produto ?? null),
        p_ativo: data.ativo ?? atual?.ativo ?? true,
      });
      if (error) throw new Error(error.message);
    }
    if (data.conjuntoId !== undefined) {
      const { error } = await db.rpc("origem_vincular_anuncio", {
        p_anuncio_id: data.anuncioId,
        p_conjunto_id: data.conjuntoId,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const salvarPalavra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        palavra: z.string().max(100),
        ativo: z.boolean().default(true),
        remover: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "configuracoes.manage");
    const v = validarPalavra(data.palavra);
    if (!v.ok) throw new Error(v.erro);
    const db = context.supabase as any;
    const { error } = data.remover
      ? await db.rpc("origem_remover_palavra", { p_palavra: v.palavra })
      : await db.rpc("origem_salvar_palavra", { p_palavra: v.palavra, p_ativo: data.ativo });
    if (error) throw new Error(error.message);
    return { ok: true as const, palavra: v.palavra };
  });

// ---- etiqueta da conversa ------------------------------------------------

/**
 * Marca o tipo do contato na mão, pela caixa. Quem atende (whatsapp.reply).
 * Grava leads.tipo com origem "manual" e o retrato no atendimento ativo. Só
 * lead: cliente já cadastrado recusa, porque o preço segue o cadastro.
 * tipo nulo tira a etiqueta. NÃO muda preço nem cadastro de parceiro.
 */
export const definirTipoDoLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversaId: z.string().uuid(), tipo: TIPO.nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "whatsapp.reply");
    const db = await admin();
    const { data: r, error } = await db.rpc("whatsapp_definir_tipo_do_contato", {
      p_conversa_id: data.conversaId,
      p_usuario: context.userId,
      p_tipo: data.tipo,
    });
    if (error) throw new Error(error.message);
    const d = (r ?? {}) as { lead_id?: string | null; tipo?: string | null; tipo_antes?: string | null };
    return { ok: true as const, leadId: d.lead_id ?? null, tipo: (d.tipo ?? null) as TipoDeContato | null, tipoAntes: d.tipo_antes ?? null };
  });
