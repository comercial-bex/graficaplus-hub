import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CHAVE_DA_UNIDADE,
  avisoDeMedidaSuspeita,
  deMetros,
  ehUnidadeDeMedida,
  lembrarUnidade,
  lerNumero,
  lerUnidadeLembrada,
  medidaLegivel,
  paraMetros,
  textoDoCampo,
  type UnidadeDeMedida,
} from "../src/domain/orcamentos/unidade-de-medida";
import { areaUnitaria } from "../src/domain/orcamentos/area";
import { DesenhoDaPeca, MedidasDaPeca } from "../src/components/orcamento/medidas-da-peca";
import { TooltipProvider } from "../src/components/ui/tooltip";

/**
 * Medida em mm, cm ou m (20/10/2026). O dono: "não tem opção de seleção de mm,
 * m² ou cm quando faço orçamento". A tela só aceitava metros: acrílico de
 * 27 × 26 cm virava 0,27 × 0,26 de cabeça, e "80" querendo dizer 80 cm virava 80
 * METROS (4.000 m² de área) sem nenhum aviso. O que vai para o banco, a área e o
 * PDF continua em metros.
 */

describe("digitar na unidade, guardar em metros", () => {
  it("80 cm, 800 mm e 0,8 m são a mesma peça", () => {
    expect(paraMetros("80", "cm")).toBe(0.8);
    expect(paraMetros("800", "mm")).toBe(0.8);
    expect(paraMetros("0,8", "m")).toBe(0.8);
    expect(paraMetros("0.8", "m")).toBe(0.8);
  });

  it("o caso real da OS 165: 27 × 26 cm e 80 × 50 cm", () => {
    expect(paraMetros("27", "cm")).toBe(0.27);
    expect(paraMetros("26", "cm")).toBe(0.26);
    // 0,27 × 0,26 = 0,0702 m² exatos: a peça não arredonda mais em 3 casas (29/10/2026).
    expect(areaUnitaria({ largura: paraMetros("27", "cm"), altura: paraMetros("26", "cm"), quantidade: 1 })).toBe(0.0702);
    expect(areaUnitaria({ largura: paraMetros("80", "cm"), altura: paraMetros("50", "cm"), quantidade: 1 })).toBe(0.4);
  });

  it("precisão de 1 mm: três casas em metros, sem sobra de ponto flutuante", () => {
    expect(paraMetros("27,5", "cm")).toBe(0.275);
    expect(paraMetros("1", "mm")).toBe(0.001);
    expect(paraMetros("0,3", "mm")).toBe(0); // menos de meio milímetro some: não é medida de gráfica
    expect(paraMetros("12,34", "cm")).toBe(0.123);
  });

  it("vazio, lixo e negativo não viram medida", () => {
    for (const t of ["", "  ", "abc", "-5", "1,2,3"]) expect(paraMetros(t, "cm"), t).toBeNull();
    expect(paraMetros(null, "m")).toBeNull();
    expect(lerNumero("1,5")).toBe(1.5);
  });

  it("da volta: os metros guardados escritos na unidade escolhida, sem zero sobrando", () => {
    expect(deMetros(0.8, "cm")).toBe("80");
    expect(deMetros(0.8, "mm")).toBe("800");
    expect(deMetros(0.8, "m")).toBe("0.8");
    expect(deMetros("0.275", "cm")).toBe("27.5");
    expect(deMetros(5, "m")).toBe("5");
    expect(deMetros(0.27, "cm")).toBe("27"); // 0,27 × 100 = 27.000000000000004 em ponto flutuante
    expect(deMetros(null, "cm")).toBe("");
    expect(deMetros("", "cm")).toBe("");
    expect(deMetros(0, "cm")).toBe("");
  });

  it("ida e volta não perde nada, em qualquer unidade", () => {
    for (const metros of [0.001, 0.07, 0.27, 0.8, 1.2, 1.5, 5, 12.345]) {
      for (const u of ["mm", "cm", "m"] as UnidadeDeMedida[]) {
        const texto = deMetros(metros, u);
        const volta = paraMetros(texto, u);
        // cm guarda uma casa (0,1 cm = 1 mm); 12,345 m em cm vira 1234,5 cm → 12,345 m.
        expect(volta, `${metros} m em ${u} → "${texto}"`).toBe(Math.round(metros * 1000) / 1000);
      }
    }
  });

  it("a medida como se fala", () => {
    expect(medidaLegivel(0.8, "cm")).toBe("80 cm");
    expect(medidaLegivel(0.275, "cm")).toBe("27,5 cm");
    expect(medidaLegivel(1.5, "m")).toBe("1,5 m");
    expect(medidaLegivel(0.027, "mm")).toBe("27 mm");
  });
});

