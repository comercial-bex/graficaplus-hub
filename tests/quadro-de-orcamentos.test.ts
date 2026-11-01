import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  COLUNAS_DO_QUADRO,
  colunaDoOrcamento,
  idadeEmDias,
  montarQuadro,
  rotuloDaIdade,
  type OrcamentoDoQuadro,
} from "../src/domain/orcamentos/quadro";
import { QuadroDeOrcamentos } from "../src/components/orcamento/quadro-de-orcamentos";

/**
 * Quadro de orçamentos (31/10/2026), Onda 5 do plano
 * `docs/plano-interface-holdprint-31-10-2026.md`: o Painel de Negociação do
 * Holdprint, com o total em dinheiro e a quantidade de cada coluna.
 */

const o = (p: Partial<OrcamentoDoQuadro> & { id: string; status: string }): OrcamentoDoQuadro => ({
  numero: 1,
  titulo: "Chaveiro",
  valor_total: 100,
  cliente_nome: "Cliente",
  os_id: null,
  created_at: "2026-10-20T12:00:00Z",
  ...p,
});

const LISTA: OrcamentoDoQuadro[] = [
  o({ id: "a", status: "rascunho", valor_total: 50 }),
  o({ id: "b", status: "enviado", valor_total: 700 }),
  o({ id: "c", status: "enviado", valor_total: 300 }),
  o({ id: "d", status: "aprovado", valor_total: 1000 }),
  o({ id: "e", status: "aprovado", valor_total: 745, os_id: "os-1" }),
  o({ id: "f", status: "convertido", valor_total: 200 }),
  o({ id: "g", status: "rejeitado", valor_total: 10 }),
  o({ id: "h", status: "expirado", valor_total: 0 }),
];

describe("em que coluna cai cada orçamento", () => {
  it.each([
    ["rascunho", null, "rascunho"],
    ["enviado", null, "enviado"],
    ["aprovado", null, "aprovado"],
    ["rejeitado", null, "rejeitado"],
    ["expirado", null, "expirado"],
    ["convertido", null, "os"],
    ["aprovado", "os-9", "os"],
    ["status-novo-que-ninguem-previu", null, "rascunho"],
  ])("status %s com os_id %s vai para %s", (status, os_id, coluna) => {
    expect(colunaDoOrcamento({ status, os_id })).toBe(coluna);
  });

  it("virar OS é ter os_id: o aprovado com OS não conta como esperando conversão", () => {
    const q = montarQuadro(LISTA, { mostrarValores: true });
    const aprovados = q.find((c) => c.id === "aprovado")!;
    expect(aprovados.itens.map((i) => i.id)).toEqual(["d"]);
    expect(q.find((c) => c.id === "os")!.itens.map((i) => i.id)).toEqual(["e", "f"]);
  });
});

