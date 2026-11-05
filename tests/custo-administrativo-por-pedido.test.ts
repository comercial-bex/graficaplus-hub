import { describe, it, expect } from "vitest";
import {
  custoAdministrativoDoLote,
  custoDeEmbalagemDoItem,
  embalagemGravada,
} from "@/domain/impressao3d/custo-administrativo";

describe("embalagem opcional, cobrada uma vez por item 3D", () => {
  it("desligada vale 0 mesmo com R$ 12 sugerido", () =>
    expect(custoDeEmbalagemDoItem({ incluir: false, valor: 12 }).toNumber()).toBe(0));
  it("ligada cobra R$ 12 com 1 peça", () =>
    expect(custoDeEmbalagemDoItem({ incluir: true, valor: 12 }).toNumber()).toBe(12));
  it("quantidade 100 continua R$ 12, não R$ 1.200", () => {
    expect(custoAdministrativoDoLote(12, 100).toNumber()).toBe(12);
    expect(custoAdministrativoDoLote(12, 1).toNumber()).toBe(12);
  });
  it("ligada com 0 dá 0; negativo ou inválido dá 0", () => {
    expect(custoDeEmbalagemDoItem({ incluir: true, valor: 0 }).toNumber()).toBe(0);
    expect(custoDeEmbalagemDoItem({ incluir: true, valor: -5 }).toNumber()).toBe(0);
    expect(custoDeEmbalagemDoItem({ incluir: true, valor: "abc" }).toNumber()).toBe(0);
  });
  it("quantidade 0 ou vazia cobra uma vez", () => {
    expect(custoAdministrativoDoLote(12, 0).toNumber()).toBe(12);
    expect(custoAdministrativoDoLote(12, null).toNumber()).toBe(12);
  });
});

describe("restaurar embalagem de peça gravada", () => {
  it("usa os campos novos quando existem", () => {
    expect(
      embalagemGravada({ embalagem_incluida: false, embalagem_valor: 12, custo_admin: 12 }),
    ).toEqual({
      incluida: false,
      valor: 12,
    });
    expect(embalagemGravada({ embalagem_incluida: true, embalagem_valor: 8 })).toEqual({
      incluida: true,
      valor: 8,
    });
  });
  it("legado: custo_admin > 0 liga a opção com esse valor", () =>
    expect(embalagemGravada({ custo_admin: 12 })).toEqual({ incluida: true, valor: 12 }));
  it("legado: custo_admin ausente ou 0 deixa desligada", () => {
    expect(embalagemGravada({})).toEqual({ incluida: false, valor: 0 });
    expect(embalagemGravada({ custo_admin: 0 })).toEqual({ incluida: false, valor: 0 });
    expect(embalagemGravada(null)).toEqual({ incluida: false, valor: 0 });
  });
});
