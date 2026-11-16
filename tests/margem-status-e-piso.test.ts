import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FOLGA_DA_MARGEM, margemStatus } from "../src/lib/produtos-catalogo";
import { pisoDaMargem } from "../src/domain/precos/tabela-de-precos";
import { avisoDeMargem, complementoDaMargem, fraseDoPiso } from "../src/domain/precos/texto-da-margem";

describe("margemStatus: abaixo do mínimo é sempre vermelho", () => {
  it("os quatro casos da auditoria de 15/11 eram amarelos e agora são vermelhos", () => {
    expect(margemStatus(37.1, 40)).toBe("ruim"); // Acabamento manual
    expect(margemStatus(37.3, 40)).toBe("ruim"); // Recorte
    expect(margemStatus(37.4, 40)).toBe("ruim"); // Corte a laser
    expect(margemStatus(32.2, 40)).toBe("ruim"); // Bolsa
  });
  it("um centésimo abaixo do mínimo já é vermelho", () => {
    expect(margemStatus(39.99, 40)).toBe("ruim");
  });
  it("no mínimo ou até a folga acima é amarelo", () => {
    expect(FOLGA_DA_MARGEM).toBe(3);
    expect(margemStatus(40, 40)).toBe("alerta");
    expect(margemStatus(42.99, 40)).toBe("alerta");
  });
  it("a partir da folga é verde", () => {
    expect(margemStatus(43, 40)).toBe("ok");
    expect(margemStatus(60, 40)).toBe("ok");
  });
  it("sem margem calculável é vazio", () => {
    expect(margemStatus(null, 40)).toBe("vazio");
  });
  it("sem margem mínima definida, só prejuízo é vermelho e nunca amarelo", () => {
    expect(margemStatus(0, 0)).toBe("ok");
    expect(margemStatus(1, 0)).toBe("ok");
    expect(margemStatus(-5, 0)).toBe("ruim");
  });
  it("margem negativa é vermelha", () => {
    expect(margemStatus(-593, 40)).toBe("ruim");
  });
});

describe("piso de preço", () => {
  it("round(custo/(1-margem/100),2)", () => {
    expect(pisoDaMargem(30, 40)).toBe(50);
    expect(pisoDaMargem(1.21, 40)).toBe(2.02);
  });
  it("sem custo ou margem válida, sem piso", () => {
    expect(pisoDaMargem(null, 40)).toBeNull();
    expect(pisoDaMargem(0, 40)).toBeNull();
    expect(pisoDaMargem(10, 0)).toBeNull();
    expect(pisoDaMargem(10, 100)).toBeNull();
  });
  it("a frase do piso traz o valor e a margem, sem parênteses", () => {
    const f = fraseDoPiso(30, 40)!;
    expect(f).toContain("50,00");
    expect(f).toContain("40%");
    expect(f).not.toMatch(/[()]/);
  });
  it("sem piso calculável não há frase", () => {
    expect(fraseDoPiso(null, 40)).toBeNull();
  });
});

describe("textos de margem sem parênteses, travessão nem seta", () => {
  const ruim = /[()—–→]/;
  it("complemento e aviso", () => {
    for (const s of ["ok", "alerta", "ruim", "vazio"] as const) {
      expect(complementoDaMargem(s)).not.toMatch(ruim);
      expect(avisoDeMargem(s, 40) ?? "").not.toMatch(ruim);
    }
    expect(complementoDaMargem("ruim")).toBe(", abaixo do mínimo");
    expect(avisoDeMargem("ok", 40)).toBeNull();
    expect(avisoDeMargem("ruim", 40)).toContain("40%");
  });
  it("a pasta e o diálogo usam as frases e mostram o piso", () => {
    const pasta = readFileSync("src/routes/_authenticated/produtos_.$id.tsx", "utf8");
    const dialogo = readFileSync("src/routes/_authenticated/produtos.tsx", "utf8");
    expect(pasta).not.toContain('" (abaixo do mínimo)"');
    expect(pasta).toContain("fraseDoPiso(");
    expect(dialogo).toContain("fraseDoPiso(custo, minima)");
    expect(dialogo).not.toContain("definido ({minima}%)");
    expect(dialogo).not.toContain("limite mínimo ({minima}%)");
  });
});
