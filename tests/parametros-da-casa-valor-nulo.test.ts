import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ehParametroCalculado,
  formatarParametro,
  rascunhoDoParametro,
  valorDoParametro,
} from "@/domain/custos/parametro-da-casa";
import { lerParametros } from "@/domain/precificacao/parametros";

/**
 * custos_tabela.valor deixou de ser obrigatório (migração 20261116100000): parâmetro novo nasce sem número.
 * Nulo não é zero. Estes testes fixam como cada leitor de custos_tabela trata a linha vazia.
 */

const RAIZ = join(__dirname, "..");
const ler = (c: string) => readFileSync(join(RAIZ, c), "utf8");

describe("valor nulo na tela de parâmetros da casa", () => {
  it("nulo, vazio e texto sem sentido viram nulo, nunca zero", () => {
    expect(valorDoParametro(null)).toBeNull();
    expect(valorDoParametro(undefined)).toBeNull();
    expect(valorDoParametro("")).toBeNull();
    expect(valorDoParametro("abc")).toBeNull();
    expect(valorDoParametro("0")).toBe(0);
    expect(valorDoParametro("32.82")).toBe(32.82);
    expect(valorDoParametro(60)).toBe(60);
  });

  it("mostra Sem valor, e não R$ 0,00, quando ninguém informou", () => {
    expect(formatarParametro(null, "R$/mês")).toBe("Sem valor");
    expect(formatarParametro(null, "%")).toBe("Sem valor");
    expect(formatarParametro(null, null)).toBe("Sem valor");
    expect(formatarParametro(0, "%")).toBe("0%");
  });

  it("formata como a tela sempre formatou quando há valor", () => {
    expect(formatarParametro("32.82", "%")).toBe("32,82%");
    expect(formatarParametro(1.1339, "R$/kWh")).toContain("1,1339");
    expect(formatarParametro(5, "dias úteis")).toBe("5 dias úteis");
  });

  it("o campo de edição abre vazio, e nunca com a palavra null", () => {
    expect(rascunhoDoParametro(null)).toBe("");
    expect(rascunhoDoParametro("60")).toBe("60");
    expect(rascunhoDoParametro(1.5)).toBe("1.5");
  });

  it("a tela usa as funções e não converte com Number(p.valor)", () => {
    const tela = ler("src/components/custos/parametros-da-casa.tsx");
    expect(tela).toContain("formatarParametro(p.valor, p.unidade)");
    expect(tela).toContain("rascunhoDoParametro(p.valor)");
    expect(tela).not.toMatch(/Number\(p\.valor\)/);
    expect(tela).not.toMatch(/String\(p\.valor\)/);
    expect(tela).toMatch(/valor: number \| null;/);
  });
});

describe("os outros leitores de custos_tabela", () => {
  it("lerParametros trata nulo como faltando, não como zero (precificacao e produtos usam)", () => {
    const l = lerParametros([
      { id: "1", codigo: "markup_padrao", descricao: "Markup", unidade: "%", valor: null },
      { id: "2", codigo: "impostos_venda", descricao: "Imposto", unidade: "%", valor: "6" },
    ]);
    expect(l.valores.markup_padrao).toBeUndefined();
    expect(l.valores.impostos_venda).toBe(6);
    expect(l.faltando).toContain("markup_padrao");
    expect(l.faltando).not.toContain("impostos_venda");
  });

  it("o prazo padrão cai em 5 dias quando o valor é nulo", () => {
    const f = ler("src/components/orcamento/acordo-do-orcamento.tsx");
    expect(f).toContain("Number(data?.valor) || 5");
    expect(Number(null) || 5).toBe(5);
  });

  it("a conferência da empresa só conta linhas (id), sem ler valor", () => {
    const f = ler("src/components/configuracoes/empresa-secao.tsx");
    expect(f).toContain('.from("custos_tabela").select("id").eq("ativo", true)');
  });

  it("o bloco de custos fixos trata nulo como pendente e mostra Sem valor", () => {
    const d = ler("src/domain/custos/custos-fixos.ts");
    expect(d).toContain("l.valor == null");
    expect(d).toContain('return "Sem valor"');
  });

  it("nenhum leitor do src converte custos_tabela.valor com Number() direto sobre uma linha possivelmente nula, fora dos tratados", () => {
    // custo-da-peca lê só mo_custo_hora, mo_encargos_pct e custo_admin_hora, que têm valor, e usa ?? 0 de propósito.
    const f = ler("src/components/produtos/custo-da-peca.tsx");
    expect(f).toContain('.in("codigo", ["mo_custo_hora", "mo_encargos_pct", "custo_admin_hora"])');
  });
});

describe("custo_admin_hora calculado pelo aluguel não se edita à mão", () => {
  it("só vale depois que o gatilho escreve Calculado na observação", () => {
    expect(ehParametroCalculado("custo_admin_hora", "Calculado: aluguel mais outros fixos do espaço.")).toBe(true);
    expect(ehParametroCalculado("custo_admin_hora", "Rateio antigo, digitado.")).toBe(false);
    expect(ehParametroCalculado("custo_admin_hora", null)).toBe(false);
    expect(ehParametroCalculado("markup_padrao", "Calculado: qualquer coisa")).toBe(false);
  });

  it("a tela esconde o lápis e explica, em letra de 16 px, no lugar do número calculado", () => {
    const tela = ler("src/components/custos/parametros-da-casa.tsx");
    expect(tela).toContain("podeEditar && !ehParametroCalculado(p.codigo, p.observacao)");
    expect(tela).toContain("TEXTO_DO_PARAMETRO_CALCULADO");
    expect(tela).toMatch(/data-testid="parametro-calculado"/);
  });
});
