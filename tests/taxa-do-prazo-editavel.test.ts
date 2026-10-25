import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lerTaxaDigitada } from "@/domain/parceiros/prazo";

describe("taxa do prazo digitada", () => {
  it("aceita vírgula, ponto e %", () => {
    expect(lerTaxaDigitada("12")).toBe(12);
    expect(lerTaxaDigitada("11,5")).toBe(11.5);
    expect(lerTaxaDigitada("12.25")).toBe(12.25);
    expect(lerTaxaDigitada(" 10% ")).toBe(10);
    expect(lerTaxaDigitada("0")).toBe(0);
  });

  it("recusa vazio, texto, negativo, acima de 100 e mais de 2 casas", () => {
    for (const t of ["", "  ", "abc", "-5", "101", "12,345", "1,2,3", "12 por cento"]) {
      expect(lerTaxaDigitada(t), t).toBeNull();
    }
  });
});

describe("a tela da taxa do prazo", () => {
  const tela = readFileSync("src/components/configuracoes/taxa-do-prazo.tsx", "utf8");
  const pagina = readFileSync("src/routes/_authenticated/configuracoes-empresa.tsx", "utf8");

  it("só confirma quando o banco mudou alguma linha", () => {
    expect(tela).toContain('.select("chave")');
    expect(tela).toContain("data.length === 0");
  });

  it("o prazo normal não se edita e o expresso invalida o cache do parceiro", () => {
    expect(tela).toContain("PRAZO_NORMAL");
    expect(tela).toContain("CHAVE_PRAZOS");
  });

  it("aparece nos dados da empresa, respeitando quem pode editar", () => {
    expect(pagina).toContain("<TaxaDoPrazo podeEditar={podeEditar} />");
  });
});