describe("o aviso de unidade trocada — o erro que mais custa", () => {
  it('"80" no campo de METROS é uma peça de 80 m: avisa para conferir a unidade', () => {
    const aviso = avisoDeMedidaSuspeita("Largura", paraMetros("80", "m"), "m");
    expect(aviso).toContain("Largura de 80 m?");
    expect(aviso).toContain("Confira a unidade");
  });

  it('"0,8" no campo de CM é menos de 1 cm: avisa também', () => {
    const aviso = avisoDeMedidaSuspeita("Altura", paraMetros("0,8", "cm"), "cm");
    expect(aviso).toContain("Altura de 0,8 cm?");
    expect(aviso).toContain("menos de 1 cm");
  });

  it("medida normal não avisa — faixa de 5 m, acrílico de 27 cm, adesivo de 8 mm", () => {
    expect(avisoDeMedidaSuspeita("Largura", 5, "m")).toBeNull();
    expect(avisoDeMedidaSuspeita("Largura", 0.27, "cm")).toBeNull();
    expect(avisoDeMedidaSuspeita("Largura", 0.02, "mm")).toBeNull();
    expect(avisoDeMedidaSuspeita("Largura", 20, "m")).toBeNull();
  });

  it("vazio não avisa, e o aviso só avisa — nunca barra", () => {
    expect(avisoDeMedidaSuspeita("Largura", null, "m")).toBeNull();
    expect(avisoDeMedidaSuspeita("Largura", 0, "m")).toBeNull();
    // 25 m de faixa existe: o texto pede conferência, não impede.
    expect(avisoDeMedidaSuspeita("Largura", 25, "m")).toContain("Confira");
  });
});

describe("o campo não come o que a pessoa digita", () => {
  /** Simula o campo: a pessoa digita; o pai guarda os metros e devolve o mesmo valor. */
  function digitar(teclas: string[], unidade: UnidadeDeMedida) {
    let texto = "";
    let metros = "";
    const passos: { texto: string; metros: string }[] = [];
    for (const t of teclas) {
      texto = t; // o campo guarda o que foi digitado
      const m = paraMetros(texto, unidade);
      metros = m === null ? "" : String(m); // o pai recebe metros...
      texto = textoDoCampo({ texto, metrosDeFora: metros, unidade, trocouDeUnidade: false }); // ...e o efeito roda
      passos.push({ texto, metros });
    }
    return passos;
  }

  it('"80,5" em cm: a vírgula sobrevive ao eco do pai', () => {
    const passos = digitar(["8", "80", "80,", "80,5"], "cm");
    expect(passos.map((p) => p.texto)).toEqual(["8", "80", "80,", "80,5"]);
    expect(passos.map((p) => p.metros)).toEqual(["0.08", "0.8", "0.8", "0.805"]);
  });

  it("apagar tudo limpa o valor guardado", () => {
    const passos = digitar(["80", ""], "cm");
    expect(passos[1]).toEqual({ texto: "", metros: "" });
  });

  it("tamanho pronto aplicado (o pai troca o valor): o campo refaz o texto", () => {
    expect(textoDoCampo({ texto: "80", metrosDeFora: "1.5", unidade: "cm", trocouDeUnidade: false })).toBe("150");
  });

  it("formulário limpo (o pai zera): o campo esvazia", () => {
    expect(textoDoCampo({ texto: "80", metrosDeFora: "", unidade: "cm", trocouDeUnidade: false })).toBe("");
  });

  it("trocar a unidade mantém a PEÇA: 80 cm viram 0,8 m e 800 mm", () => {
    expect(textoDoCampo({ texto: "80", metrosDeFora: "0.8", unidade: "m", trocouDeUnidade: true })).toBe("0.8");
    expect(textoDoCampo({ texto: "80", metrosDeFora: "0.8", unidade: "mm", trocouDeUnidade: true })).toBe("800");
  });

  it("item aberto para editar: aparece na unidade escolhida", () => {
    expect(textoDoCampo({ texto: "", metrosDeFora: "0.27", unidade: "cm", trocouDeUnidade: false })).toBe("27");
  });
});

