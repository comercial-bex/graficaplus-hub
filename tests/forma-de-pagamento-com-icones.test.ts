import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const ACORDO = readFileSync("src/components/orcamento/acordo-do-orcamento.tsx", "utf8");
const FORMAS = readFileSync("src/components/pagamento/forma-de-pagamento.tsx", "utf8");
const MARCAS = readFileSync("src/components/pagamento/marcas.tsx", "utf8");
const PIX = readFileSync("src/components/pagamento/pix-do-orcamento.tsx", "utf8");
const SQL = readFileSync("supabase/migrations/20261026400000_pix_da_empresa_e_pix_recebido_na_conversao.sql", "utf8");
const DOMINIO = readFileSync("src/domain/orcamentos/acordo.ts", "utf8");

describe("forma de pagamento com ícones", () => {
  it("as formas são as mesmas que o PDF e a conversão já conhecem", () => {
    for (const forma of ["PIX", "Cartão de crédito", "Cartão de débito", "Dinheiro", "Boleto", "Transferência bancária", "A faturar"]) {
      expect(FORMAS).toContain(`valor: "${forma}"`);
      expect(DOMINIO).toContain(`"${forma}"`);
    }
  });
  it("Pix e bandeiras usam o traçado real (Simple Icons, CC0) e dizem a origem", () => {
    expect(MARCAS).toContain("simpleicons.org");
    for (const marca of ["IconePix", "IconeVisa", "IconeMastercard", "IconeAmex"]) expect(MARCAS).toContain(`export const ${marca}`);
    expect(MARCAS.match(/<path d=/g)?.length).toBe(1); // um <path> compartilhado, quatro traçados em D
    expect(MARCAS).toMatch(/pix: "M5\.283 18\.36/);
  });
  it("a bandeira é opcional e só aparece para cartão", () => {
    expect(ACORDO).toContain('formaGravada === "Cartão de crédito" || formaGravada === "Cartão de débito"');
    expect(FORMAS).toContain("Bandeira (opcional)");
    expect(FORMAS).toContain("onEscolher(ativa ? null : b.valor)");
  });
  it("débito é à vista: grava parcelas = 1 e trava o campo", () => {
    expect(ACORDO).toContain('{ forma: v, parcelas: 1 }');
    expect(ACORDO).toContain('formaGravada === "Cartão de débito"');
  });
  it("o painel do Pix só aparece para PIX, e marcar não confirma pagamento no banco", () => {
    expect(ACORDO).toContain('formaGravada === "PIX"');
    expect(PIX).toContain("Marcar NÃO confirma nada no banco");
    expect(PIX).toContain("O Pix chegou: marcar como recebido");
  });
});

describe("migração do Pix", () => {
  it("lança o Pix recebido como baixa só para quem pode confirmar pagamento, sem duplicar", () => {
    expect(SQL).toContain("public.has_permission(v_uid, ''pagamentos.confirm'')");
    expect(SQL).toContain("''{pix_recebido,lancado}''");
    expect(SQL).toContain("IF position('pix_recebido' IN d) > 0 THEN RETURN; END IF;");
    expect(SQL).toContain("LEAST(v_resto, v_p.valor)");
  });
  it("é acessório: se falhar, avisa e a conversão segue", () => {
    expect(SQL).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(SQL).toContain("Não deu para lançar o Pix recebido");
  });
});
