import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 23/10/2026: o orçamento de parceiro mostrava só o preço de cliente final. O modo
 * parceiro lia `produtos.preco_parceiro` (1 de 46 preenchidos); a tabela de verdade
 * (níveis, faixas, ofertas) só chegava ao painel do próprio parceiro. Ensaio com
 * rollback: Acrílico 3mm R$ 800/m² → R$ 680 (Bronze, −15%) ao nascer/trocar para
 * cliente parceiro, e de volta a R$ 800 ao trocar para cliente final.
 */
const SQL = readFileSync("supabase/migrations/20261023200000_preco_de_parceiro_automatico_no_orcamento.sql", "utf8");
const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
const FN = readFileSync("src/lib/api/orcamento-preco.functions.ts", "utf8");

describe("preço de parceiro automático", () => {
  it("o banco usa a tabela do programa para parceiro ativo e a coluna só como reserva", () => {
    expect(SQL).toContain("orcamento_precos_parceiro_interno(v_parc, i.produto_id)");
    expect(SQL).toContain("v_origem text := 'coluna'");
    expect(SQL).toContain("v_origem := 'programa'");
  });
  it("orçamento novo de parceiro ativo nasce no modo parceiro; trocar de cliente reprecifica", () => {
    expect(SQL).toContain("NEW.preco_modo := 'parceiro'");
    expect(SQL).toContain("AFTER UPDATE OF cliente_id");
  });
  it("preço do programa não pede senha nem grava 'confirmado por'", () => {
    expect(SQL).toContain("p_modo = 'parceiro' AND v_origem = 'coluna' THEN p_usuario");
    expect(FN).toContain("orcamento_de_parceiro_ativo");
    expect(FN).toContain("!ehParceiroAtivo");
  });
  it("a tela entrega o item já com o preço da tabela do parceiro", () => {
    expect(TELA).toContain("orcamento_precos_parceiro");
    expect(TELA).toContain("tabelaDoParceiro?.porProduto.get(p.id)");
  });
});
