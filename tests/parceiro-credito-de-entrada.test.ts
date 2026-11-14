import { describe, expect, it } from "vitest";
import {
  deveMostrarAvisoDeEntrada,
  ehPrimeiraCompra,
  fraseDaEntrada,
  lerEntrada,
  tetoDeCreditoDoPedido,
  type ProgramaDeEntrada,
} from "@/domain/parceiros/credito-de-entrada";

const entrada: ProgramaDeEntrada = {
  ativa: true,
  valor: 50,
  validade_dias: 30,
  pedido_minimo: 150,
  max_pct: 50,
};
const teto = (base: number, primeiraCompra = true, e: ProgramaDeEntrada | null = entrada) =>
  tetoDeCreditoDoPedido({ base, primeiraCompra, maxPctGeral: 15, entrada: e });

describe("aviso do crédito de entrada", () => {
  const args = {
    entrada,
    saldo: 50,
    validade: new Date("2026-12-14T16:00:00Z"),
    primeiraCompra: true,
    agora: new Date("2026-11-14T16:00:00Z"),
  };
  it("mostra com programa ativo, saldo de R$50 e validade futura", () =>
    expect(deveMostrarAvisoDeEntrada(args)).toBe(true));
  it("oculta com programa desligado", () =>
    expect(deveMostrarAvisoDeEntrada({ ...args, entrada: { ...entrada, ativa: false } })).toBe(
      false,
    ));
  it("oculta sem o bloco entrada", () =>
    expect(deveMostrarAvisoDeEntrada({ ...args, entrada: null })).toBe(false));
  it("oculta crédito vencido", () =>
    expect(deveMostrarAvisoDeEntrada({ ...args, validade: new Date("2026-11-13T16:00:00Z") })).toBe(
      false,
    ));
  it("oculta no instante em que vence", () =>
    expect(deveMostrarAvisoDeEntrada({ ...args, validade: args.agora })).toBe(false));
  it("oculta com saldo zero", () =>
    expect(deveMostrarAvisoDeEntrada({ ...args, saldo: 0 })).toBe(false));
  it("oculta com saldo negativo", () =>
    expect(deveMostrarAvisoDeEntrada({ ...args, saldo: -1 })).toBe(false));
  it("oculta sem validade calculável", () =>
    expect(deveMostrarAvisoDeEntrada({ ...args, validade: null })).toBe(false));
  it("oculta com data inválida", () =>
    expect(deveMostrarAvisoDeEntrada({ ...args, validade: new Date("inválida") })).toBe(false));
  it("oculta depois da primeira compra", () =>
    expect(deveMostrarAvisoDeEntrada({ ...args, primeiraCompra: false })).toBe(false));
});

describe("teto de crédito do pedido", () => {
  it("abaixo do pedido mínimo vale o teto geral de 15%", () => expect(teto(149.99)).toBe(22.5));
  it("no pedido mínimo de R$ 150 vale 50%", () => expect(teto(150)).toBe(75));
  it("acima do mínimo vale 50%", () => expect(teto(460)).toBe(230));
  it("fora da 1ª compra volta ao teto geral", () => expect(teto(460, false)).toBe(69));
  it("programa desligado volta ao teto geral", () =>
    expect(teto(460, true, { ...entrada, ativa: false })).toBe(69));
  it("sem bloco de entrada no banco volta ao teto geral", () =>
    expect(teto(460, true, null)).toBe(69));
  it("base zero dá teto zero", () => expect(teto(0)).toBe(0));
  it("teto geral maior que o da entrada prevalece", () =>
    expect(
      tetoDeCreditoDoPedido({ base: 200, primeiraCompra: true, maxPctGeral: 60, entrada }),
    ).toBe(120));
  it("sem teto geral configurado o banco usa 100%", () =>
    expect(
      tetoDeCreditoDoPedido({ base: 100, primeiraCompra: false, maxPctGeral: null, entrada }),
    ).toBe(100));
});

describe("leitura tolerante do programa", () => {
  it("programa antigo, sem o bloco entrada, desliga o recurso", () =>
    expect(lerEntrada({ niveis: [], credito_max_pct_pedido: 15 })).toBeNull());
  it("bloco incompleto desliga o recurso", () =>
    expect(lerEntrada({ entrada: { ativa: true, valor: 50 } })).toBeNull());
  it("lê os números quando vêm como texto", () =>
    expect(
      lerEntrada({
        entrada: {
          ativa: true,
          valor: "50.00",
          validade_dias: 30,
          pedido_minimo: "150",
          max_pct: 50,
        },
      }),
    ).toEqual(entrada));
  it("nulo não quebra", () => expect(lerEntrada(null)).toBeNull());
});

describe("1ª compra", () => {
  it("sem pedidos é a 1ª", () => expect(ehPrimeiraCompra([])).toBe(true));
  it("pedidos recusados ou expirados não contam", () =>
    expect(ehPrimeiraCompra([{ pedido_status: "rejeitado" }, { pedido_status: "expirado" }])).toBe(
      true,
    ));
  it("um pedido aprovado já conta", () =>
    expect(ehPrimeiraCompra([{ pedido_status: "aprovado" }])).toBe(false));
});

it("frase da regra sai dos números", () =>
  expect(fraseDaEntrada(entrada)).toBe(
    "Todo parceiro novo ganha R$ 50 ao entrar. Vale 30 dias e só junto com uma 1ª compra de pelo menos R$ 150, cobrindo até 50% do pedido.",
  ));
