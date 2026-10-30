import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  "supabase/migrations/20261030000000_decisoes_dos_sete_e_balcao.sql",
  "utf8",
);

describe("balcão dos sete produtos", () => {
  const precos: [string, number, number][] = [
    ["Adesivo PROMO", 23.9, 40.9],
    ["Adesivo perfurado promocional", 34.9, 59.9],
    ["Adesivo transparente", 34.9, 59.9],
    ["Adesivo fosco", 34.9, 59.9],
    ["Adesivo blackout", 34.9, 59.9],
    ["Lona fosca", 34.9, 59.9],
    ["Lona backlight", 54.9, 93.9],
  ];

  it("é o preço de parceiro vezes 1,7, arredondado para cima ao próximo ,90", () => {
    for (const [nome, parceiro, balcao] of precos) {
      const bruto = parceiro * 1.7;
      const esperado = Math.ceil(bruto - 0.9) + 0.9;
      expect(Math.round(esperado * 100) / 100, nome).toBe(balcao);
      expect(SQL, nome).toContain(`('${nome}'`);
      expect(SQL, nome).toContain(balcao.toFixed(2));
    }
  });

  it("o balcão de um produto promocional não passa o do produto TOP", () => {
    expect(40.9).toBeLessThan(55);
  });
});

describe("o que não se inventa", () => {
  it("não cria material, não mexe em custo nem em ficha", () => {
    expect(SQL).not.toMatch(/INSERT INTO public\.(materiais|produto_materiais)/);
    expect(SQL).not.toMatch(/SET[^;]*custo_medio/i);
    expect(SQL).not.toMatch(/UPDATE public\.materiais/);
  });

  it("só resolve decisão ainda aberta e diz que foi por delegação", () => {
    expect(SQL).toContain("resolvida_em IS NULL");
    expect(SQL.match(/por delegação do dono/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("resolve as sete decisões dos cartões", () => {
    for (const c of [
      "frente_e_verso",
      "convencao_da_bainha",
      "prazo_de_reposicao",
      "fila_no_expresso",
      "rolo_de_vinil_mais_largo",
      "tempos_de_mao_de_obra",
      "materiais_dos_sete_produtos",
    ]) {
      expect(SQL, c).toContain(`'${c}'`);
    }
  });
});
