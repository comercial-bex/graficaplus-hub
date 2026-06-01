import { supabase } from "@/integrations/supabase/client";

export type BaixaResult = {
  ok: boolean;
  message: string;
  movimentos: number;
  faltantes: { material: string; necessario: number; disponivel: number }[];
};

/**
 * Reduz o estoque dos materiais consumidos por todos os itens de uma OS.
 * Usa o mapeamento produto_materiais para saber quanto cada produto consome.
 * Itens sem produto_id ou produtos sem materiais cadastrados são ignorados.
 */
export async function baixarEstoqueDaOS(
  osId: string,
  userId: string | null,
): Promise<BaixaResult> {
  // 1. OS já baixada?
  const { data: os } = await supabase
    .from("ordens_servico")
    .select("id, numero, estoque_baixado")
    .eq("id", osId)
    .single();
  if (!os) return { ok: false, message: "OS não encontrada", movimentos: 0, faltantes: [] };
  if (os.estoque_baixado)
    return {
      ok: false,
      message: `OS #${os.numero} já teve estoque baixado anteriormente.`,
      movimentos: 0,
      faltantes: [],
    };

  // 2. Itens com produto vinculado
  const { data: itens } = await supabase
    .from("itens_os")
    .select("id, produto_id, quantidade")
    .eq("os_id", osId);
  const comProduto = (itens ?? []).filter((i: any) => i.produto_id);
  if (comProduto.length === 0)
    return {
      ok: false,
      message:
        "Nenhum item desta OS está vinculado a um produto do catálogo. Adicione itens via 'Catálogo' para habilitar a baixa.",
      movimentos: 0,
      faltantes: [],
    };

  // 3. Mapear materiais consumidos
  const produtoIds = [...new Set(comProduto.map((i: any) => i.produto_id))];
  const { data: mapeamentos } = await supabase
    .from("produto_materiais" as any)
    .select("produto_id, material_id, quantidade_por_unidade")
    .in("produto_id", produtoIds);

  if (!mapeamentos || mapeamentos.length === 0)
    return {
      ok: false,
      message: "Os produtos desta OS não têm materiais cadastrados.",
      movimentos: 0,
      faltantes: [],
    };

  // 4. Calcular total por material
  const consumo = new Map<string, number>();
  for (const item of comProduto) {
    const qtdItem = Number(item.quantidade);
    const maps = (mapeamentos as any[]).filter((m) => m.produto_id === item.produto_id);
    for (const m of maps) {
      const total = qtdItem * Number(m.quantidade_por_unidade);
      consumo.set(m.material_id, (consumo.get(m.material_id) ?? 0) + total);
    }
  }

  // 5. Verificar estoque disponível
  const materialIds = [...consumo.keys()];
  const { data: materiais } = await supabase
    .from("materiais")
    .select("id, nome, estoque, unidade")
    .in("id", materialIds);

  const faltantes: BaixaResult["faltantes"] = [];
  for (const m of materiais ?? []) {
    const necessario = consumo.get((m as any).id) ?? 0;
    const disponivel = Number((m as any).estoque ?? 0);
    if (disponivel < necessario) {
      faltantes.push({ material: (m as any).nome, necessario, disponivel });
    }
  }
  if (faltantes.length > 0) {
    return {
      ok: false,
      message: `Estoque insuficiente para ${faltantes.length} material(is).`,
      movimentos: 0,
      faltantes,
    };
  }

  // 6. Aplicar baixa
  let movimentos = 0;
  for (const [materialId, quantidade] of consumo.entries()) {
    const material = (materiais ?? []).find((m: any) => m.id === materialId) as any;
    const novoEstoque = Number(material?.estoque ?? 0) - quantidade;
    await supabase.from("materiais").update({ estoque: novoEstoque }).eq("id", materialId);
    await supabase.from("movimentacoes_estoque").insert({
      material_id: materialId,
      tipo: "saida",
      quantidade,
      os_id: osId,
      usuario_id: userId,
      observacao: `Baixa automática — OS #${os.numero}`,
    });
    movimentos++;
  }
  await supabase
    .from("ordens_servico")
    .update({ estoque_baixado: true, estoque_baixado_em: new Date().toISOString() })
    .eq("id", osId);

  return {
    ok: true,
    message: `Baixa realizada: ${movimentos} material(is) atualizado(s).`,
    movimentos,
    faltantes: [],
  };
}
