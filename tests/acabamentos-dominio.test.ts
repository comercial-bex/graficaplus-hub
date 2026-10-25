import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { avisoDeProcesso, lerCusto, margemDoAcabamento, precoPelaMargem, PROCESSOS, rotuloDoProcesso } from "@/domain/acabamentos/acabamentos";

const SQL = readFileSync("supabase/migrations/20261025400000_acabamentos_do_produto.sql", "utf8");

describe("acabamentos", () => {
  it("PVC não vai no laser, acrílico vai", () => {
    expect(avisoDeProcesso("laser", "Letra caixa em PVC")).toMatch(/cloro/);
    expect(avisoDeProcesso("laser", "Placa PVC expandido 3mm")).toMatch(/cloro/);
    expect(avisoDeProcesso("laser", "Acrílico Virgem Recortado 3mm")).toBeNull();
    expect(avisoDeProcesso("manual", "Letra caixa em PVC")).toBeNull();
  });
  it("preço pela margem: custo ÷ (1 − margem)", () => {
    expect(precoPelaMargem(14.92, 40)).toBe(24.87);
    expect(precoPelaMargem(null, 40)).toBeNull();
    expect(precoPelaMargem(10, 100)).toBeNull();
  });
  it("margem do acabamento (laminação a R$ 28 sobre R$ 14,92 = 46,7%)", () => {
    expect(margemDoAcabamento(28, 14.9196)).toBe(46.7);
    expect(margemDoAcabamento(null, 10)).toBeNull();
  });
  it("lê o custo que vem do banco, mesmo com números em texto", () => {
    const c = lerCusto({ acabamento_id: "a", custo_total: "5.0464", custo_material: "0.7", faltas: ["x"], completo: false, maquina: null });
    expect(c?.custo_total).toBeCloseTo(5.0464, 4);
    expect(c?.faltas).toEqual(["x"]);
    expect(lerCusto(null)).toBeNull();
  });
  it("os processos do domínio são os do CHECK do banco", () => {
    for (const p of PROCESSOS) expect(SQL).toContain(`'${p.valor}'`);
    expect(rotuloDoProcesso("laser")).toBe("Corte a laser");
  });
  it("a migração não inventa tempo: recorte sem depuração e laser sem velocidade ficam à vista", () => {
    expect(SQL).toContain("FALTA informar o tempo de depuração");
    expect(SQL).toContain("sem tempo de mão de obra (preparo, depuração, retirada)");
  });
  it("custo só para quem vê financeiro e função interna fechada", () => {
    expect(SQL).toContain("can_see_financials(auth.uid())");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.custo_do_acabamento_interno(uuid) FROM PUBLIC, anon, authenticated");
  });
});
