import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";

export type LinhaConsumo = {
  material_id: string;
  material_nome: string;
  unidade: string;
  estoque_atual: number;
  quantidade_prevista: number;
  // De que item veio e quanto (a previsão da OS já conta área e peças)
  origens: { produto_nome: string; quantidade: number }[];
};

export type PlanoBaixa = {
  ok: boolean;
  motivo?: string;
  os_numero?: number;
  ja_baixada?: boolean;
  linhas: LinhaConsumo[];
};

/**
 * O consumo de materiais previsto para uma OS, sem aplicar nenhuma alteração.
 * Usado para preview e edição antes do "Baixar estoque".
 */
export async function calcularConsumoPrevisto(osId: string): Promise<PlanoBaixa> {
  const { data: os } = await fromFinancialView("ordens_servico", false)
    .select("id, numero, estoque_baixado")
    .eq("id", osId)
    .single();
  if (!os) return { ok: false, motivo: "OS não encontrada", linhas: [] };
  if (os.estoque_baixado)
    return {
      ok: false,
      motivo: `OS #${os.numero} já teve estoque baixado anteriormente.`,
      ja_baixada: true,
      os_numero: os.numero,
      linhas: [],
    };

  // A sugestão sai da PREVISÃO da OS (22/10/2026), a mesma que reservou o
  // estoque. Antes ela era refeita aqui como "peças × ficha", sem a área: a OS
  // #164 (banner 1,15 × 1,70 m) tinha 1,955 m² de lona previstos e reservados, a
  // janela sugeriu 1,0, a baixa levou 1,0 — e 0,955 m² ficaram reservados para
  // sempre, porque a OS não aceita uma segunda baixa. A previsão já conta a área
  // e a linha da ficha "por peça" (gerar_materiais_previstos_os).
  const { data: previstos, error: erroPrevistos } = await (supabase as any)
    .from("os_materiais_previstos")
    .select("material_id, os_item_id, quantidade")
    .eq("os_id", osId);
  if (erroPrevistos)
    return {
      ok: false,
      motivo: `Não foi possível ler o material previsto desta OS: ${erroPrevistos.message}`,
      os_numero: os.numero,
      linhas: [],
    };
  if (!previstos || previstos.length === 0)
    return {
      ok: false,
      motivo:
        "Esta OS não tem material previsto. A previsão nasce da ficha técnica do produto quando o item entra na OS: confira se os itens estão ligados a produtos com ficha. (A previsão só aparece para quem vê custo de estoque.)",
      os_numero: os.numero,
      linhas: [],
    };

  const itemIds = [
    ...new Set((previstos as any[]).map((p) => p.os_item_id).filter(Boolean).map(String)),
  ];
  const { data: itens } =
    itemIds.length > 0
      ? await fromFinancialView("itens_os", false).select("id, descricao").in("id", itemIds)
      : { data: [] as any[] };
  const nomeDoItem = new Map(((itens ?? []) as any[]).map((i) => [String(i.id), String(i.descricao ?? "—")]));

  // Agrupar por material, com a proveniência de cada item
  const acumulador = new Map<string, { quantidade: number; origens: LinhaConsumo["origens"] }>();
  for (const p of previstos as any[]) {
    const quantidade = Number(p.quantidade ?? 0);
    const prev = acumulador.get(p.material_id) ?? { quantidade: 0, origens: [] };
    prev.quantidade += quantidade;
    prev.origens.push({ produto_nome: nomeDoItem.get(String(p.os_item_id)) ?? "—", quantidade });
    acumulador.set(p.material_id, prev);
  }

  const materialIds = [...acumulador.keys()];
  const { data: materiais } = await supabase
    .from("materiais")
    .select("id, nome, estoque, unidade")
    .in("id", materialIds);

  const linhas: LinhaConsumo[] = materialIds.map((mid) => {
    const mat = (materiais ?? []).find((m: any) => m.id === mid) as any;
    const acc = acumulador.get(mid)!;
    return {
      material_id: mid,
      material_nome: mat?.nome ?? "(material removido)",
      unidade: mat?.unidade ?? "un",
      estoque_atual: Number(mat?.estoque ?? 0),
      quantidade_prevista: Number(acc.quantidade.toFixed(4)),
      origens: acc.origens,
    };
  });
  linhas.sort((a, b) => a.material_nome.localeCompare(b.material_nome));

  return { ok: true, os_numero: os.numero, linhas };
}

export type AjusteBaixa = { material_id: string; quantidade: number };

export type ResultadoBaixa = {
  ok: boolean;
  mensagem: string;
  movimentos: number;
  /** Linhas que ficariam negativas — sempre vazio quando ok===true */
  insuficientes: {
    material: string;
    necessario: number;
    disponivel: number;
  }[];
};

/**
 * Aplica a baixa real de estoque dado um conjunto de ajustes (quantidades
 * possivelmente editadas pelo operador). Bloqueia se qualquer material
 * ficaria com estoque negativo.
 */
export async function aplicarBaixaEstoque(
  osId: string,
  ajustes: AjusteBaixa[],
  _userId: string | null,
): Promise<ResultadoBaixa> {
  // Filtra zeros — operador pode ter zerado uma linha que não quer baixar
  const ativos = ajustes.filter((a) => a.quantidade > 0);
  if (ativos.length === 0)
    return {
      ok: false,
      mensagem: "Nenhuma quantidade informada para baixar.",
      movimentos: 0,
      insuficientes: [],
    };

  const consumos = ativos.map((a) => ({
    material_id: a.material_id,
    quantidade: a.quantidade,
  }));

  const { data, error } = await (supabase as any).rpc("baixar_estoque_os", {
    p_os_id: osId,
    p_consumos: consumos,
  });

  if (error) {
    return {
      ok: false,
      mensagem: error.message ?? "Falha ao baixar estoque pela RPC transacional.",
      movimentos: 0,
      insuficientes: [],
    };
  }

  const movimentos = Array.isArray(data?.movimentacoes) ? data.movimentacoes.length : 0;

  return {
    ok: true,
    mensagem: `${movimentos} material(is) baixado(s) com sucesso pela RPC transacional.`,
    movimentos,
    insuficientes: [],
  };
}
