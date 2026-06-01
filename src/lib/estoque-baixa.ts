import { supabase } from "@/integrations/supabase/client";

export type LinhaConsumo = {
  material_id: string;
  material_nome: string;
  unidade: string;
  estoque_atual: number;
  quantidade_prevista: number;
  // Detalhamento de onde veio (para tooltip/explicação)
  origens: { produto_nome: string; qtd_item: number; consumo_por_unidade: number }[];
};

export type PlanoBaixa = {
  ok: boolean;
  motivo?: string;
  os_numero?: number;
  ja_baixada?: boolean;
  linhas: LinhaConsumo[];
};

/**
 * Calcula o consumo de materiais previsto para uma OS, sem aplicar nenhuma
 * alteração. Usado para preview e edição antes do "Baixar estoque".
 */
export async function calcularConsumoPrevisto(osId: string): Promise<PlanoBaixa> {
  const { data: os } = await supabase
    .from("ordens_servico")
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

  const { data: itens } = await supabase
    .from("itens_os")
    .select("id, produto_id, quantidade, descricao")
    .eq("os_id", osId);
  const comProduto = (itens ?? []).filter((i: any) => i.produto_id);
  if (comProduto.length === 0)
    return {
      ok: false,
      motivo:
        "Nenhum item desta OS está vinculado a um produto do catálogo. Adicione itens pelo botão 'Catálogo' para habilitar a baixa.",
      os_numero: os.numero,
      linhas: [],
    };

  const produtoIds = [...new Set(comProduto.map((i: any) => i.produto_id))];
  const [{ data: produtos }, { data: mapeamentos }] = await Promise.all([
    supabase.from("produtos").select("id, nome").in("id", produtoIds),
    supabase
      .from("produto_materiais" as any)
      .select("produto_id, material_id, quantidade_por_unidade")
      .in("produto_id", produtoIds),
  ]);

  if (!mapeamentos || mapeamentos.length === 0)
    return {
      ok: false,
      motivo:
        "Os produtos desta OS não têm materiais cadastrados. Edite o produto e adicione os materiais consumidos.",
      os_numero: os.numero,
      linhas: [],
    };

  // Agrupar consumo por material com proveniência
  const acumulador = new Map<
    string,
    { quantidade: number; origens: LinhaConsumo["origens"] }
  >();
  for (const item of comProduto) {
    const qtdItem = Number(item.quantidade);
    const produtoNome =
      (produtos ?? []).find((p: any) => p.id === item.produto_id)?.nome ??
      (item as any).descricao ??
      "—";
    const maps = (mapeamentos as any[]).filter((m) => m.produto_id === item.produto_id);
    for (const m of maps) {
      const consumoPorUn = Number(m.quantidade_por_unidade);
      const total = qtdItem * consumoPorUn;
      const prev = acumulador.get(m.material_id) ?? { quantidade: 0, origens: [] };
      prev.quantidade += total;
      prev.origens.push({
        produto_nome: produtoNome,
        qtd_item: qtdItem,
        consumo_por_unidade: consumoPorUn,
      });
      acumulador.set(m.material_id, prev);
    }
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
  userId: string | null,
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

  const { data: os } = await supabase
    .from("ordens_servico")
    .select("id, numero, estoque_baixado")
    .eq("id", osId)
    .single();
  if (!os) return { ok: false, mensagem: "OS não encontrada", movimentos: 0, insuficientes: [] };
  if (os.estoque_baixado)
    return {
      ok: false,
      mensagem: `OS #${os.numero} já teve estoque baixado.`,
      movimentos: 0,
      insuficientes: [],
    };

  const materialIds = ativos.map((a) => a.material_id);
  const { data: materiais } = await supabase
    .from("materiais")
    .select("id, nome, estoque, unidade")
    .in("id", materialIds);

  // Validação dura: nenhum estoque pode ficar < 0
  const insuficientes: ResultadoBaixa["insuficientes"] = [];
  for (const a of ativos) {
    const m = (materiais ?? []).find((x: any) => x.id === a.material_id) as any;
    const disponivel = Number(m?.estoque ?? 0);
    if (disponivel < a.quantidade) {
      insuficientes.push({
        material: m?.nome ?? "(material removido)",
        necessario: a.quantidade,
        disponivel,
      });
    }
  }
  if (insuficientes.length > 0) {
    return {
      ok: false,
      mensagem: `Operação bloqueada: ${insuficientes.length} material(is) ficaria(m) abaixo de zero.`,
      movimentos: 0,
      insuficientes,
    };
  }

  // Aplicar
  let movimentos = 0;
  for (const a of ativos) {
    const m = (materiais ?? []).find((x: any) => x.id === a.material_id) as any;
    const novoEstoque = Number(m?.estoque ?? 0) - a.quantidade;
    await supabase.from("materiais").update({ estoque: novoEstoque }).eq("id", a.material_id);
    await supabase.from("movimentacoes_estoque").insert({
      material_id: a.material_id,
      tipo: "saida",
      quantidade: a.quantidade,
      os_id: osId,
      usuario_id: userId,
      observacao: `Baixa por OS #${os.numero}`,
    });
    movimentos++;
  }
  await supabase
    .from("ordens_servico")
    .update({ estoque_baixado: true, estoque_baixado_em: new Date().toISOString() })
    .eq("id", osId);

  return {
    ok: true,
    mensagem: `${movimentos} material(is) baixado(s) com sucesso.`,
    movimentos,
    insuficientes: [],
  };
}
