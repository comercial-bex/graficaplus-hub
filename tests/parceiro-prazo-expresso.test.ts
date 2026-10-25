import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PRAZO_NORMAL,
  aplicarTaxaDePrazo,
  normalizarPrazos,
  prazoEscolhido,
  rotuloDaPorcentagem,
  taxaDoPrazo,
} from "../src/domain/parceiros/prazo";
import {
  estadoDosPassos,
  type EntradaDosPassos,
} from "../src/domain/parceiros/passos-do-orcamento";
import type { ResumoDoOrcamento } from "../src/domain/parceiros/preco";

/**
 * Prazo e expresso no pedido do parceiro (25/10/2026). O expresso é uma taxa em
 * PORCENTAGEM sobre os produtos — 12%, provisória —, nunca um valor fixo. O banco
 * calcula; a tela antecipa com o mesmo arredondamento.
 */

const MIGRACAO = readFileSync(
  "supabase/migrations/20261025000000_prazo_expresso_parceiro.sql",
  "utf8",
);
const EDITOR = readFileSync("src/components/parceiro/editor-de-orcamento.tsx", "utf8");
const API = readFileSync("src/lib/parceiro-api.ts", "utf8");
const ESCOLHA = readFileSync("src/components/orcamento/escolha-do-prazo.tsx", "utf8");

const resumo = (o: Partial<ResumoDoOrcamento> = {}): ResumoDoOrcamento => ({
  venda: 300,
  custo: 200,
  lucro: 100,
  margemPct: 33.3,
  lucroParcial: false,
  itensDaGrafica: 1,
  itensLivres: 0,
  pendencias: [],
  area: 3,
  ...o,
});

describe("a taxa em porcentagem sobre os produtos", () => {
  it("bate com o que o banco calculou no ensaio de 25/10/2026", () => {
    // base R$ 191,26 (adesivo jateado 1 × 1,5 m, 2 peças): 12% = 22,95 e 11,5% = 21,99
    expect(taxaDoPrazo(191.26, 12)).toBe(22.95);
    expect(taxaDoPrazo(191.26, 11.5)).toBe(21.99);
  });

  it("o mesmo percentual pesa diferente em produtos de preços diferentes", () => {
    expect(taxaDoPrazo(50, 12)).toBe(6);
    expect(taxaDoPrazo(100, 12)).toBe(12);
    expect(taxaDoPrazo(500, 12)).toBe(60);
  });

  it("arredonda para 2 casas, meio centavo para cima, como o round do Postgres", () => {
    expect(taxaDoPrazo(100.05, 12)).toBe(12.01);
    expect(taxaDoPrazo(0.2, 12.5)).toBe(0.03);
    expect(taxaDoPrazo(10.04, 5)).toBe(0.5);
  });

  it("sem base ou sem porcentagem, não há taxa", () => {
    expect(taxaDoPrazo(0, 12)).toBe(0);
    expect(taxaDoPrazo(-5, 12)).toBe(0);
    expect(taxaDoPrazo(100, 0)).toBe(0);
    expect(taxaDoPrazo(Number.NaN, 12)).toBe(0);
  });

  it("escreve a porcentagem como a pessoa lê", () => {
    expect(rotuloDaPorcentagem(12)).toBe("12%");
    expect(rotuloDaPorcentagem(11.5)).toBe("11,5%");
    expect(rotuloDaPorcentagem(12.25)).toBe("12,25%");
  });
});

describe("os prazos que vêm do banco", () => {
  const linhas = [
    {
      chave: "expresso",
      nome: "Expresso",
      descricao: "rápido",
      taxa_percentual: "12.00",
      ordem: 2,
    },
    { chave: "normal", nome: "Normal", descricao: null, taxa_percentual: "0.00", ordem: 1 },
  ];

  it("numeric chega como texto e vira número, na ordem do cadastro", () => {
    const p = normalizarPrazos(linhas);
    expect(p.map((x) => x.chave)).toEqual(["normal", "expresso"]);
    expect(p[1].taxa_percentual).toBe(12);
  });

  it("acha o prazo pela chave; chave desativada ou antiga não acha", () => {
    const p = normalizarPrazos(linhas);
    expect(prazoEscolhido(p, "expresso")?.nome).toBe("Expresso");
    expect(prazoEscolhido(p, "urgente")).toBeNull();
    expect(PRAZO_NORMAL).toBe("normal");
  });
});

describe("o resumo com a taxa dentro", () => {
  it("sobe o que o parceiro paga e desce o ganho na mesma quantia; a venda não muda", () => {
    const r = aplicarTaxaDePrazo(resumo(), 24);
    expect(r.venda).toBe(300);
    expect(r.custo).toBe(224);
    expect(r.lucro).toBe(76);
  });

  it("refaz a margem sobre a mesma venda", () => {
    // venda com custo = lucro + custo = 300; ganho cai para 76: 25,3%
    expect(aplicarTaxaDePrazo(resumo(), 24).margemPct).toBe(25.3);
  });

  it("taxa zero devolve o mesmo resumo", () => {
    const r = resumo();
    expect(aplicarTaxaDePrazo(r, 0)).toBe(r);
  });

  it("sem ganho conhecido, o custo sobe e o ganho segue desconhecido", () => {
    const r = aplicarTaxaDePrazo(resumo({ lucro: null, margemPct: null, custo: 0 }), 10);
    expect(r.lucro).toBeNull();
    expect(r.margemPct).toBeNull();
    expect(r.custo).toBe(10);
  });

  it("o expresso pode deixar o ganho negativo, e o resumo diz a verdade", () => {
    const r = aplicarTaxaDePrazo(resumo({ lucro: 10, custo: 290 }), 24);
    expect(r.lucro).toBe(-14);
  });
});

