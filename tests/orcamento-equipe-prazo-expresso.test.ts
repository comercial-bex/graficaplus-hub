import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EscolhaDoPrazo } from "../src/components/orcamento/escolha-do-prazo";
import { normalizarPrazos } from "../src/domain/parceiros/prazo";

/**
 * Prazo e expresso no orçamento da EQUIPE e na conversão em OS (25/10/2026). A
 * regra é a do parceiro — taxa em % sobre os produtos, hoje 12% — e quem mantém a
 * linha da taxa é o gatilho do banco. A tela escolhe o prazo e mostra a linha.
 */

const MIGRACAO = readFileSync(
  "supabase/migrations/20261025010000_prazo_expresso_equipe.sql",
  "utf8",
);
const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
const PRAZO = readFileSync("src/components/orcamento/prazo-de-producao.tsx", "utf8");
const ACORDO = readFileSync("src/components/orcamento/acordo-do-orcamento.tsx", "utf8");

const prazos = normalizarPrazos([
  {
    chave: "normal",
    nome: "Normal",
    descricao: "Prazo da gráfica.",
    taxa_percentual: "0.00",
    ordem: 1,
  },
  {
    chave: "expresso",
    nome: "Expresso",
    descricao: "Mais rápido.",
    taxa_percentual: "12.00",
    ordem: 2,
  },
]);

describe("a escolha do prazo (a mesma na equipe e no parceiro)", () => {
  const html = (o: Partial<Parameters<typeof EscolhaDoPrazo>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(EscolhaDoPrazo, {
        prazos,
        escolhido: "normal",
        baseDaTaxa: 200,
        desabilitado: false,
        onEscolher: () => {},
        ajuda: "Texto de ajuda",
        ...o,
      }),
    );

  it("mostra Normal sem taxa e Expresso com a porcentagem e o valor em reais", () => {
    const h = html();
    expect(h).toContain("Normal");
    expect(h).toContain("sem taxa");
    expect(h).toContain("Expresso");
    expect(h).toContain("+12% sobre os produtos");
    expect(h).toContain("R$");
    expect(h).toContain("24,00");
  });

  it("quem não vê preço vê a porcentagem, nunca o valor", () => {
    const h = html({ baseDaTaxa: null });
    expect(h).toContain("+12% sobre os produtos");
    expect(h).not.toContain("R$");
  });

  it("um prazo só (o normal) não é escolha: não pergunta nada", () => {
    expect(html({ prazos: prazos.slice(0, 1) })).toBe("");
  });

  it("orçamento fechado não deixa trocar", () => {
    expect(html({ desabilitado: true })).toContain("disabled");
  });
});

describe("a migração da equipe", () => {
  it("só roda sobre as versões das duas funções que foram lidas (guarda de md5)", () => {
    expect(MIGRACAO).toContain("9ae3491761573c07664421dbbe5dbf15");
    expect(MIGRACAO).toContain("0e261099f03d899f43fe15a781fe0ed4");
  });

  it("a coluna se chama prazo_tipo, porque orcamentos.prazo já é a DATA de entrega", () => {
    expect(MIGRACAO).toContain(
      "ADD COLUMN prazo_tipo text NOT NULL DEFAULT 'normal' REFERENCES public.prazos_de_entrega(chave)",
    );
    expect(MIGRACAO).not.toMatch(/ALTER TABLE public\.orcamentos\s+ADD COLUMN prazo text/);
  });

  it("a linha da taxa é UMA só, por último, sem produto, com custo 0 e reconhecível pela tela (tipo_produto)", () => {
    expect(MIGRACAO).toContain("v_taxa := round(v_base * v_pz.taxa_percentual / 100, 2)");
    expect(MIGRACAO).toContain("COALESCE(max(ordem), -1) + 1");
    expect(MIGRACAO).toMatch(
      /p_orc, v_desc, 'un', 1, v_taxa, 0, v_ordem, 'taxa_prazo', 'taxa_prazo'/,
    );
  });

  it("o gatilho recalcula em qualquer mudança de item e na troca de prazo, sem laço", () => {
    expect(MIGRACAO).toContain("AFTER INSERT OR UPDATE OR DELETE ON public.orcamento_itens");
    expect(MIGRACAO).toContain("AFTER UPDATE OF prazo_tipo ON public.orcamentos");
    expect(MIGRACAO).toContain("IF v_eh_taxa AND TG_OP <> 'DELETE' THEN RETURN NULL; END IF;");
  });

  it("orçamento que já virou OS não é recalculado", () => {
    expect(MIGRACAO).toContain(
      "IF v_o.os_id IS NOT NULL OR v_o.status = 'convertido' THEN RETURN; END IF;",
    );
  });

  it("a conversão em OS ignora a linha da taxa no 'item sem custo', prioriza e avisa", () => {
    expect(MIGRACAO).toContain("AND i.origem_calculo IS DISTINCT FROM 'taxa_prazo';");
    expect(MIGRACAO).toContain("responsavel_id, prioridade");
    expect(MIGRACAO).toContain(
      "pz.prioridade_os FROM public.prazos_de_entrega pz WHERE pz.chave = v_orc.prazo_tipo",
    );
    expect(MIGRACAO).toContain("': produção prioritária.'");
  });

  it("cada trecho trocado nas funções tem de existir exatamente uma vez", () => {
    expect(MIGRACAO).toContain("Trecho esperado não encontrado exatamente uma vez");
  });

  it("o expresso vira prioridade 2 (Alta) na OS, e a escala vai de 1 a 5", () => {
    expect(MIGRACAO).toContain(
      "prioridade_os smallint NOT NULL DEFAULT 3 CHECK (prioridade_os BETWEEN 1 AND 5)",
    );
    expect(MIGRACAO).toContain(
      "UPDATE public.prazos_de_entrega SET prioridade_os = 2 WHERE chave = 'expresso'",
    );
  });

  it("as funções de apoio não são chamáveis pelo navegador", () => {
    for (const f of [
      "recalcular_taxa_prazo(uuid)",
      "tg_orcamento_itens_taxa_prazo()",
      "tg_orcamento_prazo_tipo_taxa()",
    ]) {
      expect(MIGRACAO).toContain(
        `REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated`,
      );
    }
  });

  it("o pedido do parceiro grava o prazo no orçamento da equipe em vez de montar a linha", () => {
    expect(MIGRACAO).toContain("condicao_pagamento, prazo_tipo");
    expect(MIGRACAO).toContain("7, '{\"parcelas\": 1}'::jsonb, v_q.prazo");
  });
});

