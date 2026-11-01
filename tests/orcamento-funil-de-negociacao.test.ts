import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  COLUNAS_DO_ENVIADO,
  ETAPAS_DO_ENVIADO,
  colunaDoOrcamento,
  etapaParaGravar,
  montarQuadro,
  rotuloDaValidade,
  validadeDoOrcamento,
  type OrcamentoDoQuadro,
} from "../src/domain/orcamentos/quadro";
import { QuadroDeOrcamentos } from "../src/components/orcamento/quadro-de-orcamentos";

/**
 * Funil de negociação do orçamento (01/11/2026): "Em negociação" e "Aceite verbal" entre Enviados
 * e Aprovados, e a validade à vista, como no Painel de Negociação do Holdprint. É melhoria em
 * cima do orçamento que já existe (inclusive o 3D): o status não muda.
 */

const AGORA = new Date("2026-11-01T12:00:00Z");
const o = (p: Partial<OrcamentoDoQuadro>): OrcamentoDoQuadro => ({ id: "x", status: "enviado", numero: 1, valor_total: 100, ...p });

describe("em que coluna cai o orçamento", () => {
  it("enviado sem etapa fica em Enviados; com etapa, na etapa dele", () => {
    expect(colunaDoOrcamento({ status: "enviado" })).toBe("enviado");
    expect(colunaDoOrcamento({ status: "enviado", etapa_comercial: null })).toBe("enviado");
    expect(colunaDoOrcamento({ status: "enviado", etapa_comercial: "em_negociacao" })).toBe("em_negociacao");
    expect(colunaDoOrcamento({ status: "enviado", etapa_comercial: "aceite_verbal" })).toBe("aceite_verbal");
  });

  it("etapa que o sistema não conhece não inventa coluna", () => {
    expect(colunaDoOrcamento({ status: "enviado", etapa_comercial: "xyz" })).toBe("enviado");
  });

  it("a etapa só vale para orçamento enviado: aprovado, rejeitado e expirado ignoram o que sobrou", () => {
    for (const status of ["aprovado", "rejeitado", "expirado", "rascunho"]) {
      const esperada = status === "rascunho" ? "rascunho" : status;
      expect(colunaDoOrcamento({ status, etapa_comercial: "em_negociacao" }), status).toBe(esperada);
    }
  });

  it("virar OS manda mais que tudo", () => {
    expect(colunaDoOrcamento({ status: "enviado", os_id: "os1", etapa_comercial: "aceite_verbal" })).toBe("os");
  });
});

describe("o quadro com as etapas", () => {
  it("conta e soma cada orçamento numa coluna só", () => {
    const lista = [
      o({ id: "a", valor_total: 100 }),
      o({ id: "b", etapa_comercial: "em_negociacao", valor_total: 250 }),
      o({ id: "c", etapa_comercial: "em_negociacao", valor_total: 50 }),
      o({ id: "d", etapa_comercial: "aceite_verbal", valor_total: 900 }),
      o({ id: "e", status: "aprovado", valor_total: 40 }),
    ];
    const q = Object.fromEntries(montarQuadro(lista, { mostrarValores: true }).map((c) => [c.id, c]));
    expect([q.enviado.quantidade, q.enviado.total]).toEqual([1, 100]);
    expect([q.em_negociacao.quantidade, q.em_negociacao.total]).toEqual([2, 300]);
    expect([q.aceite_verbal.quantidade, q.aceite_verbal.total]).toEqual([1, 900]);
    expect([q.aprovado.quantidade, q.aprovado.total]).toEqual([1, 40]);
  });

  it("quem não vê preço não vê a soma, também nas colunas novas", () => {
    const q = montarQuadro([o({ etapa_comercial: "aceite_verbal" })], { mostrarValores: false });
    expect(q.find((c) => c.id === "aceite_verbal")?.total).toBeNull();
  });
});

describe("a etapa na hora de gravar", () => {
  it("enviado sem resposta é a ausência de etapa", () => {
    expect(etapaParaGravar("enviado")).toBeNull();
    expect(etapaParaGravar("em_negociacao")).toBe("em_negociacao");
    expect(etapaParaGravar("aceite_verbal")).toBe("aceite_verbal");
  });

  it("as três etapas, na ordem da conversa, e as colunas onde se muda", () => {
    expect(ETAPAS_DO_ENVIADO.map((e) => e.id)).toEqual(["enviado", "em_negociacao", "aceite_verbal"]);
    expect([...COLUNAS_DO_ENVIADO]).toEqual(["enviado", "em_negociacao", "aceite_verbal"]);
  });
});

describe("validade do orçamento enviado", () => {
  const enviado = "2026-10-25T12:00:00Z";

  it("conta os dias que faltam a partir do envio e da validade", () => {
    expect(validadeDoOrcamento({ enviado_em: enviado, validade_dias: 10 }, AGORA)).toEqual({ dias: 3, vencido: false, urgente: true });
    expect(validadeDoOrcamento({ enviado_em: enviado, validade_dias: 15 }, AGORA)).toEqual({ dias: 8, vencido: false, urgente: false });
  });

  it("vencida: dias negativos e urgente", () => {
    expect(validadeDoOrcamento({ enviado_em: enviado, validade_dias: 5 }, AGORA)).toEqual({ dias: -2, vencido: true, urgente: true });
  });

  it("sem envio ou sem validade não inventa prazo", () => {
    expect(validadeDoOrcamento({ enviado_em: null, validade_dias: 10 }, AGORA)).toBeNull();
    expect(validadeDoOrcamento({ enviado_em: enviado, validade_dias: null }, AGORA)).toBeNull();
    expect(validadeDoOrcamento({ enviado_em: enviado, validade_dias: 0 }, AGORA)).toBeNull();
    expect(validadeDoOrcamento({ enviado_em: "lixo", validade_dias: 10 }, AGORA)).toBeNull();
  });

  it("o rótulo diz em palavras", () => {
    const r = (dias: number) => rotuloDaValidade({ dias, vencido: dias < 0, urgente: dias <= 3 });
    expect(r(0)).toBe("vence hoje");
    expect(r(1)).toBe("vence amanhã");
    expect(r(7)).toBe("vence em 7 dias");
    expect(r(-1)).toBe("venceu ontem");
    expect(r(-4)).toBe("venceu há 4 dias");
    expect(rotuloDaValidade(null)).toBeNull();
  });
});

