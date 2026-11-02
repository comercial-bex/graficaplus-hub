import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fraseDaValidade, resumoDaValidade } from "../src/domain/orcamentos/validade-no-painel";

/**
 * Aviso de validade dos orçamentos no painel inicial (02/11/2026): conta o que
 * vence em até 3 dias e o que já venceu sem resposta, só entre os enviados.
 */

// Data fixa: teste com "hoje" congela o resultado no dia em que foi escrito.
const AGORA = new Date("2026-11-02T12:00:00-03:00");
const dias = (n: number) => new Date(AGORA.getTime() + n * 86_400_000).toISOString();

describe("resumoDaValidade", () => {
  it("separa vencendo, vencido e ignora quem não está enviado ou não tem validade", () => {
    const r = resumoDaValidade(
      [
        { id: "a", status: "enviado", enviado_em: dias(-13), validade_dias: 15 }, // vence em 2 dias
        { id: "b", status: "enviado", enviado_em: dias(-15), validade_dias: 15 }, // vence hoje
        { id: "c", status: "enviado", enviado_em: dias(-20), validade_dias: 15 }, // venceu há 5 dias
        { id: "d", status: "enviado", enviado_em: dias(-2), validade_dias: 15 }, // vence em 13 dias
        { id: "e", status: "rascunho", enviado_em: dias(-20), validade_dias: 15 }, // rascunho não conta
        { id: "f", status: "enviado", enviado_em: null, validade_dias: 15 }, // sem data de envio
        { id: "g", status: "enviado", enviado_em: dias(-1), validade_dias: 0 }, // sem validade
      ],
      AGORA,
    );
    expect(r).toEqual({ vencendo: 2, vencidos: 1, comValidade: 4 });
  });

  it("a janela é ajustável e a lista vazia não avisa nada", () => {
    const lista = [{ status: "enviado", enviado_em: dias(-10), validade_dias: 15 }]; // vence em 5 dias
    expect(resumoDaValidade(lista, AGORA).vencendo).toBe(0);
    expect(resumoDaValidade(lista, AGORA, 7).vencendo).toBe(1);
    expect(fraseDaValidade(resumoDaValidade([], AGORA))).toBeNull();
  });

  it("a frase fala no singular e no plural e junta as duas partes", () => {
    expect(fraseDaValidade({ vencendo: 1, vencidos: 0, comValidade: 3 })).toBe("1 orçamento enviado vence em até 3 dias");
    expect(fraseDaValidade({ vencendo: 0, vencidos: 2, comValidade: 3 })).toBe("2 já passaram da validade sem resposta");
    expect(fraseDaValidade({ vencendo: 2, vencidos: 1, comValidade: 3 })).toBe(
      "2 orçamentos enviados vencem em até 3 dias e 1 já passou da validade sem resposta",
    );
  });
});

describe("o painel mostra o aviso e manda para o quadro", () => {
  it("consulta só os enviados, usa o domínio e aponta para /orcamentos", () => {
    const painel = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
    expect(painel.includes('queryKey: ["dash-orcamentos-vencendo"]')).toBe(true);
    expect(painel.includes('.eq("status", "enviado")')).toBe(true);
    expect(painel.includes("resumoDaValidade(")).toBe(true);
    expect(painel.includes("fraseDaValidade(")).toBe(true);
    expect(painel.includes('data-testid="aviso-validade-orcamentos"')).toBe(true);
  });
});
