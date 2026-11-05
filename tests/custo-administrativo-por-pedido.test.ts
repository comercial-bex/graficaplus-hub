import { describe, it, expect } from "vitest";
import { custoAdministrativoDoLote } from "@/domain/impressao3d/custo-administrativo";

describe("custo adm./embalagem por pedido (uma vez por item 3D)", () => {
  it("quantidade 1 cobra R$ 12", () => expect(custoAdministrativoDoLote(12, 1).toNumber()).toBe(12));
  it("quantidade 100 continua R$ 12, não R$ 1.200", () => expect(custoAdministrativoDoLote(12, 100).toNumber()).toBe(12));
  it("custo admin 0 dá 0", () => expect(custoAdministrativoDoLote(0, 100).toNumber()).toBe(0));
  it("quantidade 0 ou vazia cobra uma vez", () => {
    expect(custoAdministrativoDoLote(12, 0).toNumber()).toBe(12);
    expect(custoAdministrativoDoLote(12, null).toNumber()).toBe(12);
    expect(custoAdministrativoDoLote(12).toNumber()).toBe(12);
  });
});
