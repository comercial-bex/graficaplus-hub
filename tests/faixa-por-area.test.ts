import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { precoMedioDoM2, valorDaLinhaPorArea } from "@/domain/orcamentos/faixa-por-area";
import {
  aplicarFaixasPorArea,
  custoDoItem,
  type ItemDoCatalogo,
  type ItemDoOrcamento,
} from "@/domain/parceiros/preco";

const FAIXA = { acimaDeM2: 6, precoAcima: 27.9 };

describe("faixa por área (progressiva, por linha)", () => {
  it("até o limite cobra o preço cheio", () => {
    expect(valorDaLinhaPorArea(6, 29.9, FAIXA)).toBe(179.4);
    expect(valorDaLinhaPorArea(2.5, 29.9, FAIXA)).toBe(74.75);
  });

  it("só o que passa do limite ganha o preço menor", () => {
    expect(valorDaLinhaPorArea(8, 29.9, FAIXA)).toBe(235.2); // 6×29,90 + 2×27,90
  });

  it("não tem degrau: a linha maior nunca custa menos que a menor", () => {
    let anterior = 0;
    for (let a = 0.1; a <= 30; a = Math.round((a + 0.07) * 100) / 100) {
      const v = valorDaLinhaPorArea(a, 29.9, FAIXA);
      expect(v).toBeGreaterThanOrEqual(anterior);
      anterior = v;
    }
    expect(valorDaLinhaPorArea(6.02, 29.9, FAIXA)).toBeGreaterThan(
      valorDaLinhaPorArea(6, 29.9, FAIXA),
    );
  });

  it("sem faixa, é preço × área", () => {
    expect(valorDaLinhaPorArea(10, 29.9, null)).toBe(299);
  });

  it("o preço médio cai conforme a linha passa do limite", () => {
    expect(precoMedioDoM2(6, 29.9, FAIXA)).toBe(29.9);
    expect(precoMedioDoM2(12, 29.9, FAIXA)).toBe(28.9);
  });
});

const adesivo: ItemDoCatalogo = {
  produto_id: "p1",
  nome: "Adesivo vinil branco impresso",
  categoria: "adesivos",
  unidade: "m2",
  por_area: true,
  area_minima: null,
  preco_referencia: 55,
  preco_parceiro: 29.9,
  origem: "tabela" as never,
  oferta_id: null,
  oferta_titulo: null,
  faixas: null,
  tamanhos: [],
};

const item = (largura: number, altura: number, quantidade = 1): ItemDoOrcamento =>
  ({
    produto_id: "p1",
    descricao: "x",
    unidade: "m2",
    largura,
    altura,
    quantidade,
    preco_venda_unidade: 0,
  }) as unknown as ItemDoOrcamento;

describe("custoDoItem com faixa por área", () => {
  const [comFaixa] = aplicarFaixasPorArea(
    [adesivo],
    [{ produto_id: "p1", acima_de_m2: 6, preco_acima: 27.9 }],
  );

  it("linha de 8 m² (4 × 2 m) usa a faixa", () => {
    const c = custoDoItem(item(4, 2), comFaixa);
    expect(c.tipo).toBe("ok");
    if (c.tipo === "ok") expect(c.total).toBe(235.2);
  });

  it("duas peças de 4 m² na MESMA linha somam 8 m² e usam a faixa", () => {
    const c = custoDoItem(item(2, 2, 2), comFaixa);
    if (c.tipo === "ok") expect(c.total).toBe(235.2);
  });

  it("abaixo do limite não muda nada", () => {
    const c = custoDoItem(item(2, 2), comFaixa);
    if (c.tipo === "ok") expect(c.total).toBe(119.6);
  });

  it("produto sem faixa continua preço × área", () => {
    const [semFaixa] = aplicarFaixasPorArea([adesivo], []);
    const c = custoDoItem(item(4, 2), semFaixa);
    if (c.tipo === "ok") expect(c.total).toBe(239.2);
  });
});

describe("migração da faixa por área", () => {
  const sql = readFileSync(
    "supabase/migrations/20261025200000_faixa_por_area_e_tabela_de_terceirizados.sql",
    "utf8",
  );

  it("aborta se a função do gatilho mudou desde o ensaio", () => {
    expect(sql).toContain("1b877cb6545782a13f39f31270cafa44");
  });

  it("a faixa só vale no preço de tabela do parceiro e passa de acima_de_m2", () => {
    expect(sql).toContain("NEW.preco_m2 = v_preco_tabela");
    expect(sql).toContain("v_area_linha > v_limite");
  });

  it("a função da tela exige ser parceiro e não é pública", () => {
    expect(sql).toContain("parceiro_do_usuario() IS NOT NULL");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.parceiro_faixas_por_area() FROM PUBLIC, anon",
    );
  });

  it("a tela chama a função nova e a junta ao catálogo", () => {
    const api = readFileSync("src/lib/parceiro-api.ts", "utf8");
    expect(api).toContain("parceiro_faixas_por_area");
    expect(api).toContain("aplicarFaixasPorArea");
  });
});
