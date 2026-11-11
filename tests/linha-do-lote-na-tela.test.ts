import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { linhaDoLote } from "../src/domain/encaixe/linha-do-lote";

/**
 * A linha sob a quantidade (10/11/2026): o pedido do dono de 05/11, "quando eu boto a quantidade, 40 adesivos de 4 × 4
 * ou de 6 × 6, tenho de saber quanto dá em metro quadrado". A conta é de `linhaDoLote` (testada em
 * linha-do-lote.test.ts); aqui ficam o pedido do dono com os números dele e a ligação com a tela.
 */

const ler = (caminho: string) => readFileSync(caminho, "utf8");

describe("o exemplo do dono", () => {
  it("40 adesivos de 4 × 4 cm dão 0,064 m²", () => {
    const linha = linhaDoLote({
      largura: 0.04,
      altura: 0.04,
      quantidade: 40,
      unidade: "m2",
      unidadeDeMedida: "cm",
    });
    expect(linha?.texto).toBe("40 peças de 4 × 4 cm = 0,064 m²");
    expect(linha?.cobrado).toBeUndefined();
  });

  it("40 adesivos de 6 × 6 cm dão 0,144 m²", () => {
    const linha = linhaDoLote({
      largura: 0.06,
      altura: 0.06,
      quantidade: 40,
      unidade: "m2",
      unidadeDeMedida: "cm",
    });
    expect(linha?.texto).toBe("40 peças de 6 × 6 cm = 0,144 m²");
  });

  it("a mesma peça se escreve na unidade em que foi digitada", () => {
    const base = { largura: 0.04, altura: 0.04, quantidade: 40, unidade: "m2" };
    expect(linhaDoLote({ ...base, unidadeDeMedida: "mm" })?.texto).toBe(
      "40 peças de 40 × 40 mm = 0,064 m²",
    );
    expect(linhaDoLote({ ...base, unidadeDeMedida: "m" })?.texto).toBe(
      "40 peças de 0,04 × 0,04 m = 0,064 m²",
    );
  });

  it("com o mínimo do produto maior que a peça, diz o que é cobrado e por quê", () => {
    const linha = linhaDoLote({
      largura: 0.04,
      altura: 0.04,
      quantidade: 40,
      unidade: "m2",
      areaMinima: 0.1,
      unidadeDeMedida: "cm",
    });
    expect(linha?.texto).toBe("40 peças de 4 × 4 cm = 0,064 m²");
    expect(linha?.cobrado).toBe("Cobrado: 4,00 m², porque o mínimo do produto é 0,10 m² por peça.");
  });

  it("sem as duas medidas ou em unidade que não conta peça, não há linha", () => {
    expect(linhaDoLote({ largura: 0.04, altura: 0, quantidade: 40, unidade: "m2" })).toBeNull();
    expect(
      linhaDoLote({ largura: 0.04, altura: 0.04, quantidade: 5, unidade: "milheiro" }),
    ).toBeNull();
    expect(linhaDoLote({ largura: 0.04, altura: 0.04, quantidade: 5, unidade: "h" })).toBeNull();
  });
});

describe("a linha na tela do orçamento", () => {
  const ROTA = ler("src/routes/_authenticated/orcamentos.$id.tsx");

  it("aparece logo depois do campo de quantidade, com a medida, as peças e a unidade de venda do item", () => {
    expect(ROTA).toContain('import { LinhaDoLote } from "@/components/orcamento/linha-do-lote";');
    const quantidade = ROTA.indexOf("<QuantidadeDoItem");
    const linha = ROTA.indexOf("<LinhaDoLote");
    expect(quantidade).toBeGreaterThan(0);
    expect(linha).toBeGreaterThan(quantidade);
    const uso = ROTA.slice(linha, ROTA.indexOf("/>", linha) + 2);
    expect(uso).toContain("largura={dimensoesForm.largura}");
    expect(uso).toContain("altura={dimensoesForm.altura}");
    expect(uso).toContain("quantidade={paraNumero(form.quantidade)}");
    expect(uso).toContain("unidade={form.unidade}");
    expect(uso).toContain("areaMinima={form.area_minima}");
  });

  it("o componente é legível e só mostra texto: 16 px, cor do texto, sem title, sem preço nem custo", () => {
    const bruta = ler("src/components/orcamento/linha-do-lote.tsx");
    const fonte = bruta.replace(/\/\*[\s\S]*?\*\//g, ""); // a explicação num comentário não reprova o arquivo
    expect(fonte).toContain("text-base");
    expect(fonte).not.toMatch(/\btext-(xs|sm|primary|accent|amber)\b/);
    expect(fonte).not.toMatch(/\btitle=/);
    expect(fonte).not.toMatch(/preco|custo|margem|estoque/i);
    expect(fonte).toContain('role="status"');
    expect(fonte).toContain("useUnidadeDeMedida()");
  });

  it("a unidade lembrada é uma só para todos os campos: a linha acompanha a troca feita nas medidas da peça", () => {
    const fonte = ler("src/components/orcamento/campo-de-medida.tsx");
    expect(fonte).toContain("useSyncExternalStore(assinar, unidadeAgora, unidadeNoServidor)");
    expect(fonte).toContain("ouvintes.forEach((avisar) => avisar());");
    // o servidor e o primeiro desenho do navegador são em metros: o mesmo HTML dos dois lados
    expect(fonte).toContain('const unidadeNoServidor = (): UnidadeDeMedida => "m";');
  });

  it("o bloco de medidas usa a mesma conta exata da linha (não mostra 50 cm² onde a linha diz 48)", () => {
    const fonte = ler("src/components/orcamento/medidas-da-peca.tsx");
    expect(fonte).toContain("areaExataDoLote(dims)");
    expect(fonte).toContain("areaExataCobradaDoLote(dims, areaMinima)");
    expect(fonte).not.toMatch(/\bareaTotal\(/);
    expect(fonte).not.toMatch(/\bareaCobrada\(/);
  });
});
