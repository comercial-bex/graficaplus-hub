import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAMILIAS_DE_MATERIAL } from "@/domain/orcamentos/material-do-produto";

const SQL = readFileSync(
  "supabase/migrations/20261025500000_ativar_produtos_da_tabela_de_terceirizados.sql",
  "utf8",
);

describe("migração que ativa os sete produtos da tabela", () => {
  const novos = [
    "Adesivo PROMO",
    "Adesivo perfurado promocional",
    "Adesivo transparente",
    "Adesivo fosco",
    "Adesivo blackout",
    "Lona fosca",
    "Lona backlight",
  ];

  it("dá a cada produto o nome da tabela, sem o sufixo (comparação)", () => {
    for (const nome of novos) expect(SQL, nome).toContain(`'${nome}'`);
  });

  it("os nomes novos são os que a escolha de material espera", () => {
    const esperados = new Set(
      FAMILIAS_DE_MATERIAL.flatMap((f) => f.variantes.map((v) => v.nome.toLowerCase())),
    );
    for (const nome of novos) expect(esperados.has(nome.toLowerCase()), nome).toBe(true);
  });

  it("usa os preços de parceiro da tabela do WhatsApp", () => {
    for (const preco of ["23.90", "34.90", "54.90"]) expect(SQL).toContain(preco);
  });

  it("só mexe em quem ainda está inativo, sem custo e com o nome antigo", () => {
    expect(SQL).toContain("p.ativo = false");
    expect(SQL).toContain("COALESCE(p.custo_medio, 0) = 0");
    expect(SQL).toContain("p.nome = n.nome_antigo");
  });

  it("deixa escrito que o custo e o preço de balcão são provisórios", () => {
    expect(SQL).toContain("PROVISÓRIOS");
  });
});
