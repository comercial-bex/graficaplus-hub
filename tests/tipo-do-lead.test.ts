import { describe, expect, it } from "vitest";
import { colunaTipoAusente, ehLeadParceiro, filtrarParceiros, tipoDoLead } from "../src/domain/crm/tipo-do-lead";

describe("tipo do lead", () => {
  it("tipo cliente gravado vence anúncio e telefone", () => {
    expect(tipoDoLead({ tipoGravado: "cliente", anuncioId: "123", anunciosDeParceiro: ["123"], telefoneEhDeParceiro: true })).toBe("cliente");
  });
  it("tipo parceiro gravado vence ausência de sinais", () => {
    expect(tipoDoLead({ tipoGravado: "parceiro" })).toBe("parceiro");
  });
  it("anúncio cadastrado identifica parceiro", () => {
    expect(tipoDoLead({ anuncioId: "123", anunciosDeParceiro: ["123"] })).toBe("parceiro");
  });
  it("telefone cadastrado identifica parceiro", () => {
    expect(tipoDoLead({ telefoneEhDeParceiro: true })).toBe("parceiro");
  });
  it("anúncio não cadastrado é cliente", () => {
    expect(tipoDoLead({ anuncioId: "456", anunciosDeParceiro: ["123"] })).toBe("cliente");
  });
  it("sem sinais é cliente", () => expect(tipoDoLead({})).toBe("cliente"));
  it("tipo inválido não vence um sinal de parceiro", () => {
    expect(tipoDoLead({ tipoGravado: "outro", telefoneEhDeParceiro: true })).toBe("parceiro");
  });
  it("telas tratam tipo ausente como cliente", () => expect(ehLeadParceiro(undefined)).toBe(false));
  it("filtro mantém somente tipo parceiro persistido", () => {
    expect(filtrarParceiros([{ id: 1, tipo: "parceiro" }, { id: 2, tipo: "cliente" }, { id: 3 }], true)).toEqual([{ id: 1, tipo: "parceiro" }]);
  });
  it("filtro desligado mantém todos", () => {
    const leads = [{ tipo: "cliente" }, { tipo: "parceiro" }];
    expect(filtrarParceiros(leads, false)).toBe(leads);
  });
  it("aceita ausência SQL da coluna tipo", () => expect(colunaTipoAusente({ code: "42703", message: "column leads.tipo does not exist" })).toBe(true));
  it("aceita cache sem tipo", () => expect(colunaTipoAusente({ code: "PGRST204", message: "Could not find the 'tipo' column" })).toBe(true));
  it("não oculta falta de permissão", () => expect(colunaTipoAusente({ code: "42501", message: "permission denied for tipo" })).toBe(false));
  it("não oculta outra coluna ausente", () => expect(colunaTipoAusente({ code: "42703", message: "column nome does not exist" })).toBe(false));
});