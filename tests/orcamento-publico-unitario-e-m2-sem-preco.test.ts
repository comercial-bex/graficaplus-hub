import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dinheiroDaUnidade } from "../src/lib/pdf/formato";
import { bloqueioDeAreaSemPreco, MENSAGEM_M2_SEM_PRECO } from "../src/domain/orcamentos/trava-de-area-sem-preco";

const norm = (s: string) => s.replace(/ /g, " ");

describe("link público: unitário fecha com o total gravado", () => {
  it("orçamento 115: unitário de 0,09 que não fecha com o total de 10,80", () => {
    // 100 peças x 0,09 = 9,00, e o total gravado é 10,80: sai o total dividido pelas peças.
    expect(norm(dinheiroDaUnidade(0.09, 100, 10.8))).toBe("R$ 0,108");
  });
  it("unitário que fecha sai como sempre", () => {
    expect(norm(dinheiroDaUnidade(0.09, 120, 10.8))).toBe("R$ 0,09");
    expect(norm(dinheiroDaUnidade(257.25, 3, 771.75))).toBe("R$ 257,25");
  });
  it("a rota pública usa dinheiroDaUnidade e não o unitário cru", () => {
    const rota = readFileSync("src/routes/orcamento-publico.$token.tsx", "utf8");
    expect(rota).toContain("dinheiroDaUnidade(i.valor_unitario, i.quantidade, i.valor_total)");
    expect(rota).not.toContain("real(i.valor_unitario)");
  });
});

describe("m2 com largura e altura exige preço por m2", () => {
  const item = { largura: 1.2, altura: 0.8, quantidade: 2 };
  it("bloqueia m2 com medida e sem preço", () => {
    expect(bloqueioDeAreaSemPreco({ unidade: "m2", item, precoM2: 0, podeEditarPreco: true })).toBe(MENSAGEM_M2_SEM_PRECO);
    expect(bloqueioDeAreaSemPreco({ unidade: "m²", item, precoM2: null, podeEditarPreco: true })).toBe(MENSAGEM_M2_SEM_PRECO);
    expect(bloqueioDeAreaSemPreco({ unidade: "m2", item, precoM2: Number.NaN, podeEditarPreco: true })).toBe(MENSAGEM_M2_SEM_PRECO);
  });
  it("libera com preço por m2", () => {
    expect(bloqueioDeAreaSemPreco({ unidade: "m2", item, precoM2: 45, podeEditarPreco: true })).toBeNull();
  });
  it("não mexe em outras unidades, sem medida, nem em quem não edita preço", () => {
    expect(bloqueioDeAreaSemPreco({ unidade: "un", item, precoM2: 0, podeEditarPreco: true })).toBeNull();
    expect(bloqueioDeAreaSemPreco({ unidade: "m2", item: { quantidade: 2 }, precoM2: 0, podeEditarPreco: true })).toBeNull();
    expect(bloqueioDeAreaSemPreco({ unidade: "m2", item, precoM2: 0, podeEditarPreco: false })).toBeNull();
  });
  it("a mensagem é clara e sem parênteses, travessão ou seta", () => {
    expect(MENSAGEM_M2_SEM_PRECO).toContain("preço por metro quadrado");
    expect(MENSAGEM_M2_SEM_PRECO).not.toMatch(/[()—–→]/);
  });
  it("a tela bloqueia o salvar e mostra o aviso com botão de 44 px", () => {
    const tela = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
    expect(tela).toContain("if (bloqueioM2SemPreco) return toast.error(bloqueioM2SemPreco);");
    expect(tela).toContain('data-testid="aviso-m2-sem-preco"');
    expect(tela).toContain("disabled={salvandoItem || !!bloqueioM2SemPreco}");
  });
});
