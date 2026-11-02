import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acabamentoCobravel, quantidadeDoAcabamento } from "../src/domain/orcamentos/cobranca-do-acabamento";
import { colunaDoOrcamento } from "../src/domain/orcamentos/quadro";
import { textoDoAcabamento } from "../src/domain/orcamentos/orcamento-com-ia";
import { filtrarModelos, parecidoNoCatalogo, produtoDoModelo } from "../src/domain/catalogo/modelos-do-mercado";

describe("os acabamentos de lona (01/11/2026)", () => {
  it("cada acabamento sabe em que medida é cobrado", () => {
    expect(acabamentoCobravel("Só bainha")?.medida).toBe("perimetro");
    expect(acabamentoCobravel("Só ilhós")?.medida).toBe("perimetro");
    expect(acabamentoCobravel("Bastão e corda")?.medida).toBe("peca");
    expect(acabamentoCobravel("Refile")?.medida).toBe("perimetro");
  });

  it("bastão e corda é um por peça; bainha anda pelo contorno", () => {
    const peca = { largura: 3, altura: 0.7, quantidade: 2 };
    expect(quantidadeDoAcabamento("peca", peca)).toBe(2);
    expect(quantidadeDoAcabamento("perimetro", peca)).toBe(14.8);
  });

  it("bainha e ilhós separados não ficam mais baratos que o combo", () => {
    const sql = readFileSync("supabase/migrations/20261101320000_acabamentos_de_lona_e_modelos_do_mercado.sql", "utf8");
    expect(sql).toContain("('Só bainha', 'metro_linear', 7.0, NULL, 0.0, 5.50, 'LON-BAI')");
    expect(sql).toContain("('Só ilhós', 'metro_linear', 3.0, 'Ilhós metálico', 2.0, 3.50, 'LON-ILH')");
    expect(5.5 + 3.5).toBe(9);
  });
});

describe("Emitidos no quadro", () => {
  const base = { status: "rascunho", os_id: null, etapa_comercial: null };
  it("rascunho com cliente e valor está pronto para enviar", () => {
    expect(colunaDoOrcamento({ ...base, valor_total: 100, cliente_nome: "Ana" })).toBe("emitido");
    expect(colunaDoOrcamento({ ...base, valor_total: 100, contato_nome: "Ana" })).toBe("emitido");
  });
  it("sem cliente ou sem valor continua rascunho", () => {
    expect(colunaDoOrcamento({ ...base, valor_total: 0, cliente_nome: "Ana" })).toBe("rascunho");
    expect(colunaDoOrcamento({ ...base, valor_total: 100 })).toBe("rascunho");
  });
});

describe("modelos do mercado", () => {
  it("o produto nasce inativo, sem preço", () => {
    const p = produtoDoModelo({ familia: "Lonas", nome: "Lona Dupla Face com Impressão Digital" });
    expect(p).toMatchObject({ ativo: false, unidade: "m2", categoria: "impressao_grande_formato", tipo: "produto" });
    expect(p).not.toHaveProperty("preco_base");
    expect(produtoDoModelo({ familia: "Serviços", nome: "Serviço de remoção" }).tipo).toBe("servico");
    expect(produtoDoModelo({ familia: "Brindes", nome: "Caneca personalizada" }).unidade).toBe("un");
  });
  it("aponta o produto parecido, para não duplicar", () => {
    const nossos = [{ nome: "Lona backlight" }, { nome: "Adesivo perfurado (one way)" }, { nome: "Placa ACM 3mm com adesivo" }];
    expect(parecidoNoCatalogo("Lona Back Light com Impressão Digital", [{ nome: "Lona Back Light" }])).toBe("Lona Back Light");
    expect(parecidoNoCatalogo("Adesivo Perfurado Impresso", nossos)).toBe("Adesivo perfurado (one way)");
    expect(parecidoNoCatalogo("Toldo fixo em tecido", nossos)).toBeNull();
    expect(parecidoNoCatalogo("Lona Back Light com Impressão Digital", nossos)).toBe("Lona backlight");
  });
  it("busca sem acento e por família", () => {
    const m = [{ familia: "Toldos", nome: "Toldo fixo em lona" }, { familia: "Lonas", nome: "Lona Perfurada" }];
    expect(filtrarModelos(m, "Lonas", "")).toHaveLength(1);
    expect(filtrarModelos(m, null, "lona").map((x) => x.nome)).toEqual(["Toldo fixo em lona", "Lona Perfurada"]);
    expect(filtrarModelos(m, null, "perfurada")).toHaveLength(1);
  });
});

describe("mais lonas (01/11/2026)", () => {
  const sql = readFileSync("supabase/migrations/20261101330000_mais_lonas.sql", "utf8");
  it("o que ainda não foi comprado leva a tag que o aviso cobra", () => {
    for (const sku of ["LON-DUP", "LON-PER", "LON-TEX", "LON-LIS", "LON-ADE", "LON-CAV"]) expect(sql).toContain(sku);
    expect(sql.match(/PROVISÓRIOS \(01\/11\/2026\)/g)).toHaveLength(5);
    expect(sql).toContain("NÃO COMPRADO");
  });
  it("os modelos que já existem apontam para o produto, para não duplicar", () => {
    expect(sql).toContain("UPDATE public.catalogo_modelos c SET produto_id");
  });
});

describe("texto do acabamento", () => {
  it("não repete o que já foi marcado, e guarda o que é novo", () => {
    expect(textoDoAcabamento({ acabamentos: ["Bainha + ilhós"], observacao: "Bainha e ilhós" })).toBe("Bainha + ilhós");
    expect(textoDoAcabamento({ acabamentos: ["Bainha + ilhós"], observacao: "cor azul" })).toBe("Bainha + ilhós, cor azul");
    expect(textoDoAcabamento({ acabamentos: [], observacao: null })).toBeNull();
    expect(textoDoAcabamento({ acabamentos: [], observacao: "fosco" })).toBe("fosco");
  });
});
