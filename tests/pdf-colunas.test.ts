import { describe, expect, it } from "vitest";
import { problemasDoSelect } from "./apoio/contrato-do-banco";
import { SEM_GRANT } from "./apoio/banco-falso-pdf";
import {
  COLUNAS_DA_OS,
  COLUNAS_DE_PRECO_DO_ITEM,
  COLUNAS_DE_PRECO_DO_ORCAMENTO,
  COLUNAS_DO_CLIENTE,
  COLUNAS_DO_ORCAMENTO,
  COLUNAS_DOS_ITENS_DA_OS,
  COLUNAS_DOS_ITENS_DO_ORCAMENTO,
} from "../src/lib/pdf/generate";

/**
 * As listas de colunas do gerador de PDF contra o contrato do banco
 * (src/integrations/supabase/types.ts).
 *
 * Coluna errada num `.select("…")` não é pega pelo TypeScript e derruba a
 * consulta inteira em produção. Era o caso de `custo_previsto` em itens_os e de
 * `prazo`/`condicao_pagamento` pedidos às views de orçamento, que não os têm.
 */

const NIVEIS = ["operacional", "comercial", "financeiro"] as const;

describe("o gerador de PDF só pede colunas que existem", () => {
  it("orçamento: a lista fechada da tabela e o preço das views com valor", () => {
    expect(problemasDoSelect("orcamentos", COLUNAS_DO_ORCAMENTO)).toEqual([]);
    for (const nivel of ["comercial", "financeiro"]) {
      expect(problemasDoSelect(`orcamentos_${nivel}`, COLUNAS_DE_PRECO_DO_ORCAMENTO)).toEqual([]);
    }
  });

  it("itens do orçamento nas três views (preço só nas que têm)", () => {
    for (const nivel of NIVEIS) {
      expect(problemasDoSelect(`orcamento_itens_${nivel}`, COLUNAS_DOS_ITENS_DO_ORCAMENTO)).toEqual(
        [],
      );
    }
    expect(problemasDoSelect("orcamento_itens_comercial", COLUNAS_DE_PRECO_DO_ITEM)).toEqual([]);
    expect(
      problemasDoSelect(
        "orcamento_itens_financeiro",
        `${COLUNAS_DE_PRECO_DO_ITEM}, custo_unitario`,
      ),
    ).toEqual([]);
    expect(problemasDoSelect("orcamento_itens_operacional", COLUNAS_DE_PRECO_DO_ITEM)).not.toEqual(
      [],
    );
  });

  it("OS e itens da OS nas três views", () => {
    for (const nivel of NIVEIS) {
      expect(problemasDoSelect(`ordens_servico_${nivel}`, COLUNAS_DA_OS)).toEqual([]);
      expect(problemasDoSelect(`itens_os_${nivel}`, COLUNAS_DOS_ITENS_DA_OS)).toEqual([]);
    }
    expect(problemasDoSelect("ordens_servico", "endereco_entrega")).toEqual([]);
  });

  it("cliente", () => {
    expect(problemasDoSelect("clientes", COLUNAS_DO_CLIENTE)).toEqual([]);
  });
});

describe("a leitura da TABELA de orçamentos nunca pede dinheiro", () => {
  it("nenhuma coluna sem grant, e nunca `*`", () => {
    const pedidas = COLUNAS_DO_ORCAMENTO.split(",").map((c) => c.trim());
    expect(pedidas).not.toContain("*");
    expect(pedidas.filter((c) => SEM_GRANT.orcamentos.includes(c))).toEqual([]);
  });
});
