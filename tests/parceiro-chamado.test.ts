import { describe, expect, it } from "vitest";
import {
  celularValido,
  deveGarantirChamado,
  normalizarTelefone,
  telefoneDoParceiro,
  variantesDoTelefone,
} from "@/domain/parceiros/chamado-do-parceiro";

describe("telefone do parceiro", () => {
  it("com e sem 55 e nono dígito chegam ao mesmo número", () => {
    for (const t of [
      "5562981234567",
      "556281234567",
      "62981234567",
      "6281234567",
      "(62) 98123-4567",
    ]) {
      expect(normalizarTelefone(t)).toBe("62981234567");
    }
  });
  it("fixo não é celular válido", () => {
    expect(celularValido("6232123456")).toBeNull();
    expect(celularValido("")).toBeNull();
    expect(celularValido(null)).toBeNull();
  });
  it("gera as quatro variantes", () => {
    expect(variantesDoTelefone("62981234567")).toEqual([
      "62981234567",
      "6281234567",
      "5562981234567",
      "556281234567",
    ]);
  });
  it("usa o da marca, senão o do cliente ligado", () => {
    expect(
      telefoneDoParceiro({ marca_telefone: "62981234567", cliente_whatsapp: "62999990000" }),
    ).toBe("62981234567");
    expect(telefoneDoParceiro({ marca_telefone: " ", cliente_whatsapp: "62999990000" })).toBe(
      "62999990000",
    );
    expect(telefoneDoParceiro({ cliente_telefone: "6232123456" })).toBeNull();
  });
});

describe("condição do chamado automático", () => {
  const ok = { status: "ativo", responsavel_id: "u1", marca_telefone: "62981234567" };
  it("cadastro novo ativo com atendente abre, mesmo sem login", () => {
    expect(deveGarantirChamado(null, ok)).toBe(true);
  });
  it("sem atendente ou não ativo não abre", () => {
    expect(deveGarantirChamado(null, { ...ok, responsavel_id: null })).toBe(false);
    expect(deveGarantirChamado(null, { ...ok, status: "pendente" })).toBe(false);
  });
  it("abre quando passa a valer", () => {
    expect(deveGarantirChamado({ ...ok, status: "pendente" }, ok)).toBe(true);
    expect(deveGarantirChamado({ ...ok, responsavel_id: null }, ok)).toBe(true);
  });
  it("troca de telefone tenta de novo; nada mudou não dispara", () => {
    expect(deveGarantirChamado({ ...ok, marca_telefone: "62900000000" }, ok)).toBe(true);
    expect(deveGarantirChamado(ok, ok)).toBe(false);
  });
});
