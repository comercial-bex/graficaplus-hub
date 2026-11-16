import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { avaliar, mensagemDoPedido, type LinhaDePreco } from "@/domain/precos/painel-de-precos";

/**
 * Preços por produto, do lado do servidor.
 *
 * Quem não vê custo não lê nada. A leitura usa a chave do servidor só depois dessa conferência, porque a
 * tabela de produtos limita as colunas de custo e preço por papel. Pedir preço NUNCA grava preço: chama
 * preco_proposta_criar com a sessão de quem pediu, e a proposta cai na fila de /precos-pendentes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as funções novas ainda não estão nos tipos gerados
type Banco = any;

async function verCusto(supabase: Banco, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("pode_ver_custo", { _user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}

async function temPapel(
  supabase: Banco,
  userId: string,
  papel: "admin" | "gestor",
): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: papel });
  if (error) throw new Error(error.message);
  return data === true;
}

async function quemPropoe(supabase: Banco, userId: string): Promise<boolean> {
  return (
    (await temPapel(supabase, userId, "admin")) || (await temPapel(supabase, userId, "gestor"))
  );
}

async function exigirVerCusto(supabase: Banco, userId: string) {
  if (!(await verCusto(supabase, userId))) {
    throw new Error("Seu perfil não vê custo e margem, por isso não abre esta tela.");
  }
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export type PainelPorProduto = {
  linhas: LinhaDePreco[];
  podePropor: boolean;
};

export const lerPrecosPorProduto = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PainelPorProduto> => {
    const { supabase, userId } = context as { supabase: Banco; userId: string };
    await exigirVerCusto(supabase, userId);
    const podePropor = await quemPropoe(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as Banco;
    const { data, error } = await admin
      .from("produtos")
      .select("id, nome, familia, unidade, custo_medio, preco_base, margem_minima, preco_parceiro")
      .eq("ativo", true)
      .order("nome");
    if (error) throw new Error(error.message);
    const { data: cheios, error: erroCheio } = await admin
      .from("produto_custo_cheio")
      .select("produto_id, custo_cheio");
    if (erroCheio) throw new Error(erroCheio.message);
    const cheio = new Map<string, number | null>(
      ((cheios ?? []) as Array<{ produto_id: string; custo_cheio: unknown }>).map((c) => [
        c.produto_id,
        num(c.custo_cheio),
      ]),
    );

    const linhas: LinhaDePreco[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      nome: String(r.nome ?? ""),
      familia: (r.familia as string | null) ?? null,
      unidade: String(r.unidade ?? "un"),
      custo: num(r.custo_medio),
      custo_cheio: cheio.get(String(r.id)) ?? null,
      preco: num(r.preco_base),
      margem_minima: num(r.margem_minima),
      preco_parceiro: num(r.preco_parceiro),
    }));
    return { linhas, podePropor };
  });

export const proporPreco = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        produtoId: z.string().uuid(),
        preco: z.number().positive("Digite um preço maior que zero.").max(1_000_000),
        motivo: z.string().trim().max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: Banco; userId: string };
    await exigirVerCusto(supabase, userId);
    if (!(await quemPropoe(supabase, userId)))
      throw new Error("Só administrador ou gerente pede mudança de preço.");
    // As mesmas regras da tela, conferidas aqui: quem chama a função direto não pula o motivo nem o balcão.
    const preco = Math.round(data.preco * 100) / 100;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p, error: erroProduto } = await (supabaseAdmin as Banco)
      .from("produtos")
      .select("custo_medio, margem_minima, preco_parceiro")
      .eq("id", data.produtoId)
      .maybeSingle();
    if (erroProduto) throw new Error(erroProduto.message);
    if (!p) throw new Error("Produto não encontrado.");
    const a = avaliar(
      {
        custo: num(p.custo_medio),
        margem_minima: num(p.margem_minima),
        preco_parceiro: num(p.preco_parceiro),
      },
      preco,
    );
    if (a.parceiroAcima) throw new Error("O preço do parceiro ficaria acima do balcão. Isso não pode.");
    if (a.situacao === "abaixo" && data.motivo.length < 3)
      throw new Error("Abaixo do piso o motivo é obrigatório.");
    const motivo =
      data.motivo === "" ? "Ajuste de preço pedido na tela de preços por produto." : data.motivo;
    const { data: id, error } = await supabase.rpc("preco_proposta_criar", {
      p_produto_id: data.produtoId,
      p_preco: preco,
      p_motivo: motivo,
    });
    if (error) throw new Error(mensagemDoPedido(String(error.message ?? "")));
    return { ok: true as const, id: String(id) };
  });
