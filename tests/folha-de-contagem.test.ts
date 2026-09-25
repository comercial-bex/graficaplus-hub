import { describe, expect, it } from "vitest";

/**
 * A regra que a folha de contagem não pode perder: LINHA EM BRANCO NÃO É ZERO.
 *
 * É a diferença entre "contei e não tinha nada" e "não cheguei a contar este".
 * Tratar as duas como zero zeraria o estoque de tudo que o operador não
 * alcançou na volta pela oficina — e `ajustar_estoque_material` aceita zero
 * sem reclamar, porque zero contado é uma contagem legítima.
 *
 * O componente é React; o que se testa aqui é a regra pura que ele aplica.
 */

type Linha = { id: string; estoque: number };

const num = (v: string) => {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/** As linhas que viram chamada — as demais o sistema nem toca. */
function preenchidas(materiais: Linha[], contagem: Record<string, string>) {
  return materiais
    .map((m) => ({ material: m, valor: contagem[m.id] ?? "" }))
    .filter((l) => l.valor.trim() !== "");
}

const MATS: Linha[] = [
  { id: "a", estoque: 44 },
  { id: "b", estoque: 0 },
  { id: "c", estoque: 10 },
];

describe("a folha de contagem só mexe no que foi contado", () => {
  it("linha em branco fica de fora", () => {
    const p = preenchidas(MATS, { a: "40" });
    expect(p.map((l) => l.material.id)).toEqual(["a"]);
  });

  it("espaço em branco também é 'não contei'", () => {
    expect(preenchidas(MATS, { a: "   " })).toHaveLength(0);
  });

  it("zero digitado É uma contagem, e entra", () => {
    // Quem escreveu 0 está dizendo "acabou". Isso precisa chegar ao banco.
    const p = preenchidas(MATS, { a: "0" });
    expect(p).toHaveLength(1);
    expect(num(p[0].valor)).toBe(0);
  });

  it("aceita vírgula, que é como se digita em português", () => {
    expect(num("12,5")).toBe(12.5);
  });

  it("texto vira NaN e é recusado antes de chamar o banco", () => {
    expect(Number.isNaN(num("abc"))).toBe(true);
    expect(num("-3") >= 0).toBe(false);
  });

  it("nada preenchido é nada enviado", () => {
    expect(preenchidas(MATS, {})).toHaveLength(0);
  });
});

describe("quais linhas realmente mudam o saldo", () => {
  const mudam = (contagem: Record<string, string>) =>
    preenchidas(MATS, contagem).filter(
      (l) => num(l.valor) >= 0 && num(l.valor) !== l.material.estoque,
    );

  it("contagem igual ao sistema não conta como mudança", () => {
    expect(mudam({ a: "44" })).toHaveLength(0);
  });

  it("contagem diferente conta", () => {
    expect(mudam({ a: "40", c: "10" }).map((l) => l.material.id)).toEqual(["a"]);
  });

  it("zerar um material que tinha saldo é mudança", () => {
    expect(mudam({ a: "0" })).toHaveLength(1);
  });
});
