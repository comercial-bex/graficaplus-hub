import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GUIA_PENDENCIAS } from "../src/lib/pendenciasGuia";

/**
 * O custo do item vem do produto, não de quem digita (19/10/2026).
 *
 * Achado: três das nove OS abertas (#163 faixa banner R$ 1.050, #165 acrílico
 * R$ 680, #166 banner R$ 38,40) estavam sem custo previsto — e todo reembolso
 * nelas cairia em amarelo. A causa era de origem: o catálogo do orçamento só
 * entrega o custo a quem vê custo; o vendedor gravava custo 0, e o
 * `custo_estimado` do orçamento (que a tela só escrevia quando quem editava via
 * custo) ficava 0 também. A OS herda o custo do orçamento.
 *
 * O ensaio no banco (rollback) provou: o acrílico do Leonardo ganhou R$ 80,00
 * (R$ 400/m² × 0,2 m²), o chaveiro R$ 2,25, o custo digitado pelo gestor
 * (R$ 123,45) foi preservado, o orçamento passou de custo 0 para R$ 428,45, e
 * as três OS ficaram com R$ 274,52, R$ 340,00 e R$ 9,12 — sem mudar nenhum
 * preço. Aqui: as travas que o ensaio não repete.
 */

const SQL = readFileSync("supabase/migrations/20261019120000_custo_do_item_no_banco.sql", "utf8");
const ORCAMENTO = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

describe("o custo do item sai do produto, no banco", () => {
  it("só preenche custo ZERO de item COM produto — custo digitado por quem vê custo não é tocado", () => {
    expect(SQL).toContain("IF NEW.produto_id IS NULL OR COALESCE(NEW.custo_unitario, 0) <> 0 THEN");
    expect(SQL).toContain("IF COALESCE(v_custo, 0) <= 0 THEN");
  });

  it("vendido por área: custo por m² × a área da PEÇA, com a área mínima — a mesma conta do preço", () => {
    expect(SQL).toContain("IF NEW.preco_m2 IS NOT NULL AND COALESCE(NEW.largura, 0) > 0 AND COALESCE(NEW.altura, 0) > 0 THEN");
    expect(SQL).toContain("GREATEST(round(NEW.largura * NEW.altura, 3), COALESCE(NEW.area_minima, v_area_minima, 0))");
    expect(SQL).toContain("NEW.custo_unitario := round(v_custo * v_area_peca, 2);");
    expect(SQL).toMatch(/ELSE\s+NEW\.custo_unitario := v_custo;/);
  });

  it("lê o custo do produto como DEFINER (o vendedor não tem o grant da coluna) e o gatilho não fica aberto ao público", () => {
    const corpo = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.tg_orcamento_item_custo_do_produto"));
    expect(corpo.slice(0, 400)).toContain("SECURITY DEFINER");
    expect(corpo.slice(0, 400)).toContain("SET search_path TO 'public'");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.tg_orcamento_item_custo_do_produto() FROM PUBLIC, anon, authenticated;");
  });

  it("roda DEPOIS do gatilho de preço (ordem alfabética), que é quem preenche area_minima", () => {
    const nomes = ["tg_orcamento_itens_precificar", "tg_orcamento_itens_zz_custo_do_produto"];
    expect([...nomes].sort()).toEqual(nomes);
    expect(SQL).toContain("CREATE TRIGGER tg_orcamento_itens_zz_custo_do_produto");
    expect(SQL).toMatch(/BEFORE INSERT OR UPDATE ON public\.orcamento_itens/);
  });

  it("o custo estimado do orçamento acompanha os itens no banco — e reage à mudança do custo do item", () => {
    expect(SQL).toContain("custo_estimado = COALESCE((SELECT sum(COALESCE(i.custo_unitario, 0) * COALESCE(i.quantidade, 0))");
    expect(SQL).toContain("AFTER INSERT OR DELETE OR UPDATE OF valor_total, quantidade, valor_unitario, desconto, custo_unitario");
    // O subtotal que já era mantido no banco continua.
    expect(SQL).toContain("valor_subtotal = COALESCE((SELECT sum(i.valor_total) FROM public.orcamento_itens i");
  });
});

describe("os dados das três OS", () => {
  it("liga o item ao produto SEM mudar o que foi vendido: area_minima = 0 explícito (NULL subiria R$ 38,40 para R$ 40,00)", () => {
    expect(SQL).toContain("SET produto_id = p.id, area_minima = 0");
    expect(SQL).toContain("p.nome = 'Banner com bastão e corda (Terceirizado)'");
    expect(SQL).toContain("p.nome = 'Lona 440g reforçada impressa'");
    expect(SQL).toContain("NULL faria o gatilho de preço copiar");
  });

  it("só mexe em OS aberta, sem custo, e é idempotente", () => {
    expect(SQL).toContain("COALESCE(o.custo_previsto, 0) = 0");
    expect(SQL).toContain("o.status::text NOT IN ('concluido', 'faturado', 'cancelado')");
    expect(SQL).toContain("i.produto_id IS NULL");
  });

  it("a OS sem ficha usa o custo médio do cadastro na área cobrada — a mesma regra do chaveiro", () => {
    expect(SQL).toContain("COALESCE(p.custo_medio, 0) * public.base_de_consumo_item(i.area_cobrada, i.quantidade)");
  });

  it("não usa a função com require_permission (não há login na migração): faz a conta direto", () => {
    expect(SQL).not.toContain("recalcular_previsao_custos(");
    expect(SQL).toContain("PERFORM public.gerar_materiais_previstos_os(r.id);");
  });
});

describe("o que o gatilho não alcança: item em texto livre e produto sem custo", () => {
  it("pendência da gerência com os números das OS e nenhum valor", () => {
    expect(SQL).toContain("'os_sem_custo_previsto'");
    expect(SQL).toContain("COALESCE(o.valor_total, 0) > 0 AND COALESCE(o.custo_previsto, 0) <= 0");
    expect(SQL).toContain("NOT EXISTS (SELECT 1 FROM public.os_materiais_previstos m WHERE m.os_id = o.id)");
    expect(SQL).toContain("IF position('os_sem_custo_previsto' IN v_def) > 0 THEN RETURN; END IF;");
  });

  it("o guia de cada pendência nova diz o caminho — inclusive as de reembolso, que estavam sem", () => {
    for (const chave of ["os_sem_custo_previsto", "reembolsos_para_a_gerencia", "reembolsos_para_o_financeiro"]) {
      const g = GUIA_PENDENCIAS[chave];
      expect(g, chave).toBeDefined();
      expect(g.passos.length, chave).toBeGreaterThanOrEqual(2);
      expect(g.passos.length, chave).toBeLessThanOrEqual(4);
    }
  });

  it("o orçamento avisa do item sem produto — o que o gatilho não resolve", () => {
    // A linha da taxa do expresso não tem produto e não é item para conferir: fica de fora da conta.
    expect(ORCAMENTO).toContain("const semProduto = (itensDeProduto as any[]).filter((i) => !i.produto_id).length;");
    expect(ORCAMENTO).toContain("Sem produto ligado: o custo e a margem deste item não são calculados.");
    expect(ORCAMENTO).toContain("itens sem produto");
  });
});
