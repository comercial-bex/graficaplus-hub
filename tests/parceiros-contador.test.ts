import { describe, expect, it } from "vitest";
import { fechamentoConfere, resumoDoFechamento } from "../src/domain/parceiros/contador";

describe("fechamento do clube", () => {
  it("uso entra positivo na linha de usado, mesmo vindo negativo do extrato", () => {
    const r = resumoDoFechamento([
      { tipo: "cashback", quantidade: 3, valor: 120.5 },
      { tipo: "uso", quantidade: 2, valor: -80 },
    ]);
    expect(r.usado).toBe(80);
    expect(r.concedido).toBe(120.5);
  });

  it("ajuste negativo é correção, não concessão", () => {
    const r = resumoDoFechamento([
      { tipo: "cashback", quantidade: 1, valor: 50 },
      { tipo: "ajuste", quantidade: 1, valor: -30 },
    ]);
    expect(r.ajuste).toBe(-30);
    expect(r.concedido).toBe(50);
  });

  it("ajuste positivo soma em concedido", () => {
    expect(resumoDoFechamento([{ tipo: "ajuste", quantidade: 1, valor: 30 }]).concedido).toBe(30);
  });

  it("aceita número em texto, como o PostgREST às vezes devolve", () => {
    const r = resumoDoFechamento([{ tipo: "recompensa", quantidade: 1, valor: "50.00" }]);
    expect(r.recompensa).toBe(50);
    expect(r.concedido).toBe(50);
  });

  it("período sem movimento fecha em zero", () => {
    const r = resumoDoFechamento([]);
    expect(r).toMatchObject({ cashback: 0, usado: 0, devolvido: 0, concedido: 0 });
  });

  it("o saldo final fecha com o movimento do mês", () => {
    const resumo = resumoDoFechamento([
      { tipo: "cashback", quantidade: 2, valor: 33.78 },
      { tipo: "recompensa", quantidade: 1, valor: 50 },
      { tipo: "uso", quantidade: 1, valor: -30 },
      { tipo: "estorno_uso", quantidade: 1, valor: 10 },
      { tipo: "ajuste", quantidade: 1, valor: -3.78 },
    ]);
    // 100 + (33,78 + 50) − 30 + 10 − 3,78 = 160
    expect(fechamentoConfere({ saldo_anterior: 100, saldo_final: 160, resumo })).toEqual({
      confere: true,
      diferenca: 0,
    });
  });

  it("avisa quando o saldo final não bate com o movimento", () => {
    const resumo = resumoDoFechamento([{ tipo: "cashback", quantidade: 1, valor: 10 }]);
    const r = fechamentoConfere({ saldo_anterior: 0, saldo_final: 25, resumo });
    expect(r.confere).toBe(false);
    expect(r.diferenca).toBe(15);
  });
});
