import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FUNCAO_DE_RENOVACAO, argumentosDaRenovacao, podeRenovar } from "../src/domain/orcamentos/renovacao";

/**
 * "Renovar e reenviar" no quadro de orçamentos (02/11/2026): expirado ou
 * enviado vencido volta a Enviado com a validade contando de novo e abre o
 * orçamento para mandar ao cliente. Nada é enviado pelo quadro.
 * Desde 17/11/2026 quem grava é a função do banco `renovar_orcamento_vencido`:
 * a tela nunca faz UPDATE direto de status ou de enviado_em.
 */

const AGORA = new Date("2026-11-02T12:00:00-03:00");
const dias = (n: number) => new Date(AGORA.getTime() + n * 86_400_000).toISOString();
const ler = (c: string) => readFileSync(c, "utf8");

describe("podeRenovar", () => {
  it("expirado com valor pode; expirado vazio (rascunho limpo) não", () => {
    expect(podeRenovar({ status: "expirado", valor_total: 350, enviado_em: dias(-30), validade_dias: null }, AGORA)).toBe(true);
    expect(podeRenovar({ status: "expirado", valor_total: 0, enviado_em: null, validade_dias: null }, AGORA)).toBe(false);
    expect(podeRenovar({ status: "expirado", valor_total: "120.50", enviado_em: dias(-30), validade_dias: 15 }, AGORA)).toBe(true);
  });

  it("expirado que nunca foi enviado não renova: não há o que renovar", () => {
    expect(podeRenovar({ status: "expirado", valor_total: 350, enviado_em: null, validade_dias: 7 }, AGORA)).toBe(false);
  });

  it("enviado vence pelo dia de Brasília, com o último dia valendo inteiro (a régua do link do cliente)", () => {
    // enviado às 10h do dia 1, validade de 7 dias: o último dia é o dia 8, até 23h59.
    const envio = "2026-11-01T10:00:00-03:00";
    const base = { status: "enviado", valor_total: 100, enviado_em: envio, validade_dias: 7 };
    expect(podeRenovar(base, new Date("2026-11-08T10:01:00-03:00"))).toBe(false);
    expect(podeRenovar(base, new Date("2026-11-08T23:59:00-03:00"))).toBe(false);
    expect(podeRenovar(base, new Date("2026-11-09T00:01:00-03:00"))).toBe(true);
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

  it("sem enviado_em o banco conta da criação, e a tela também", () => {
    const base = { status: "enviado", valor_total: 100, enviado_em: null, validade_dias: 15 };
    expect(podeRenovar({ ...base, created_at: dias(-20) }, AGORA)).toBe(true);
    expect(podeRenovar({ ...base, created_at: dias(-5) }, AGORA)).toBe(false);
  });

  it("a renovação chama a função do banco com o id do orçamento", () => {
    expect(FUNCAO_DE_RENOVACAO).toBe("renovar_orcamento_vencido");
    expect(argumentosDaRenovacao("abc")).toEqual({ p_orcamento_id: "abc" });
  });
});

describe("o quadro e a lista", () => {
  it("o cartão oferece Renovar e reenviar só com permissão, e a lista grava e abre o orçamento", () => {
    const quadro = ler("src/components/orcamento/quadro-de-orcamentos.tsx");
    expect(quadro.includes("{podeRenovarOrcamento && aoRenovar && podeRenovar(o, agora) && (")).toBe(true);
    expect(quadro.includes("Renovar e reenviar")).toBe(true);
    // Confirmação em palavras antes de mudar o estado, e a permissão é criar E enviar, como a função do banco.
    expect(quadro.includes("<ConfirmarAcao")).toBe(true);
    expect(quadro.includes("aoConfirmar={() => aoRenovar(o)}")).toBe(true);
    expect(quadro.includes('data-testid="renovar-orcamento"')).toBe(true);
    const lista = ler("src/routes/_authenticated/orcamentos.index.tsx");
    expect(lista.includes("(supabase.rpc as any)(FUNCAO_DE_RENOVACAO, argumentosDaRenovacao(orc.id))")).toBe(true);
    expect(lista.includes("camposDaRenovacao")).toBe(false);
    expect(lista.includes('hasPermission("orcamentos.create") && hasPermission("orcamentos.send")')).toBe(true);
    expect(lista.includes("podeRenovarOrcamento={podeRenovarOrcamento}")).toBe(true);
    expect(lista.includes("if (renovando.current) return;")).toBe(true);
    // Função ausente ou recusa: mensagem simples, nunca UPDATE direto no lugar.
    expect(lista.includes('mensagemDaFuncao(error, "Não foi possível renovar o orçamento.")')).toBe(true);
    const corpo = lista.slice(lista.indexOf("async function renovarOrcamento"), lista.indexOf("async function converterEmOS"));
    expect(corpo.includes(".update(")).toBe(false);
    expect(lista.includes("aoRenovar={(o) => renovarOrcamento(o)}")).toBe(true);
    expect(lista.includes('navigate({ to: "/orcamentos/$id", params: { id: orc.id } });')).toBe(true);
  });
});