describe("a unidade lembrada neste aparelho", () => {
  it("sem lembrança, metros — a tela continua como era", () => {
    expect(lerUnidadeLembrada({ getItem: () => null })).toBe("m");
    expect(lerUnidadeLembrada(null)).toBe("m");
    expect(lerUnidadeLembrada(undefined)).toBe("m");
  });

  it("lembra a escolha, e valor estranho guardado não vira unidade", () => {
    expect(lerUnidadeLembrada({ getItem: () => "cm" })).toBe("cm");
    expect(lerUnidadeLembrada({ getItem: () => "polegada" })).toBe("m");
    expect(ehUnidadeDeMedida("mm")).toBe(true);
    expect(ehUnidadeDeMedida("km")).toBe(false);
  });

  it("armazenamento bloqueado (modo privado) não derruba a tela", () => {
    const bloqueado = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(lerUnidadeLembrada(bloqueado)).toBe("m");
    expect(() => lembrarUnidade(bloqueado, "cm")).not.toThrow();
  });

  it("grava só a unidade, na chave certa — nunca uma medida", () => {
    const guardado: Record<string, string> = {};
    lembrarUnidade({ setItem: (k, v) => void (guardado[k] = v) }, "cm");
    expect(guardado).toEqual({ [CHAVE_DA_UNIDADE]: "cm" });
  });
});

describe("a tela", () => {
  it("o seletor mm | cm | m aparece, começa em metros e cada botão tem nome", () => {
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(MedidasDaPeca, {
        largura: "",
        altura: "",
        quantidade: 1,
        areaMinima: null,
        tamanhos: [],
        origemDosTamanhos: "tipo",
        onMudar: () => undefined,
        onAplicarTamanho: () => undefined,
      })),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Unidade das medidas"');
    for (const u of ["mm", "cm", "m"]) expect(html).toMatch(new RegExp(`role="radio"[^>]*>${u}<`));
    // O nome por extenso ia no title (só com o mouse parado); agora vai no aria-label.
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="m, metros"/);
    expect(html).not.toContain("title=");
    expect(html).toContain('id="item-largura"');
    expect(html).toContain('id="item-altura"');
  });

  it("a medida entra pelos metros guardados e aparece em metros, como sempre", () => {
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(MedidasDaPeca, {
        largura: "0.8",
        altura: "0.5",
        quantidade: 1,
        areaMinima: null,
        tamanhos: [],
        origemDosTamanhos: "tipo",
        onMudar: () => undefined,
        onAplicarTamanho: () => undefined,
      })),
    );
    expect(html).toContain('value="0.8"');
    expect(html).toContain("0,40 m²");
    // Em metros não repete a conversão.
    expect(html).not.toContain('data-testid="em-metros"');
  });

  it("o desenho escreve a cota na unidade escolhida; em metros, igual ao de antes", () => {
    const emCm = renderToStaticMarkup(createElement(DesenhoDaPeca, { largura: 0.8, altura: 0.5, unidade: "cm" }));
    expect(emCm).toContain("Largura (X) 80 cm");
    expect(emCm).toContain("Altura (Y) 50 cm");
    const emM = renderToStaticMarkup(createElement(DesenhoDaPeca, { largura: 0.8, altura: 0.5 }));
    expect(emM).toContain("Largura (X) 0,80 m");
    expect(emM).toContain("Altura (Y) 0,50 m");
  });

  it("o editor do parceiro usa o mesmo campo e o mesmo seletor (a unidade lembrada vale nos dois)", () => {
    const parceiro = readFileSync("src/components/parceiro/editor-de-orcamento.tsx", "utf8");
    expect(parceiro).toContain("<CampoDeMedida");
    expect(parceiro).toContain("<SeletorDeUnidade");
    expect(parceiro).not.toContain('rotulo="Largura (m)"');
  });

  it("o que o orçamento grava não mudou: a tela guarda metros na mesma chave de sempre", () => {
    const tela = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
    expect(tela).toContain("largura: vendidoPorArea ? dimensoesForm.largura : null,");
    const medidas = readFileSync("src/components/orcamento/medidas-da-peca.tsx", "utf8");
    expect(medidas).toContain('onMudar("largura", m)');
    expect(medidas).toContain('onMudar("altura", m)');
  });
});
