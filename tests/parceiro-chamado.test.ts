import { describe, expect, it } from "vitest";
import {
  celularValido,
  deveGarantirChamado,
  normalizarTelefone,
  telefoneDoParceiro,
  variantesDoTelefone,
  responsavelSincronizado,
  temCompraRealAnterior,
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
  it("redistribuição entre dois atendentes dispara mesmo com telefone igual", () => {
    expect(deveGarantirChamado(ok, { ...ok, responsavel_id: "u2" })).toBe(true);
  });
});

describe("sincronização do responsável X -> Y", () => {
  const args = { anterior: "X", novo: "Y", atual: "X", aberto: true };
  it("troca somente onde o responsável atual ainda é X", () => {
    expect(responsavelSincronizado(args)).toBe("Y");
  });
  it("preserva quem a equipe já assumiu", () => {
    expect(responsavelSincronizado({ ...args, atual: "Z" })).toBe("Z");
  });
  it("não modifica atendimento fechado", () => {
    expect(responsavelSincronizado({ ...args, aberto: false })).toBe("X");
  });
  it("não modifica responsável atual vazio na redistribuição", () => {
    expect(responsavelSincronizado({ ...args, atual: null })).toBeNull();
  });
  it("ambos responsáveis precisam ser não nulos", () => {
    expect(responsavelSincronizado({ ...args, anterior: null })).toBe("X");
    expect(responsavelSincronizado({ ...args, novo: null })).toBe("X");
  });
  it("conversa e atendimento são atualizados independentemente", () => {
    expect([
      responsavelSincronizado(args),
      responsavelSincronizado({ ...args, atual: "Z" }),
    ]).toEqual(["Y", "Z"]);
  });
  it("repetir a redistribuição não troca de novo", () => {
    expect(responsavelSincronizado({ ...args, atual: "Y" })).toBe("Y");
  });
});

describe("primeira compra real — painel ou equipe", () => {
  const compra = { id: "anterior", cliente_id: "cliente", status: "aprovado" };
  it.each(["aprovado", "convertido"])("%s da equipe impede entrada", (status) => {
    expect(temCompraRealAnterior("cliente", [{ ...compra, status }])).toBe(true);
  });
  it.each(["rejeitado", "expirado", "rascunho", "enviado", "cancelado"])(
    "%s não conta como compra",
    (status) => {
      expect(temCompraRealAnterior("cliente", [{ ...compra, status }])).toBe(false);
    },
  );
  it("exclui o próprio pedido recém-criado", () => {
    expect(temCompraRealAnterior("cliente", [compra], "anterior")).toBe(false);
  });
  it("outro orçamento do mesmo cliente continua contando", () => {
    expect(temCompraRealAnterior("cliente", [compra, { ...compra, id: "atual" }], "atual")).toBe(
      true,
    );
  });
  it("não mistura clientes nem corresponde cliente nulo", () => {
    expect(temCompraRealAnterior("outro", [compra])).toBe(false);
    expect(temCompraRealAnterior(null, [{ ...compra, cliente_id: null }])).toBe(false);
  });
});
