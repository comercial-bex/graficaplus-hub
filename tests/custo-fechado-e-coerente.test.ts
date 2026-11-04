import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { brlPorPeca, custoDosTerceirizados } from "@/domain/orcamentos/terceirizados";

/**
 * Revisão adversarial de 03/11/2026 sobre o custo das fórmulas e dos terceirizados
 * (#409, #410): o retrato da versão vazava custo_formulas, a alçada do desconto e o
 * custo estimado do catálogo ignoravam as fórmulas, o preço especial sumia ao voltar
 * para cliente final, o gatilho perdia o terceirizado por pedido em tiragem grande, e
 * copiar um item perdia o material por fórmula.
 */

const migracao = readFileSync("supabase/migrations/20261103410000_custo_fechado_e_coerente.sql", "utf8");
const tela = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

describe("o retrato da versão do orçamento não leva custo", () => {
  it("tira toda chave custo_* e margem_*, também as futuras, e a composição interna", () => {
    expect(migracao).toContain("CREATE OR REPLACE FUNCTION public.orcamento_itens_para_versao(p_orcamento uuid)");
    expect(migracao).toContain("k ~ '^(custo|margem)_'");
    expect(migracao).toContain("ARRAY['parametros', 'produto_snapshot', 'materiais_por_formula']");
    expect(migracao).toContain("REVOKE ALL ON FUNCTION public.orcamento_itens_para_versao(uuid) FROM PUBLIC, anon, authenticated;");
  });

  it("limpa os retratos já gravados e refaz o hash só onde a conta antiga bate com o guardado", () => {
    expect(migracao).toContain("ARRAY['custo_formulas', 'materiais_por_formula']");
    expect(migracao).toContain("md5((v.snapshot->'itens')::text || '|' || coalesce(v.valor_total::text, '0')) = v.snapshot->>'hash'");
    expect(migracao).toContain("UPDATE public.orcamento_versao_itens SET snapshot = snapshot - v_chaves");
  });

  it("a migração original do retrato continua com a lista antiga: a nova função é que vale", () => {
    const antiga = readFileSync("supabase/migrations/20261022210000_orcamento_versao_congelada.sql", "utf8");
    expect(antiga).toContain("to_jsonb(i) - 'custo_unitario' - 'custo_previsto' - 'margem_prevista' - 'parametros' - 'produto_snapshot'");
    expect(antiga).not.toContain("custo_formulas");
  });
});

describe("a alçada do desconto e o custo estimado contam as fórmulas", () => {
  it("desconto_avaliar soma custo_formulas × quantidade ao custo da linha", () => {
    expect(migracao).toContain("pg_get_functiondef('public.desconto_avaliar(uuid,numeric,numeric,numeric)'::regprocedure)");
    expect(migracao).toContain("v_f := COALESCE(r.custo_formulas, 0) * COALESCE(r.quantidade, 0);");
    // Só soma quando o custo-base existe: sem ele a linha continua "sem custo" e cai no limite fixo de 10%.
    expect(migracao).toContain("IF v_f > 0 AND v_c IS NOT NULL THEN v_c := v_c + v_f; END IF;");
    expect(migracao).not.toContain("COALESCE(v_c, 0) + v_f");
  });

  it("o catálogo deixa o custo estimado para o gatilho, a única conta dele", () => {
    expect(migracao).toContain("catalogo_adicionar_ao_orcamento(uuid,text,numeric,uuid,uuid,text)");
    expect(migracao).toContain(", custo_estimado = s\\.custo");
    expect(migracao).toContain("position('custo_estimado' IN v_novo) > 0");
  });
});

describe("o preço especial do cliente vence a tabela também no banco", () => {
  it("orcamento_aplicar_preco consulta produto_precos_cliente antes de voltar à tabela", () => {
    expect(migracao).toContain("pg_get_functiondef('public.orcamento_aplicar_preco(uuid,text,uuid)'::regprocedure)");
    expect(migracao).toContain("SELECT pc.preco INTO v_preco FROM public.produto_precos_cliente pc");
    expect(migracao).toContain("pc.cliente_id = v_orc.cliente_id");
    expect(migracao).toContain("v_preco := COALESCE(v_preco, i.preco_base);");
  });

  it("a tela avisa quando a consulta do preço especial não voltou ou deu erro", () => {
    expect(tela).toContain("precosEspeciais.isError");
    expect(tela).toContain("Não consegui conferir o preço especial deste cliente");
  });
});