describe("o quadro na tela", () => {
  const lista = [
    o({ id: "a", numero: 11, titulo: "Banner", enviado_em: "2026-10-25T12:00:00Z", validade_dias: 10 }),
    o({ id: "b", numero: 12, titulo: "Placa", etapa_comercial: "em_negociacao", enviado_em: "2026-10-30T12:00:00Z", validade_dias: 15 }),
    o({ id: "c", numero: 13, titulo: "Cartão", status: "aprovado" }),
  ];
  const html = (podeMover: boolean) =>
    renderToStaticMarkup(
      createElement(QuadroDeOrcamentos, {
        orcamentos: lista,
        mostrarValores: true,
        podeConverter: false,
        podeMover,
        agora: AGORA,
        aoAbrir: () => {},
        aoConverter: () => {},
        aoMoverEtapa: () => {},
      }),
    );

  it("tem as colunas novas com o nome do Holdprint", () => {
    const h = html(false);
    expect(h.includes("Em negociação"), "Em negociação").toBe(true);
    expect(h.includes("Aceite verbal"), "Aceite verbal").toBe(true);
  });

  it("mostra a validade nos enviados e destaca a que está perto de vencer", () => {
    const h = html(false);
    expect(h.includes("Validade: vence em 3 dias"), "Validade: vence em 3 dias").toBe(true);
    expect(h.includes('data-validade="urgente"'), 'data-validade="urgente"').toBe(true);
    expect(h.includes("Validade: vence em 13 dias"), "Validade: vence em 13 dias").toBe(true);
    expect(h.includes('data-validade="ok"'), 'data-validade="ok"').toBe(true);
  });

  it("quem pode editar vê o seletor de etapa em cada enviado, com rótulo e a etapa atual marcada; os demais não", () => {
    const com = html(true);
    expect((com.match(/<select/g) ?? []).length).toBe(2); // só os dois enviados; o aprovado não tem
    expect(com.includes("Etapa do orçamento 12"), "Etapa do orçamento 12").toBe(true);
    expect(/<option value="em_negociacao" selected/.test(com), "etapa atual marcada").toBe(true);
    expect(html(false).includes("<select")).toBe(false);
  });
});

describe("a tela de orçamentos e o banco", () => {
  const PAGINA = readFileSync("src/routes/_authenticated/orcamentos.index.tsx", "utf8");
  const SQL = readFileSync("supabase/migrations/20261101190000_orcamento_etapa_comercial.sql", "utf8");
  const CODIGO = SQL.replace(/^\s*--.*$/gm, "");
  const TIPOS = readFileSync("src/integrations/supabase/types.ts", "utf8");

  it("mudar a etapa é editar o orçamento: a permissão é a que o banco cobra", () => {
    expect(PAGINA).toContain('const podeMoverEtapa = hasPermission("orcamentos.create");');
    expect(PAGINA).toContain(".update({ etapa_comercial: etapaParaGravar(etapa) })");
    expect(PAGINA).toContain("podeMover={podeMoverEtapa}");
  });

  it("na lista, o orçamento enviado mostra a etapa ao lado do status", () => {
    expect(PAGINA).toContain('o.status === "enviado" && o.etapa_comercial');
  });

  it("o banco guarda a etapa à parte do status, aceita só as duas e a limpa quando o status sai de enviado", () => {
    expect(CODIGO).toContain("ADD COLUMN IF NOT EXISTS etapa_comercial text");
    expect(CODIGO).toContain("etapa_comercial IN ('em_negociacao', 'aceite_verbal')");
    expect(CODIGO).toContain("IF NEW.status::text <> 'enviado' THEN");
    expect(CODIGO).toContain("NEW.etapa_comercial := NULL");
    expect(CODIGO).toContain("BEFORE INSERT OR UPDATE ON public.orcamentos");
  });

  it("não mexe no status nem apaga nada", () => {
    expect(CODIGO).not.toMatch(/ALTER TYPE|status_orcamento/i);
    expect(CODIGO).not.toMatch(/\b(DELETE|DROP TABLE|DROP COLUMN|TRUNCATE)\b/i);
  });

  it("a função de gatilho não é para ninguém chamar", () => {
    expect(CODIGO).toContain("REVOKE ALL ON FUNCTION public.tg_orcamento_etapa_so_enquanto_enviado() FROM PUBLIC, anon, authenticated;");
  });

  it("os tipos gerados conhecem a etapa no Row, no Insert e no Update", () => {
    const ini = TIPOS.indexOf("      orcamentos: {\n");
    const fim = TIPOS.indexOf("\n      }", TIPOS.indexOf("Update: {", ini));
    expect(TIPOS.slice(ini, fim).match(/\n\s+etapa_comercial\??: string \| null/g)).toHaveLength(3);
  });
});
