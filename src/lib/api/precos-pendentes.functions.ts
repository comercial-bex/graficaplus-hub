import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CATEGORIA_DA_MEDIA_M2,
  REFERENCIA_M2,
  mediaPrecoM2,
  type PropostaDePreco,
} from "@/domain/precos/propostas";

/**
 * Preços pendentes de aprovação, do lado do servidor.
 *
 * A leitura e a decisão passam pelo navegador DE QUEM PEDIU (context.supabase): a RLS de
 * precos_propostas e as funções preco_proposta_aprovar e preco_proposta_recusar conferem a pessoa
 * de novo no banco, porque usam auth.uid(). Aqui o servidor confere antes, para devolver uma frase
 * clara em vez de um código de erro. Margem e custo são privados: quem não vê custo não lê nada.
 * Nada aqui toca em orçamento nem manda mensagem a cliente.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as funções novas ainda não estão nos tipos gerados
type Banco = any;

async function verCusto(supabase: Banco, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("pode_ver_custo", { _user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}

async function temPapel(supabase: Banco, userId: string, papel: "admin" | "gestor"): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: papel });
  if (error) throw new Error(error.message);
  return data === true;
}

async function exigirVerCusto(supabase: Banco, userId: string) {
  if (!(await verCusto(supabase, userId))) {
    throw new Error("Seu perfil não vê custo e margem, por isso não abre esta tela.");
  }
}

async function exigirQuemDecide(supabase: Banco, userId: string) {
  await exigirVerCusto(supabase, userId);
  const ehAdmin = await temPapel(supabase, userId, "admin");
  const ehGestor = ehAdmin ? true : await temPapel(supabase, userId, "gestor");
  if (!ehGestor) throw new Error("Só administrador ou gerente decide preço.");
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export type PainelDePrecos = {
  propostas: PropostaDePreco[];
  podeDecidir: boolean;
  referencia: number;
  mediaM2: { media: number; quantidade: number } | null;
};

export const lerPrecosPendentes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PainelDePrecos> => {
    const { supabase, userId } = context as { supabase: Banco; userId: string };
    await exigirVerCusto(supabase, userId);
    const podeDecidir = (await temPapel(supabase, userId, "admin")) || (await temPapel(supabase, userId, "gestor"));

    const { data, error } = await supabase
      .from("vw_precos_propostas")
      .select(
        "id, produto_id, produto_nome, unidade, preco_atual, preco_proposto, custo, piso, margem_minima, margem_atual, margem_proposta, motivo, origem, created_at",
      )
      .eq("status", "pendente")
      .order("produto_nome");
    if (error) throw new Error(error.message);

    // A média do metro quadrado de impressão: só preço de venda, nunca custo.
    // Lida com a chave do servidor, depois da conferência acima: a tabela de produtos limita a coluna de preço por papel.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: m2, error: erroM2 } = await (supabaseAdmin as Banco)
      .from("produtos")
      .select("preco_base")
      .eq("ativo", true)
      .eq("categoria", CATEGORIA_DA_MEDIA_M2)
      .in("unidade", ["m2", "m²"]);
    if (erroM2) throw new Error(erroM2.message);

    const propostas: PropostaDePreco[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      produto_id: String(r.produto_id),
      produto_nome: String(r.produto_nome ?? ""),
      unidade: (r.unidade as string | null) ?? null,
      preco_atual: Number(r.preco_atual),
      preco_proposto: Number(r.preco_proposto),
      custo: num(r.custo),
      piso: num(r.piso),
      margem_minima: num(r.margem_minima),
      margem_atual: num(r.margem_atual),
      margem_proposta: num(r.margem_proposta),
      motivo: String(r.motivo ?? ""),
      origem:
        r.origem === "referencia_m2" ? "referencia_m2" : r.origem === "manual" ? "manual" : "abaixo_do_piso",
      created_at: String(r.created_at ?? ""),
    }));

    return {
      propostas,
      podeDecidir,
      referencia: REFERENCIA_M2,
      mediaM2: mediaPrecoM2(((m2 ?? []) as Array<{ preco_base: unknown }>).map((x) => num(x.preco_base))),
    };
  });

export const aprovarPrecoProposto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: Banco; userId: string };
    await exigirQuemDecide(supabase, userId);
    const { error } = await supabase.rpc("preco_proposta_aprovar", { p_id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const recusarPrecoProposto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), nota: z.string().trim().min(3, "Escreva o motivo, com pelo menos 3 letras.").max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: Banco; userId: string };
    await exigirQuemDecide(supabase, userId);
    const { error } = await supabase.rpc("preco_proposta_recusar", { p_id: data.id, p_nota: data.nota });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