describe("a barra de passos fala do prazo", () => {
  const entrada = (o: Partial<EntradaDosPassos> = {}): EntradaDosPassos => ({
    clienteNome: "Cliente",
    titulo: "Banner",
    itens: 1,
    itensSemDescricao: 0,
    pendencias: 0,
    vendaTotal: 100,
    validadeDias: 7,
    observacoes: "",
    ...o,
  });

  it("sem prazo com taxa, o passo das condições continua como era", () => {
    const e = estadoDosPassos(entrada())[2];
    expect(e).toMatchObject({ situacao: "vazio", resumo: "vale 7 dias" });
  });

  it("prazo expresso preenche o passo e aparece no resumo", () => {
    const e = estadoDosPassos(entrada({ prazoNome: "expresso" }))[2];
    expect(e).toMatchObject({ situacao: "preenchido", resumo: "vale 7 dias · expresso" });
  });

  it("prazo e observação juntos", () => {
    const e = estadoDosPassos(
      entrada({ prazoNome: "expresso", observacoes: "Retirar na loja" }),
    )[2];
    expect(e.resumo).toBe("vale 7 dias · expresso · com observações");
  });
});

describe("a migração", () => {
  it("só roda sobre a versão da função que foi lida (guarda de md5)", () => {
    expect(MIGRACAO).toContain("2ae9e4a39f43b39539458049cf49370a");
    expect(MIGRACAO).toContain("RAISE EXCEPTION 'parceiro_enviar_pedido mudou");
  });

  it("cria o prazo normal sem taxa e o expresso a 12%, e o normal não pode ganhar taxa nem sumir", () => {
    expect(MIGRACAO).toMatch(/\('normal', 'Normal', [^)]*, 0, 1\)/);
    expect(MIGRACAO).toMatch(/\('expresso', 'Expresso', [^)]*, 12, 2\)/);
    expect(MIGRACAO).toContain("CHECK (chave <> 'normal' OR taxa_percentual = 0)");
    expect(MIGRACAO).toContain("CHECK (chave <> 'normal' OR ativo)");
    expect(MIGRACAO).toContain("taxa_percentual >= 0 AND taxa_percentual <= 100");
  });

  it("todo mundo lê os prazos; só admin e gestor mudam", () => {
    expect(MIGRACAO).toContain("FOR SELECT TO authenticated USING (true)");
    expect(MIGRACAO).toMatch(
      /prazos_gerir[\s\S]*has_role\(auth\.uid\(\), 'admin'\) OR public\.has_role\(auth\.uid\(\), 'gestor'\)/,
    );
  });

  it("o parceiro guarda o prazo no orçamento, e prazo inexistente é recusado pela chave estrangeira", () => {
    expect(MIGRACAO).toContain(
      "ADD COLUMN prazo text NOT NULL DEFAULT 'normal' REFERENCES public.prazos_de_entrega(chave)",
    );
  });

  it("a taxa é uma linha calculada NO BANCO sobre os produtos, com custo zero", () => {
    expect(MIGRACAO).toContain("v_taxa := round(v_base * v_taxa_pct / 100, 2)");
    expect(MIGRACAO).toContain("'taxa_prazo'");
    expect(MIGRACAO).toMatch(/'un', 1, v_taxa, 0, v_n_itens, 'taxa_prazo'/);
  });

  it("o teto de crédito continua sobre os produtos, não sobre a taxa", () => {
    expect(MIGRACAO).toContain("round(v_base * COALESCE((SELECT credito_max_pct_pedido");
    expect(MIGRACAO).not.toContain("round(v_subtotal * COALESCE((SELECT credito_max_pct_pedido");
  });

  it("mantém a assinatura da função e devolve o prazo e a taxa", () => {
    expect(MIGRACAO).toContain(
      "FUNCTION public.parceiro_enviar_pedido(p_orcamento_id uuid, p_usar_credito numeric)",
    );
    expect(MIGRACAO).toContain("'prazo', v_q.prazo, 'taxa_prazo', v_taxa");
  });
});

describe("o editor do parceiro", () => {
  it("lê e grava o prazo do orçamento", () => {
    expect(EDITOR).toContain("validade_dias, prazo, status");
    expect(EDITOR).toContain("prazo: c.prazo || PRAZO_NORMAL");
  });

  it("a duplicata leva o prazo", () => {
    expect(EDITOR).toContain("prazo: cab.prazo || PRAZO_NORMAL");
  });

  it("a taxa vem do domínio e entra no resumo e no pedido, sem soma própria na tela", () => {
    expect(EDITOR).toContain("aplicarTaxaDePrazo(resumoBase, taxaDoPrazoReais)");
    expect(EDITOR).toMatch(/<PedidoDialog[\s\S]*resumo=\{resumo\}/);
    expect(EDITOR).toContain("<EscolhaDoPrazo");
  });

  it("a escolha do prazo só aparece quando há mais de um prazo cadastrado", () => {
    expect(ESCOLHA).toContain("prazos.length < 2");
    expect(ESCOLHA).toContain('data-testid="escolha-do-prazo"');
  });

  it("os prazos vêm de uma consulta própria", () => {
    expect(API).toContain('.from("prazos_de_entrega")');
    expect(API).toContain('.eq("ativo", true)');
  });
});
