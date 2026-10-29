import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  custoDoItem,
  vendaDoItem,
  type ItemDoCatalogo,
  type ItemDoOrcamento,
} from "../src/domain/parceiros/preco";

/**
 * A área exata (29/10/2026) mudou a conta por área nos dois gatilhos de item. Ensaio com rollback inserindo
 * na OS os itens do jeito que a conversão faz: o 150 passaria de R$ 37,50 para R$ 35,70, o 152 de R$ 71,46
 * para R$ 71,44 e o 115 perderia R$ 3,21 — o cliente aprovou um preço e a OS nasceria com outro, enquanto a
 * conta a receber (que copia o total do orçamento) ficaria com o aprovado. Esta migração faz o preço gravado
 * não derivar: o item da OS copia o do orçamento ao nascer, e nenhum dos dois recalcula num UPDATE em que
 * nenhuma entrada do preço mudou.
 */
const SQL = readFileSync("supabase/migrations/20261029300000_preco_gravado_nao_deriva.sql", "utf8");

const funcao = (nome: string) => {
  const inicio = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}()`);
  expect(inicio, `${nome} precisa estar na migração`).toBeGreaterThan(-1);
  return SQL.slice(inicio, SQL.indexOf("END $function$;", inicio));
};

const ENTRADAS_DO_PRECO = [
  "NEW.preco_m2 IS NOT DISTINCT FROM OLD.preco_m2",
  "NEW.largura IS NOT DISTINCT FROM OLD.largura",
  "NEW.altura IS NOT DISTINCT FROM OLD.altura",
  "NEW.quantidade IS NOT DISTINCT FROM OLD.quantidade",
  "NEW.area_minima IS NOT DISTINCT FROM OLD.area_minima",
  "NEW.produto_id IS NOT DISTINCT FROM OLD.produto_id",
];

describe("o preço gravado não deriva", () => {
  it("orçamento: sem mudar nenhuma entrada do preço, o item fica como foi aprovado", () => {
    const f = funcao("tg_item_precificar_por_area");
    expect(f).toContain("IF TG_OP = 'UPDATE'");
    for (const entrada of ENTRADAS_DO_PRECO) expect(f).toContain(entrada);
    expect(f).toContain("NEW.valor_unitario := OLD.valor_unitario;");
    // Só o desconto do item pode mexer no total.
    expect(f).toContain("NEW.valor_total := round(OLD.valor_total + COALESCE(OLD.desconto,0) - COALESCE(NEW.desconto,0), 2);");
    // A conta nova continua para o que nasce e para o que muda.
    expect(f).toContain("round(NEW.largura*NEW.altura,6)");
    expect(f).toContain("v_total_linha := round(v_area_linha * NEW.preco_m2, 2);");
  });

  it("OS: o item que nasce de um item de orçamento copia o que o cliente aprovou", () => {
    const f = funcao("tg_item_os_precificar_por_area");
    expect(f).toContain("IF TG_OP = 'INSERT' AND NEW.orcamento_item_id IS NOT NULL THEN");
    expect(f).toContain("SELECT oi.valor_unitario, round(oi.valor_total + COALESCE(oi.desconto, 0), 2)");
    expect(f).toContain("NEW.valor_total := v_total;");
    // Sem permissão para ler o item do orçamento, recalcula em vez de falhar.
    expect(f).toContain("EXCEPTION WHEN insufficient_privilege THEN");
    // E depois, num UPDATE sem entrada mudada, também não deriva.
    expect(f).toContain("IF TG_OP = 'UPDATE'");
    for (const entrada of ENTRADAS_DO_PRECO) expect(f).toContain(entrada);
  });

  it("os privilégios ficam como estavam: o do orçamento é DEFINER, o da OS não", () => {
    expect(funcao("tg_item_precificar_por_area")).toContain("SECURITY DEFINER");
    expect(funcao("tg_item_os_precificar_por_area")).not.toContain("SECURITY DEFINER");
  });
});

// O painel do parceiro espelha o pedido que o banco grava: com a área exata, o total por área é
// área × peças × preço arredondado uma vez, e o unitário é o total ÷ peças.
const adesivo: ItemDoCatalogo = {
  produto_id: "adesivo",
  nome: "Adesivo vinil branco impresso",
  categoria: "Adesivo",
  unidade: "m2",
  por_area: true,
  area_minima: null,
  preco_referencia: 55,
  preco_parceiro: 29.9,
  origem: "tabela",
  oferta_id: null,
  oferta_titulo: null,
  faixas: null,
  tamanhos: [],
};

const item = (parcial: Partial<ItemDoOrcamento>): ItemDoOrcamento => ({
  produto_id: null,
  descricao: "Item",
  unidade: "un",
  largura: null,
  altura: null,
  quantidade: 1,
  preco_venda_unidade: 0,
  ...parcial,
});

describe("o painel do parceiro segue a conta do banco", () => {
  it("peça miúda: 120 adesivos de 5 × 5 cm a R$ 29,90/m² custam R$ 8,97, não R$ 8,40", () => {
    const c = custoDoItem(item({ produto_id: "adesivo", largura: 0.05, altura: 0.05, quantidade: 120 }), adesivo);
    // Antes: unitário em centavos (0,07) × 120 = 8,40 no painel, e o banco cobrava outro valor.
    expect(c).toMatchObject({ tipo: "ok", precoUnidade: 29.9, total: 8.97, unitario: 0.07 });
  });

  it("peça comum não muda: 2 × 1 m em 3 vias a R$ 63/m² continua R$ 378,00", () => {
    const lona = { ...adesivo, produto_id: "lona", preco_parceiro: 63, area_minima: 0.25 };
    const c = custoDoItem(item({ produto_id: "lona", largura: 2, altura: 1, quantidade: 3 }), lona);
    expect(c).toMatchObject({ tipo: "ok", unitario: 126, total: 378 });
  });

  it("peça menor que a área mínima paga a mínima, por peça", () => {
    const lona = { ...adesivo, produto_id: "lona", preco_parceiro: 63, area_minima: 0.25 };
    const c = custoDoItem(item({ produto_id: "lona", largura: 0.2, altura: 0.3, quantidade: 4 }), lona);
    expect(c).toMatchObject({ tipo: "ok", unitario: 15.75, total: 63 });
  });

  it("o que o parceiro cobra do cliente dele usa a mesma regra (margem na mesma conta)", () => {
    const v = vendaDoItem(
      item({ unidade: "m2", largura: 0.05, altura: 0.05, quantidade: 120, preco_venda_unidade: 30 }),
      undefined,
    );
    expect(v).toEqual({ unitario: 0.08, total: 9 });
  });

  it("item que não é por área continua unitário × quantidade", () => {
    const perfurado: ItemDoCatalogo = { ...adesivo, produto_id: "perfurado", unidade: "un", por_area: false, preco_parceiro: 24.25 };
    const c = custoDoItem(item({ produto_id: "perfurado", quantidade: 120 }), perfurado);
    expect(c).toMatchObject({ tipo: "ok", unitario: 24.25, total: 2910 });
  });
});