describe("a tela da equipe", () => {
  it("o prazo de produção abre o passo das condições", () => {
    const i = TELA.indexOf("{passo === 3 && (");
    const trecho = TELA.slice(i, TELA.indexOf("{passo === 4 && (", i));
    expect(trecho.indexOf("<PrazoDeProducao")).toBeGreaterThan(0);
    expect(trecho.indexOf("<PrazoDeProducao")).toBeLessThan(trecho.indexOf("<EntregaEPrazos"));
  });

  it("trocar o prazo só grava prazo_tipo e relê itens e totais — a linha é do banco", () => {
    expect(PRAZO).toContain(".update({ prazo_tipo: chave })");
    expect(PRAZO).toContain('queryKey: ["orc-itens", orcamentoId]');
    expect(PRAZO).not.toMatch(/\.from\("orcamento_itens"\)\s*\.(insert|update|delete)/);
  });

  it("a coluna prazo_tipo vem junto com o acordo", () => {
    expect(ACORDO).toContain("prazo_tipo: string | null;");
    expect(ACORDO).toMatch(/COLUNAS_DO_ACORDO =\s*"[^"]*prazo_tipo"/);
  });

  it("a linha da taxa é reconhecida por tipo_produto (as visões não trazem origem_calculo)", () => {
    expect(TELA).toContain('i.tipo_produto !== "taxa_prazo"');
    expect(TELA).toContain('i.tipo_produto === "taxa_prazo"');
    expect(TELA).not.toContain('origem_calculo === "taxa_prazo"');
  });

  it("a linha da taxa não é item para editar, mover, pedir arte nem pedir produto", () => {
    expect(TELA).toContain("const itensDeProduto =");
    expect(TELA).toContain("reordenar(itensDeProduto, indice, indice + passo)");
    expect(TELA).toContain("itens: itensDeProduto as { arquivo_id: string | null }[]");
    expect(TELA).toContain("(itensDeProduto as any[]).filter((i) => !i.arquivo_id)");
    expect(TELA).toContain("disabled={indice === itensDeProduto.length - 1}");
  });

  it("a taxa aparece na tabela como linha própria, sem botões de ação", () => {
    const i = TELA.indexOf('data-taxa-prazo=""');
    expect(i).toBeGreaterThan(0);
    const linha = TELA.slice(i, TELA.indexOf("</TableRow>", i));
    expect(linha).not.toContain("<Button");
    expect(linha).toContain("Calculada sozinha");
  });

  it("o cabeçalho avisa 'Expresso', o resumo mostra a taxa e a revisão diz o prazo", () => {
    expect(TELA).toContain('<StatusChip label="Expresso" tone="amber" />');
    expect(TELA).toContain("Prazo de produção");
    expect(TELA).toMatch(/Expresso \(\+\{rotuloDaPorcentagem\(taxaDoPrazoDoOrcamento\)\}\)/);
  });

  it("a taxa só aparece para quem vê preço", () => {
    expect(TELA).toMatch(/canSeePrices && linhaDaTaxa && \(/);
  });
});
