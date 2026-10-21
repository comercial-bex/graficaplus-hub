import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { abasDoProduto, avisoDaFicha, sinalDoPreco } from "../src/domain/catalogo/abas-do-produto";

/**
 * A janela do produto em abas (20/10/2026). Medido antes: 15 campos e a ficha
 * de materiais numa rolagem só, em três seções. Agora: Dados, Preço (só quem vê
 * o financeiro) e Produção e ficha.
 */

const TELA = readFileSync("src/routes/_authenticated/produtos.tsx", "utf8");
const JANELA = TELA.slice(TELA.indexOf("function ProdutoFormDialog("), TELA.indexOf("function ImportDialog("));
const aba = (id: string) => {
  const i = JANELA.indexOf(`<TabsContent value="${id}"`);
  expect(i, id).toBeGreaterThan(0);
  return JANELA.slice(i, JANELA.indexOf("</TabsContent>", i));
};

describe("as abas", () => {
  it("quem vê o financeiro tem três; quem não vê, duas — sem a de preço", () => {
    expect(abasDoProduto({ canSeeFinancials: true }).map((a) => a.titulo)).toEqual(["Dados", "Preço", "Produção e ficha"]);
    expect(abasDoProduto({ canSeeFinancials: false }).map((a) => a.id)).toEqual(["dados", "producao"]);
  });

  it("a aba da ficha explica por que está vazia: serviço não consome; item novo salva antes", () => {
    expect(avisoDaFicha({ temId: true, tipo: "servico" })).toBe("Serviço não tem ficha de materiais.");
    expect(avisoDaFicha({ temId: false, tipo: "produto" })).toMatch(/^Salve o item primeiro/);
    expect(avisoDaFicha({ temId: true, tipo: "produto" })).toBeNull();
  });

  it("a aba Preço ganha um ponto quando a margem está ruim ou perto do mínimo", () => {
    expect(sinalDoPreco("ruim")).toBe("ruim");
    expect(sinalDoPreco("alerta")).toBe("alerta");
    expect(sinalDoPreco("ok")).toBeNull();
    expect(sinalDoPreco("vazio")).toBeNull();
  });
});

describe("cada campo na sua aba", () => {
  it("Dados: nome, SKU, categoria, tipo, unidade, descrição e ativo — nada de preço", () => {
    const d = aba("dados");
    for (const c of ['"Nome *"', '"SKU"', '"Categoria"', '"Tipo"', '"Unidade"', '"Descrição"', "Item ativo no catálogo"]) {
      expect(d, c).toContain(c);
    }
    expect(d).not.toContain("custo_medio");
    expect(d).not.toContain("preco_base");
  });

  it("Preço: custo, preço, margem mínima, área mínima e a calculadora ao vivo — e só existe com canSeeFinancials", () => {
    const p = aba("preco");
    for (const c of ["form.custo_medio", "form.preco_base", "form.margem_minima", "form.area_minima_cobrada", "<MargemBadge"]) {
      expect(p, c).toContain(c);
    }
    expect(JANELA).toContain('{canSeeFinancials && (\n            <TabsContent value="preco"');
  });

  it("Produção e ficha: máquina, material, tempo, observações e a ficha — fora do bloco do financeiro", () => {
    const p = aba("producao");
    for (const c of ["form.maquina_padrao_id", "form.material_principal_id", "form.tempo_producao_min", "form.observacoes_internas", "<ProdutoMateriaisEditor"]) {
      expect(p, c).toContain(c);
    }
    // Máquina e material já eram gravados para todos (o salvar não olha o financeiro).
    expect(TELA).toContain("maquina_padrao_id: f.maquina_padrao_id || null,");
    expect(TELA).toContain("material_principal_id: f.material_principal_id || null,");
    expect(aba("preco")).not.toContain("maquina_padrao_id");
  });

  it("nenhum campo ficou para trás nem em dobro", () => {
    for (const c of ["form.nome", "form.sku", "form.custo_medio", "form.maquina_padrao_id", "form.tempo_producao_min", "form.observacoes_internas"]) {
      // `value={form.x}` ou `value={form.x || "nenhuma"}`.
      const vezes = (JANELA.match(new RegExp(`value=\\{${c.replace(".", "\\.")}[ }]`, "g")) ?? []).length;
      expect(vezes, c).toBe(1);
    }
    expect(JANELA.match(/<ProdutoMateriaisEditor/g)).toHaveLength(1);
  });
});

describe("a janela", () => {
  it("abre sempre em Dados e as abas têm alvo de toque no celular", () => {
    expect(JANELA).toContain('const [aba, setAba] = useState<AbaDoProduto>("dados");');
    expect(JANELA).toContain('if (open) setAba("dados");');
    expect(JANELA).toContain('className="min-h-11 gap-1.5 md:min-h-8"');
  });

  it("campos da mesma linha alinham pela base (rótulo com ícone de dica é mais alto)", () => {
    expect(JANELA).not.toContain('<div className="grid grid-cols-3 gap-3">');
    expect(JANELA.match(/grid grid-cols-3 items-end gap-3/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("de outra aba, o botão travado diz o que falta e leva até lá", () => {
    expect(JANELA).toContain('{!form.nome && aba !== "dados" && (');
    expect(JANELA).toContain('onClick={() => setAba("dados")}');
    // Fora do rodapé (que empilha ao contrário no celular).
    expect(JANELA.indexOf("data-falta-nome")).toBeLessThan(JANELA.indexOf('<DialogFooter className="gap-2">'));
    expect(JANELA).toContain("disabled={!form.nome || saving}");
  });
});
