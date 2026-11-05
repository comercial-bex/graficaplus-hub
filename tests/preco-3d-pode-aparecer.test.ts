import { describe, expect, it } from "vitest";
import { precoPodeAparecer } from "@/domain/impressao3d/preco-pode-aparecer";

const vazio = { maquinaId: "", materialId: "", gramas: 0, tempoMinutos: 0 };

describe("precoPodeAparecer", () => {
  it("formulário vazio não mostra preço", () => expect(precoPodeAparecer(vazio)).toBe(false));
  it("só peso não mostra", () => expect(precoPodeAparecer({ ...vazio, gramas: 12 })).toBe(false));
  it("só tempo não mostra", () => expect(precoPodeAparecer({ ...vazio, tempoMinutos: 90 })).toBe(false));
  it("peso e tempo sem impressora não mostra", () =>
    expect(precoPodeAparecer({ ...vazio, materialId: "f1", gramas: 12, tempoMinutos: 90 })).toBe(false));
  it("peso e tempo sem filamento não mostra", () =>
    expect(precoPodeAparecer({ ...vazio, maquinaId: "m1", gramas: 12, tempoMinutos: 90 })).toBe(false));
  it("os quatro dados mostram o preço", () =>
    expect(precoPodeAparecer({ maquinaId: "m1", materialId: "f1", gramas: 12, tempoMinutos: 90 })).toBe(true));
});
