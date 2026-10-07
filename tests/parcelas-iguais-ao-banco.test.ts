import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parcelasDoOrcamento, valoresDasParcelas } from "../src/domain/orcamentos/acordo";
import { parcelasDoAcordo } from "../src/lib/pdf/formato";

/**
 * As parcelas da tela, do PDF e do banco não podem discordar em um centavo:
 * o cliente assina o documento, e a conta a receber nasce na conversão.
 *
 * A regra do banco, como está no corpo VIVO de `converter_orcamento_em_os`
 * (lido de pg_proc.prosrc em 06/10/2026, antes e depois da migração
 * 20261006230000 — ela regrava a função e mantém estas linhas):
 */
const REGRA_DO_BANCO = [
  "v_parcelas  := GREATEST(1, COALESCE((v_orc.condicao_pagamento->>'parcelas')::int, 1));",
  "v_valor_parcela := round(COALESCE(v_orc.valor_total, 0) / v_parcelas, 2);",
  "CASE WHEN v_i < v_parcelas THEN v_valor_parcela",
  "ELSE COALESCE(v_orc.valor_total, 0) - v_acumulado END,",
  "v_acumulado := v_acumulado + v_valor_parcela;",
];

/**
 * A mesma regra com aritmética EXATA, como o `numeric` do Postgres — BigInt em
 * centavos, sem ponto flutuante em lugar nenhum. `round(x, 2)` do Postgres
 * leva o meio para longe do zero; para total ≥ 0, round(T ÷ n) =
 * ⌊(2T + n) ÷ 2n⌋. A última parcela é o total menos o que as outras somaram.
 */
function parcelasDoBanco(totalCentavos: bigint, n: bigint): { porParcela: bigint; ultima: bigint } {
  const porParcela = (2n * totalCentavos + n) / (2n * n);
  // o laço do banco soma v_valor_parcela n − 1 vezes; em inteiro exato é o produto
  const acumulado = porParcela * (n - 1n);
  return { porParcela, ultima: totalCentavos - acumulado };
}

/** A conta que a tela fazia antes (ponto flutuante) — para mostrar o defeito. */
function parcelasAntigas(total: number, n: number): number[] {
  const valor = Math.round((total / n) * 100) / 100;
  const ultima = Math.round((total - valor * (n - 1)) * 100) / 100;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? ultima : valor));
}

const centavos = (v: number) => Math.round(v * 100);

/** Compara a divisão da tela com o banco; devolve a primeira diferença, ou null. */
function diferenca(totalC: number, n: number): string | null {
  const banco = parcelasDoBanco(BigInt(totalC), BigInt(n));
  const tela = valoresDasParcelas(totalC / 100, n).map(centavos);
  for (let i = 0; i < n; i++) {
    const esperado = Number(i === n - 1 ? banco.ultima : banco.porParcela);
    if (tela[i] !== esperado)
      return `R$ ${totalC / 100} em ${n}x, parcela ${i + 1}: tela ${tela[i]}, banco ${esperado}`;
  }
  return null;
}

describe("as parcelas da tela são as do banco", () => {
  it("a regra reimplementada aqui é a que está na função de conversão", () => {
    // Se a conta da conversão mudar, este teste aponta antes de alguém
    // confiar numa reimplementação velha.
    const pasta = "supabase/migrations";
    const ultima = readdirSync(pasta)
      .filter((nome) => nome.endsWith(".sql"))
      .sort()
      .filter((nome) =>
        readFileSync(join(pasta, nome), "utf8").includes(
          "CREATE OR REPLACE FUNCTION public.converter_orcamento_em_os(",
        ),
      )
      .pop();
    expect(ultima).toBeDefined();
    const corpo = readFileSync(join(pasta, ultima as string), "utf8");
    for (const linha of REGRA_DO_BANCO) expect(corpo).toContain(linha);
  });

  it("o caso que mordia: R$ 501,15 em 10x é 50,12 (e a conta antiga dava 50,11)", () => {
    const p = valoresDasParcelas(501.15, 10);
    expect(p.slice(0, 9).every((v) => v === 50.12)).toBe(true);
    expect(p[9]).toBe(50.07);
    expect(parcelasAntigas(501.15, 10)[0]).toBe(50.11);
    expect(diferenca(50115, 10)).toBeNull();
  });

  it("todo centavo de R$ 0,01 a R$ 300,00, de 1 a 12 parcelas", () => {
    const erros: string[] = [];
    for (let t = 1; t <= 30_000; t++) {
      for (let n = 1; n <= 12; n++) {
        const d = diferenca(t, n);
        if (d && erros.length < 5) erros.push(d);
      }
    }
    expect(erros).toEqual([]);
  });

  it("de R$ 0,01 a R$ 20.000,00 (passo de 37 centavos), 2 a 12 parcelas — e a conta antiga errava", () => {
    let combinacoes = 0;
    let antigasErradas = 0;
    const erros: string[] = [];
    for (let t = 1; t <= 2_000_000; t += 37) {
      for (let n = 2; n <= 12; n++) {
        combinacoes++;
        const d = diferenca(t, n);
        if (d && erros.length < 5) erros.push(d);
        const banco = parcelasDoBanco(BigInt(t), BigInt(n));
        if (centavos(parcelasAntigas(t / 100, n)[0]) !== Number(banco.porParcela)) antigasErradas++;
      }
    }
    expect(erros).toEqual([]);
    // O defeito era real: a conta antiga discordava em ~1 de cada 116.
    expect(antigasErradas).toBeGreaterThan(combinacoes / 200);
    expect(antigasErradas).toBeLessThan(combinacoes / 60);
  });

  it("a tela (parcelasDoOrcamento) e o PDF (parcelasDoAcordo) dividem igual, com as mesmas datas", () => {
    for (const [total, n] of [
      [501.15, 10],
      [100, 3],
      [0.29, 2],
      [1365, 3],
      [819, 3],
      [0.07, 12],
    ] as const) {
      const condicao = { parcelas: n, intervalo_dias: 30, primeiro_vencimento: "2026-11-10" };
      expect(parcelasDoOrcamento(total, condicao)).toEqual(parcelasDoAcordo(total, condicao));
    }
    // O ensaio da conversão (06/10/2026): R$ 819,00 em 3x a cada 30 dias.
    expect(
      parcelasDoOrcamento(819, {
        parcelas: 3,
        intervalo_dias: 30,
        primeiro_vencimento: "2026-11-10",
      }),
    ).toEqual([
      { numero: 1, valor: 273, vencimento: "2026-11-10" },
      { numero: 2, valor: 273, vencimento: "2026-12-10" },
      { numero: 3, valor: 273, vencimento: "2027-01-09" },
    ]);
  });
});
