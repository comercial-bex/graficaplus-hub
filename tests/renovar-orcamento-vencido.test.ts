import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { camposDaRenovacao, podeRenovar } from "../src/domain/orcamentos/renovacao";

/**
 * "Renovar e reenviar" no quadro de orçamentos (02/11/2026): expirado ou
 * enviado vencido volta a Enviado com a validade contando de novo e abre o
 * orçamento para mandar ao cliente. Nada é enviado pelo quadro.
 */

const AGORA = new Date("2026-11-02T12:00:00-03:00");
const dias = (n: number) => new Date(AGORA.getTime() + n * 86_400_000).toISOString();
const ler = (c: string) => readFileSync(c, "utf8");

describe("podeRenovar", () => {
  it("expirado com valor pode; expirado vazio (rascunho limpo) não", () => {
    expect(podeRenovar({ status: "expirado", valor_total: 350, enviado_em: null, validade_dias: null }, AGORA)).toBe(true);
    expect(podeRenovar({ status: "expirado", valor_total: 0, enviado_em: null, validade_dias: null }, AGORA)).toBe(false);
    expect(podeRenovar({ status: "expirado", valor_total: "120.50", enviado_em: null, validade_dias: 15 }, AGORA)).toBe(true);
  });

  it("enviado só quando passou da validade; sem validade conhecida não", () => {
    expect(podeRenovar({ status: "enviado", valor_total: 100, enviado_em: dias(-20), validade_dias: 15 }, AGORA)).toBe(true);
    expect(podeRenovar({ status: "enviado", valor_total: 100, enviado_em: dias(-10), validade_dias: 15 }, AGORA)).toBe(false);
    expect(podeRenovar({ status: "enviado", valor_total: 100, enviado_em: dias(-15), validade_dias: 15 }, AGORA)).toBe(false); // vence hoje
    expect(podeRenovar({ status: "enviado", valor_total: 100, enviado_em: null, validade_dias: 15 }, AGORA)).toBe(false);
  });

  it("aprovado, rejeitado, convertido e rascunho nunca renovam", () => {
    for (const status of ["aprovado", "rejeitado", "convertido", "rascunho"]) {
      expect(podeRenovar({ status, valor_total: 100, enviado_em: dias(-40), validade_dias: 15 }, AGORA), status).toBe(false);
    }
  });

  it("a renovação volta a Enviado e a validade conta a partir de agora", () => {
    expect(camposDaRenovacao(AGORA)).toEqual({ status: "enviado", enviado_em: AGORA.toISOString() });
  });
});

describe("o quadro e a lista", () => {
  it("o cartão oferece Renovar e reenviar só com permissão, e a lista grava e abre o orçamento", () => {
    const quadro = ler("src/components/orcamento/quadro-de-orcamentos.tsx");
    expect(quadro.includes("{podeMover && aoRenovar && podeRenovar(o, agora) && (")).toBe(true);
    expect(quadro.includes("Renovar e reenviar")).toBe(true);
    expect(quadro.includes('data-testid="renovar-orcamento"')).toBe(true);
    const lista = ler("src/routes/_authenticated/orcamentos.index.tsx");
    expect(lista.includes(".update(camposDaRenovacao(new Date()))")).toBe(true);
    expect(lista.includes("aoRenovar={(o) => renovarOrcamento(o)}")).toBe(true);
    // Escrita barrada pela RLS devolve 0 linhas sem erro: a tela confere.
    expect(lista.includes('if (!data || data.length === 0) return toast.error("Seu perfil não pode alterar este orçamento.");')).toBe(true);
    expect(lista.includes('navigate({ to: "/orcamentos/$id", params: { id: orc.id } });')).toBe(true);
  });
});
