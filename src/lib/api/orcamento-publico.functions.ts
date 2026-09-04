import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Link público do orçamento.
 *
 * O token é um UUID impossível de adivinhar gravado no próprio orçamento; ele
 * é a credencial do cliente. Como não existe sessão do outro lado, a leitura e
 * a aprovação usam o cliente administrativo — sempre filtrando pelo token e
 * devolvendo só o que o cliente pode ver.
 */

type ArtePublica = { url: string; nome: string };

export type OrcamentoPublico = {
  numero: number | string;
  titulo: string;
  status: string;
  cliente: string;
  emissao: string | null;
  validade: string | null;
  entrega: string | null;
  total: number;
  desconto: number;
  soma_area: number | null;
  aprovado_em: string | null;
  aprovado_por_nome: string | null;
  empresa: { nome: string; telefones: string | null; email: string | null };
  itens: {
    descricao: string;
    unidade: string | null;
    quantidade: number;
    largura: number | null;
    altura: number | null;
    area_total: number | null;
    acabamento: string | null;
    valor_unitario: number;
    valor_total: number;
    artes: ArtePublica[];
  }[];
};

/** Cria (ou reaproveita) o token do link do cliente. */
export const gerarLinkPublicoOrcamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orcamentoId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: orc, error } = await context.supabase
      .from("orcamentos")
      .select("id, token_publico")
      .eq("id", data.orcamentoId)
      .single();
    if (error || !orc) throw new Error("Orçamento não encontrado");

    let token = (orc as { token_publico: string | null }).token_publico;
    if (!token) {
      token = crypto.randomUUID();
      const { error: erroUpdate } = await context.supabase
        .from("orcamentos")
        .update({ token_publico: token } as never)
        .eq("id", data.orcamentoId);
      if (erroUpdate) throw new Error("Não foi possível gerar o link do cliente");
    }
    return { token };
  });

export const obterOrcamentoPublico = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ data }): Promise<OrcamentoPublico> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: orc } = await supabaseAdmin
      .from("orcamentos")
      .select("*")
      .eq("token_publico", data.token)
      .maybeSingle();
    if (!orc) throw new Error("Link inválido ou expirado");

    const o = orc as Record<string, any>;

    const [{ data: itens }, { data: cliente }, { data: empresa }] = await Promise.all([
      supabaseAdmin.from("orcamento_itens").select("*").eq("orcamento_id", o.id).order("ordem"),
      o.cliente_id
        ? supabaseAdmin.from("clientes").select("nome, razao_social").eq("id", o.cliente_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin.from("empresa_config").select("*").limit(1).maybeSingle(),
    ]);

    const listaItens = (itens ?? []) as Record<string, any>[];
    const idsItens = listaItens.map((i) => i.id as string);

    const artesPorItem = new Map<string, ArtePublica[]>();
    if (idsItens.length > 0) {
      const { data: vinculos } = await supabaseAdmin
        .from("orcamento_item_arquivos")
        .select("item_id, arquivo_id, capa, ordem")
        .in("item_id", idsItens)
        .order("capa", { ascending: false })
        .order("ordem");

      const ids = [...new Set(((vinculos ?? []) as any[]).map((v) => v.arquivo_id as string))];
      const arquivos = ids.length
        ? ((await supabaseAdmin.from("arquivos").select("id, nome, caminho").in("id", ids)).data ??
          [])
        : [];
      const porId = new Map<string, { nome: string; caminho: string }>();
      for (const a of arquivos as any[]) porId.set(a.id, { nome: a.nome, caminho: a.caminho });

      for (const v of (vinculos ?? []) as any[]) {
        const arq = porId.get(v.arquivo_id);
        if (!arq) continue;
        const { data: assinada } = await supabaseAdmin.storage
          .from("arquivos-clientes")
          .createSignedUrl(arq.caminho, 3600);
        if (!assinada?.signedUrl) continue;
        const lista = artesPorItem.get(v.item_id) ?? [];
        lista.push({ url: assinada.signedUrl, nome: arq.nome });
        artesPorItem.set(v.item_id, lista);
      }
    }

    const somaArea = listaItens.reduce((s, i) => s + Number(i.area_total ?? 0), 0);
    const emp = (empresa ?? {}) as Record<string, any>;
    const c = (cliente ?? {}) as Record<string, any>;

    return {
      numero: o.numero,
      titulo: o.titulo,
      status: o.status,
      cliente: c.razao_social ?? c.nome ?? o.contato_nome ?? "Cliente",
      emissao: o.created_at ?? null,
      validade: o.created_at
        ? new Date(new Date(o.created_at).getTime() + (o.validade_dias ?? 7) * 86400000).toISOString()
        : null,
      entrega: o.data_entrega_prometida ?? o.prazo ?? null,
      total: Number(o.valor_total ?? 0),
      desconto: Number(o.valor_subtotal ?? o.valor_total ?? 0) - Number(o.valor_total ?? 0),
      soma_area: somaArea > 0 ? somaArea : null,
      aprovado_em: o.aprovado_em ?? null,
      aprovado_por_nome: o.aprovado_por_nome ?? null,
      empresa: {
        nome: emp.razao_social ?? emp.nome ?? "Bex Print",
        telefones: emp.telefones ?? emp.telefone ?? null,
        email: emp.email ?? null,
      },
      itens: listaItens.map((i) => ({
        descricao: String(i.descricao ?? ""),
        unidade: i.unidade ?? null,
        quantidade: Number(i.quantidade ?? 0),
        largura: i.largura != null ? Number(i.largura) : null,
        altura: i.altura != null ? Number(i.altura) : null,
        area_total: i.area_total != null ? Number(i.area_total) : null,
        acabamento: i.acabamento ?? null,
        valor_unitario: Number(i.valor_unitario ?? 0),
        valor_total: Number(i.valor_total ?? 0),
        artes: artesPorItem.get(i.id as string) ?? [],
      })),
    };
  });

export const responderOrcamentoPublico = createServerFn({ method: "POST" })
  .inputValidator((input: {
    token: string;
    decisao: "aprovado" | "ajuste";
    nome: string;
    observacao?: string;
  }) => {
    if (!input.token) throw new Error("Link inválido");
    if (!input.nome || input.nome.trim().length < 3) {
      throw new Error("Informe seu nome completo para registrar a resposta");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: orc } = await supabaseAdmin
      .from("orcamentos")
      .select("id, status, observacoes")
      .eq("token_publico", data.token)
      .maybeSingle();
    if (!orc) throw new Error("Link inválido ou expirado");
    const o = orc as Record<string, any>;
    if (o.status === "convertido") throw new Error("Este orçamento já virou Ordem de Serviço");

    const ip =
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      getRequestHeader("cf-connecting-ip") ??
      null;

    const agora = new Date().toISOString();
    const observacaoCliente = data.observacao?.trim()
      ? `${o.observacoes ? `${o.observacoes}\n` : ""}[${new Date().toLocaleString("pt-BR")}] ${data.nome}: ${data.observacao.trim()}`
      : o.observacoes;

    const patch =
      data.decisao === "aprovado"
        ? {
            status: "aprovado",
            aprovado_em: agora,
            aprovado_por_nome: data.nome.trim(),
            aprovado_ip: ip,
            observacoes: observacaoCliente,
          }
        : { status: "rejeitado", observacoes: observacaoCliente };

    const { error } = await supabaseAdmin
      .from("orcamentos")
      .update(patch as never)
      .eq("id", o.id);
    if (error) throw new Error("Não foi possível registrar sua resposta");

    return { ok: true, status: patch.status };
  });
