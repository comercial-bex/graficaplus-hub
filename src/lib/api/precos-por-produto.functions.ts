import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { avaliar, mensagemDoPedido, type LinhaDePreco } from "@/domain/precos/painel-de-precos";
import {
  COLUNAS_DO_CUSTO_REAL,
  COLUNAS_DO_PRECO_MINIMO,
  lerCustoReal,
  mensagemDoCustoRealAusente,
  mensagemDoPrecoMinimoAusente,
  type CustoRealDoProduto,
} from "@/domain/precos/custo-real";
import type { ParametrosDoMinimo, TaxasDeVenda } from "@/domain/precos/preco-minimo";

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

/** Máquina e preço de concorrente são mais fechados que o custo: financeiro.read ou impressao3d.cost.read. */
async function verCustoDeMaquina(supabase: Banco, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("pode_ver_custo_de_maquina", { _user_id: userId });
  if (error) return false;
  return data === true;
}

/** Mesma porta da tabela de concorrentes: financeiro.read. Falha ao perguntar vale como não. */
async function verFinanceiro(supabase: Banco, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_see_financials", { _user_id: userId });
  if (error) return false;
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

/** Um item de custo que a casa ainda precisa preencher, confirmar ou corrigir. Vem de pendencias_de_custo. */
export type PendenciaDeCusto = { codigo: string; rotulo: string; tipo: string };

export type PainelPorProduto = {
  linhas: LinhaDePreco[];
  podePropor: boolean;
  /** Frase humana quando o banco ainda não entrega o custo real. Nulo quando está tudo ligado. */
  avisoDoCustoReal: string | null;
  /** Frase humana quando o banco ainda não entrega o preço mínimo recomendado. Nulo quando está ligado. */
  avisoDoMinimo: string | null;
  /** Ocupação alvo e multiplicador que o banco usou, para o texto da tela. Nulos quando o banco não os entrega. */
  parametrosDoMinimo: ParametrosDoMinimo;
  pendencias: PendenciaDeCusto[];
};

/** Imposto sobre a venda e taxa do cartão. Falha na leitura devolve nulo: a tela não inventa taxa. */
async function lerTaxas(admin: Banco): Promise<TaxasDeVenda | null> {
  const { data, error } = await admin
    .from("custos_tabela")
    .select("codigo, valor")
    .eq("ativo", true)
    .in("codigo", ["impostos_venda", "taxa_cartao"]);
  if (error || !Array.isArray(data)) return null;
  const valor = (codigo: string) => {
    const l = (data as Array<{ codigo: string; valor: unknown }>).find((x) => x.codigo === codigo);
    return num(l?.valor) ?? 0;
  };
  // Código ausente conta zero, como no banco: COALESCE(max(valor), 0).
  return { impostoVendaPct: valor("impostos_venda"), taxaCartaoPct: valor("taxa_cartao") };
}

/**
 * Menor preço de venda final anotado por produto. Só o tipo "final": o preço de terceirizado dos concorrentes
 * não se compara com o balcão. Falha na leitura devolve mapa vazio: a marca some e a tela continua.
 */
async function lerMenoresConcorrentes(admin: Banco): Promise<Map<string, number>> {
  const menores = new Map<string, number>();
  try {
    const { data, error } = await admin
      .from("produto_concorrentes")
      .select("produto_id, preco, tipo_preco")
      .eq("tipo_preco", "final");
    if (error || !Array.isArray(data)) return menores;
    for (const c of data as Array<Record<string, unknown>>) {
      if (c.tipo_preco !== "final") continue;
      const preco = num(c.preco);
      if (preco == null || !Number.isFinite(preco) || preco <= 0) continue;
      const id = String(c.produto_id);
      const atual = menores.get(id);
      if (atual == null || preco < atual) menores.set(id, preco);
    }
  } catch {
    return new Map();
  }
  return menores;
}

export const lerPrecosPorProduto = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PainelPorProduto> => {
    const { supabase, userId } = context as { supabase: Banco; userId: string };
    await exigirVerCusto(supabase, userId);
    const podePropor = await quemPropoe(supabase, userId);
    // A leitura abaixo usa a chave do servidor e ignora a RLS. Por isso a composição (máquina) e o concorrente
    // só saem para quem a RLS deixaria ler. Quem só tem custos.read abre a tela, mas sem essas duas coisas.
    const comMaquina = await verCustoDeMaquina(supabase, userId);
    const comConcorrente = await verFinanceiro(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as Banco;
    const { data, error } = await admin
      .from("produtos")
      .select("id, nome, familia, unidade, custo_medio, preco_base, margem_minima, preco_parceiro")
      .eq("ativo", true)
      .order("nome");
    if (error) throw new Error(error.message);
    // Custo cheio e a composição em reais. Sem as colunas da composição, cai para só o custo cheio.
    type Cheio = { custo_cheio: number | null; composicao: LinhaDePreco["composicao"] };
    let { data: cheios, error: erroCheio } = await admin
      .from("produto_custo_cheio")
      .select(
        "produto_id, custo_cheio, custo_material, custo_maquina, custo_mao_obra, custo_indireto",
      );
    if (erroCheio) {
      const segunda = await admin.from("produto_custo_cheio").select("produto_id, custo_cheio");
      cheios = segunda.data;
      erroCheio = segunda.error;
    }
    if (erroCheio) throw new Error(erroCheio.message);
    const cheio = new Map<string, Cheio>(
      ((cheios ?? []) as Array<Record<string, unknown>>).map((c) => {
        const partes = [c.custo_material, c.custo_maquina, c.custo_mao_obra, c.custo_indireto].map(
          num,
        );
        const inteira = partes.every((v) => v != null && Number.isFinite(v));
        return [
          String(c.produto_id),
          {
            custo_cheio: num(c.custo_cheio),
            composicao:
              inteira && comMaquina
                ? {
                    material: partes[0] as number,
                    maquina: partes[1] as number,
                    maoDeObra: partes[2] as number,
                    indireto: partes[3] as number,
                  }
                : null,
          },
        ];
      }),
    );
    const concorrente = comConcorrente
      ? await lerMenoresConcorrentes(admin)
      : new Map<string, number>();

    // Custo real, da visão fechada para a chave do servidor. Visão ou coluna ausente vira frase humana.
    // O preço mínimo vem em colunas novas no fim da visão: sem elas, a leitura cai para as colunas de antes.
    const reais = new Map<string, CustoRealDoProduto>();
    let avisoDoCustoReal: string | null = null;
    let avisoDoMinimo: string | null = null;
    let { data: dosReais, error: erroReal } = await admin
      .from("produto_custo_real")
      .select([...COLUNAS_DO_CUSTO_REAL, ...COLUNAS_DO_PRECO_MINIMO].join(", "));
    if (erroReal) {
      const semMinimo = mensagemDoPrecoMinimoAusente(String(erroReal.message ?? ""));
      if (semMinimo != null) {
        const segunda = await admin
          .from("produto_custo_real")
          .select(COLUNAS_DO_CUSTO_REAL.join(", "));
        if (!segunda.error) avisoDoMinimo = semMinimo;
        dosReais = segunda.data;
        erroReal = segunda.error;
      }
    }
    if (erroReal) {
      const humana = mensagemDoCustoRealAusente(String(erroReal.message ?? ""));
      if (humana == null) throw new Error(erroReal.message);
      avisoDoCustoReal = humana;
    } else {
      for (const r of (dosReais ?? []) as Array<Record<string, unknown>>)
        reais.set(String(r.produto_id), lerCustoReal(r));
    }

    const taxas = avisoDoCustoReal == null ? await lerTaxas(admin) : null;
    const dosParametros = [...reais.values()];
    const parametrosDoMinimo: ParametrosDoMinimo = {
      ocupacaoAlvoPct: dosParametros.find((r) => r.ocupacao_alvo_pct != null)?.ocupacao_alvo_pct ?? null,
      multiplicador:
        dosParametros.find((r) => r.multiplicador_regra_de_tres != null)
          ?.multiplicador_regra_de_tres ?? null,
    };

    // Itens de custo pendentes. Falha aqui não derruba a tela: sem a função, a lista sai vazia.
    let pendencias: PendenciaDeCusto[] = [];
    const { data: dasPendencias, error: erroPendencias } = await admin.rpc("pendencias_de_custo");
    if (!erroPendencias) {
      pendencias = ((dasPendencias ?? []) as Array<Record<string, unknown>>).map((p) => ({
        codigo: String(p.codigo ?? ""),
        rotulo: String(p.rotulo ?? p.codigo ?? ""),
        tipo: String(p.tipo ?? ""),
      }));
    }

    const linhas: LinhaDePreco[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      nome: String(r.nome ?? ""),
      familia: (r.familia as string | null) ?? null,
      unidade: String(r.unidade ?? "un"),
      custo: num(r.custo_medio),
      custo_cheio: cheio.get(String(r.id))?.custo_cheio ?? null,
      preco: num(r.preco_base),
      margem_minima: num(r.margem_minima),
      preco_parceiro: num(r.preco_parceiro),
      real: reais.get(String(r.id)) ?? null,
      taxas,
      composicao: cheio.get(String(r.id))?.composicao ?? null,
      menor_concorrente: concorrente.get(String(r.id)) ?? null,
    }));
    return { linhas, podePropor, avisoDoCustoReal, avisoDoMinimo, parametrosDoMinimo, pendencias };
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
