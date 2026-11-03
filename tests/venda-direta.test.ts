import { describe, expect, it } from "vitest";
import { PAGAMENTOS_DA_VENDA_DIRETA, situacaoDoPagamento, valoresDoPagamento } from "@/domain/parceiros/venda-direta";

describe("venda direta: pagamento", () => {
  it("só oferece sinal de 50% e à vista", () => {
    expect(PAGAMENTOS_DA_VENDA_DIRETA.map((p) => p.chave)).toEqual(["metade_metade", "a_vista"]);
  });
  it("sinal de 50% cobra metade agora e o resto na entrega", () => {
    expect(valoresDoPagamento(301, "metade_metade")).toEqual({ agora: 150.5, restante: 150.5 });
  });
  it("à vista cobra o total agora", () => {
    expect(valoresDoPagamento(301, "a_vista")).toEqual({ agora: 301, restante: 0 });
  });
  it("situação: sinal fica Parcial, à vista fica Pago", () => {
    expect(situacaoDoPagamento("metade_metade")).toBe("Parcial");
    expect(situacaoDoPagamento("a_vista")).toBe("Pago");
  });
});