describe("totais do quadro", () => {
  it("cada orçamento aparece em uma coluna só e as seis colunas vêm na ordem do fluxo", () => {
    const q = montarQuadro(LISTA, { mostrarValores: true });
    expect(q.map((c) => c.id)).toEqual(["rascunho", "enviado", "aprovado", "os", "rejeitado", "expirado"]);
    expect(q.reduce((n, c) => n + c.quantidade, 0)).toBe(LISTA.length);
    expect(COLUNAS_DO_QUADRO.filter((c) => c.aberta).map((c) => c.id)).toEqual(["rascunho", "enviado", "aprovado"]);
  });

  it("soma o valor e conta por coluna", () => {
    const q = Object.fromEntries(montarQuadro(LISTA, { mostrarValores: true }).map((c) => [c.id, c]));
    expect(q.enviado.total).toBe(1000);
    expect(q.enviado.quantidade).toBe(2);
    expect(q.aprovado.total).toBe(1000);
    expect(q.os.total).toBe(945);
    expect(q.expirado.total).toBe(0);
  });

  it("sem permissão de preço o total é nulo (somar seria chute), mas a contagem fica", () => {
    const q = montarQuadro(LISTA, { mostrarValores: false });
    expect(q.every((c) => c.total === null)).toBe(true);
    expect(q.find((c) => c.id === "enviado")!.quantidade).toBe(2);
  });

  it("valor ausente, texto ou inválido vale zero, nunca NaN", () => {
    const q = montarQuadro(
      [o({ id: "x", status: "rascunho", valor_total: null }), o({ id: "y", status: "rascunho", valor_total: "12.5" }), o({ id: "z", status: "rascunho", valor_total: "abc" })],
      { mostrarValores: true },
    );
    expect(q[0].total).toBe(12.5);
  });

  it("a idade usa a data de hoje que vem de fora (teste não congela o relógio)", () => {
    const agora = new Date("2026-10-31T12:00:00Z");
    expect(idadeEmDias("2026-10-31T08:00:00Z", agora)).toBe(0);
    expect(idadeEmDias("2026-10-30T11:00:00Z", agora)).toBe(1);
    expect(idadeEmDias("2026-10-20T12:00:00Z", agora)).toBe(11);
    expect(idadeEmDias("2026-11-05T12:00:00Z", agora)).toBe(0);
    expect(idadeEmDias(null, agora)).toBeNull();
    expect(idadeEmDias("lixo", agora)).toBeNull();
    expect(rotuloDaIdade(0)).toBe("criado hoje");
    expect(rotuloDaIdade(1)).toBe("criado há 1 dia");
    expect(rotuloDaIdade(11)).toBe("criado há 11 dias");
    expect(rotuloDaIdade(null)).toBeNull();
  });
});

describe("o quadro na tela", () => {
  const html = (extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(QuadroDeOrcamentos, {
        orcamentos: LISTA,
        mostrarValores: true,
        podeConverter: true,
        agora: new Date("2026-10-31T12:00:00Z"),
        aoAbrir: () => {},
        aoConverter: () => {},
        ...extra,
      }),
    ).replace(/ /g, " ");

  it("cada coluna mostra o nome, o total em reais e a quantidade", () => {
    const h = html();
    expect(h).toContain("Rascunhos");
    expect(h).toContain("Enviados");
    expect(h).toContain("R$ 1.000,00 · ");
    expect(h).toContain("2 orçamentos");
    expect(h).toContain("1 orçamento");
    expect(h).toContain('aria-label="Quadro de orçamentos"');
  });

  it("só o aprovado sem OS leva o botão de converter, e só para quem pode", () => {
    expect((html().match(/Converter em OS/g) ?? []).length).toBe(1);
    expect(html({ podeConverter: false })).not.toContain("Converter em OS");
  });

  it("sem permissão de preço não aparece nenhum valor em reais", () => {
    expect(html({ mostrarValores: false })).not.toContain("R$");
  });

  it("coluna vazia diz o que ela significa, em vez de ficar em branco", () => {
    const h = html({ orcamentos: [] });
    expect(h).toContain("Ainda em montagem, nada foi ao cliente.");
    expect(h).toContain("0 orçamentos");
  });

  it("a letra do quadro não passa abaixo de 14 px nos textos que se leem (sem text-xs nos cartões)", () => {
    expect(/text-xs/.test(html()), "sobrou text-xs no quadro").toBe(false);
  });
});

describe("a página de orçamentos", () => {
  const PAGINA = readFileSync("src/routes/_authenticated/orcamentos.index.tsx", "utf8");

  it("alterna entre lista e quadro, lembra a escolha e usa o filtro de busca nos dois", () => {
    expect(PAGINA).toContain("QuadroDeOrcamentos");
    expect(PAGINA).toContain('"Como ver os orçamentos"');
    expect(PAGINA).toContain("bexprint:orcamentos:visao");
    expect(PAGINA).toContain("orcamentos={filtrados}");
    expect(PAGINA).toContain("mostrarValores={canSeePrices}");
    expect(PAGINA).toContain("podeConverter={podeConverter}");
  });
});