describe("o gatilho do custo das fórmulas", () => {
  it("dispara também quando só custo_formulas é gravado e sobrescreve o valor", () => {
    expect(migracao).toContain("BEFORE INSERT OR UPDATE OF materiais_por_formula, produto_id, largura, altura, quantidade, custo_formulas");
    expect(migracao).toContain("EXECUTE FUNCTION public.tg_orcamento_item_custo_das_formulas();");
  });

  it("não arredonda a centavos por peça e divide o pedido pela quantidade como ela é", () => {
    expect(migracao).toContain("NEW.custo_formulas := COALESCE(v_formulas, 0) + COALESCE(v_terceiros, 0);");
    expect(migracao).toContain("t.valor / CASE WHEN COALESCE(NEW.quantidade, 0) > 0 THEN NEW.quantidade ELSE 1 END");
    expect(migracao).toContain("REVOKE ALL ON FUNCTION public.tg_orcamento_item_custo_das_formulas() FROM PUBLIC, anon, authenticated;");
  });

  it("a tela faz a mesma conta: R$ 100 por pedido em 30.000 peças não some", () => {
    const frete = [{ id: "f", descricao: "Frete", valor: 100, base: "pedido" }];
    const grande = custoDosTerceirizados(frete, { largura: 1, altura: 1, quantidade: 30000 });
    expect(grande.linhas[0].porPeca).toBeCloseTo(100 / 30000, 10);
    expect(grande.total * 30000).toBeCloseTo(100, 6);
    // Meia peça: o pedido todo continua R$ 100, não R$ 50.
    const meia = custoDosTerceirizados(frete, { largura: 1, altura: 1, quantidade: 0.5 });
    expect(meia.total).toBe(200);
    expect(meia.total * 0.5).toBe(100);
    // Quantidade vazia ou zero vale uma peça.
    expect(custoDosTerceirizados(frete, { largura: 1, altura: 1, quantidade: 0 }).total).toBe(100);
    expect(custoDosTerceirizados(frete, { largura: 1, altura: 1, quantidade: null }).total).toBe(100);
  });

  it("a soma de duas linhas por pedido não perde o centavo", () => {
    const duas = [
      { id: "a", descricao: "A", valor: 10, base: "pedido" },
      { id: "b", descricao: "B", valor: 10, base: "pedido" },
    ];
    const r = custoDosTerceirizados(duas, { largura: 1, altura: 1, quantidade: 3 });
    // O banco soma sem arredondar: 20 / 3 por peça, 20 no pedido.
    expect(r.total * 3).toBeCloseTo(20, 10);
  });

  it("o valor por peça aparece com a fração de centavo que importa", () => {
    expect(brlPorPeca(10)).toMatch(/10,00/);
    expect(brlPorPeca(100 / 30000)).toMatch(/0,0033/);
    expect(brlPorPeca(0)).toMatch(/0,00/);
  });
});

describe("copiar um item leva o material por fórmula", () => {
  it("Duplicar e Repetir último pedido leem materiais_por_formula da tabela e gravam na cópia", () => {
    // As views não trazem a coluna: sem lê-la da tabela a cópia nasce sem o custo das fórmulas.
    const leituras = tela.match(/\.select\("id, materiais_por_formula"\)/g) ?? [];
    expect(leituras.length).toBe(2);
    // A cópia sai da função pura (tests/copia-de-item-por-area.test.ts), com a lista lida do banco:
    // item que a leitura não devolve para a cópia em vez de virar lista vazia (revisão de 04/11/2026).
    expect(tela).toContain("const formulas = formulasParaCopiar(comFormulas as any[] | null, idsBase);");
    expect(tela).toContain("const formulas = formulasParaCopiar(comFormulas as any[] | null, idsParaCopiar);");
    expect(tela).toContain("materiaisPorFormula: formulas.porItem.get(item.id),");
    // A cobrança que a peça gerou também leva o dela.
    expect(tela).toContain("materiaisPorFormula: formulas.porItem.get(l.id),");
    expect(tela).not.toContain("?? [],\n    };\n    // custo só existe na view financeira");
  });
});
