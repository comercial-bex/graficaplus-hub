import { describe, expect, it } from "vitest";
import { fichaVazia, lerBlocoDaFicha, type FichaLida } from "@/domain/trofeus/ficha-lida";
import {
  acharMaterial,
  avisosDeMaquina,
  compararFichaComModelo,
  escolhasDaFicha,
  familiaDoMaterial,
  modeloSugerido,
} from "@/domain/trofeus/ficha-comparar";
import { CATALOGO, CRISTAL_3, DOURADO_2, ECONOMICO, PADRAO, PREMIUM, PRETO_3 } from "./apoio/trofeus-ficha";

/**
 * A ficha contra o modelo e o cadastro (22/11/2026). O catálogo do teste tem os mesmos nomes, espessuras e medidas do
 * banco vivo. O que se trava: o material fora do cadastro é APONTADO e não recusado, estoque não entra na conta, e a
 * frase diz sempre o que o preço inclui e o que não inclui.
 */

function ficha(bloco: string): FichaLida {
  const r = lerBlocoDaFicha(bloco);
  if (!r.ok) throw new Error(r.erro);
  return r.ficha;
}

const JARICROSS = `FICHA-BEX v1
linha: economico
altura_cm: 18
quantidade: 12
pecas:
- Placa principal | Acrílico cristal | 2 | 20 | 16 | 1 | vinil_laminado | laser CO2
- Base | Acrílico preto | 3 | 20 | 5 | 2 | nenhuma | laser CO2
- Plaqueta frontal | Acrílico prata | 1 | 12 | 3 | 1 | gravacao_laser | laser CO2`;

describe("a ficha contra o modelo", () => {
  it("a plaqueta de prata do JariCross é apontada: o material não está no cadastro e o preço não a inclui", () => {
    const d = compararFichaComModelo(ficha(JARICROSS), ECONOMICO, CATALOGO);
    expect(d.filter((x) => x.nivel === "impede")).toEqual([]);
    const aviso = d.filter((x) => x.nivel === "atencao");
    expect(aviso).toHaveLength(1);
    expect(aviso[0].texto).toContain("Plaqueta frontal");
    expect(aviso[0].texto).toContain("o preço não inclui esta peça");
    expect(aviso[0].texto).toContain("não está no cadastro");
    // Placa e base batem: nada a dizer sobre elas.
    expect(d.some((x) => x.texto.includes('"Base"') || x.texto.includes('"Placa principal"'))).toBe(false);
  });

  it("ficha que cabe no modelo não tem divergência nenhuma", () => {
    const f = ficha("FICHA-BEX v1\nlinha: economico\naltura_cm: 18\npecas:\n- Placa principal | Acrílico cristal | 2 | 20 | 16 | 1 | vinil_laminado |\n- Base | Acrílico preto | 3 | 20 | 5 | 2 | nenhuma |");
    expect(compararFichaComModelo(f, ECONOMICO, CATALOGO)).toEqual([]);
  });

  it("altura fora do que a calculadora aceita IMPEDE a conta e vem primeiro", () => {
    const f = ficha(`${JARICROSS}\n`.replace("altura_cm: 18", "altura_cm: 45"));
    const d = compararFichaComModelo(f, ECONOMICO, CATALOGO);
    expect(d[0].nivel).toBe("impede");
    expect(d[0].texto).toBe("A ficha pede 45 cm de altura; a calculadora vai de 12 a 40 cm.");
  });

  it("a mesma peça em outro material: uma frase só, e a peça do modelo não aparece como faltando", () => {
    const f = ficha("FICHA-BEX v1\nlinha: premium\naltura_cm: 28\npecas:\n- Aro decorativo | Acrílico espelhado dourado | 3 | 6 | 24 | 1 | nenhuma |");
    const d = compararFichaComModelo(f, PREMIUM, CATALOGO);
    const aviso = d.filter((x) => x.nivel === "atencao");
    expect(aviso).toHaveLength(1);
    expect(aviso[0].texto).toBe('"Aro decorativo": a ficha pede Acrílico espelhado dourado de 3 mm; o modelo usa "Acrilico esp dourado 2mm". O preço é o do modelo.');
    expect(d.some((x) => x.texto.includes('O modelo tem "Aro decorativo"'))).toBe(false);
  });

  it("dourado de 3 mm numa peça que o modelo não tem diz em que espessura o material existe no cadastro", () => {
    const f = ficha("FICHA-BEX v1\nlinha: economico\naltura_cm: 18\npecas:\n- Moldura | Acrílico espelhado dourado | 3 | 20 | 16 | 1 | nenhuma |");
    const aviso = compararFichaComModelo(f, ECONOMICO, CATALOGO).find((x) => x.nivel === "atencao");
    expect(aviso?.texto).toContain("No cadastro esse material existe só em 2 mm.");
    expect(aviso?.texto).toContain("o preço não inclui esta peça");
  });

  it("a ficha do KR Combat inteira contra o Premium: 2 diferenças de material e 2 peças que o modelo tem a mais", () => {
    const kr = ficha(`FICHA-BEX v1
linha: premium
altura_cm: 28
pecas:
- Placa principal (logo KR Combat) | Acrílico cristal | 3 | 13 | 13 | 1 | vinil_laminado | Plotter
- Marco Zero (coluna) | Acrílico cristal | 6 | 6 | 24 | 1 | nenhuma | CNC Router
- Aro decorativo | Acrílico espelhado dourado | 3 | 6 | 24 | 1 | nenhuma |
- Silhueta do Marco Zero | Acrílico cristal | 3 | 16 | 10 | 1 | gravacao_laser | Laser (fibra)
- Placa da edição | Acrílico cristal | 3 | 12 | 10 | 1 | vinil_laminado | Plotter UV/DTF
- Suporte interno | Acrílico preto | 3 | 18 | 5 | 1 | nenhuma |
- Base CAMPEÃO | Acrílico preto | 6 | 20 | 7 | 1 | vinil_laminado | Plotter UV/DTF`);
    const d = compararFichaComModelo(kr, PREMIUM, CATALOGO);
    expect(d.filter((x) => x.nivel === "impede")).toEqual([]);
    const atencao = d.filter((x) => x.nivel === "atencao").map((x) => x.texto);
    expect(atencao).toEqual([
      '"Aro decorativo": a ficha pede Acrílico espelhado dourado de 3 mm; o modelo usa "Acrilico esp dourado 2mm". O preço é o do modelo.',
      '"Base CAMPEÃO": a ficha pede Acrílico preto de 6 mm; o modelo usa "ACRILICO PRETO VIRGEM 3MM". O preço é o do modelo.',
    ]);
    const faltando = d.filter((x) => x.nivel === "info" && x.texto.startsWith("O modelo tem")).map((x) => x.texto);
    expect(faltando).toEqual(['O modelo tem "Aro da base" (1) que a ficha não mostra; o preço inclui.', 'O modelo tem "Base em camadas" (3) que a ficha não mostra; o preço inclui.']);
    // As outras cinco peças casaram com a peça certa do modelo, sem nenhuma observação de medida.
    expect(d.filter((x) => x.nivel === "info" && /a ficha traz/.test(x.texto))).toEqual([]);
  });

  it("quantidade diferente do modelo é apontada, com o preço sendo o do modelo", () => {
    const f = ficha("FICHA-BEX v1\nlinha: economico\naltura_cm: 18\npecas:\n- Base | Acrílico preto | 3 | 20 | 5 | 3 | nenhuma |");
    const d = compararFichaComModelo(f, ECONOMICO, CATALOGO);
    expect(d.find((x) => x.nivel === "atencao")?.texto).toBe('A ficha pede 3 de "Base" por troféu; o modelo tem 2. O preço é o do modelo.');
  });

  it("medida muito diferente do modelo, na altura pedida, é só para saber", () => {
    const f = ficha("FICHA-BEX v1\nlinha: economico\naltura_cm: 18\npecas:\n- Placa principal | Acrílico cristal | 2 | 30 | 25 | 1 | nenhuma |\n- Base | Acrílico preto | 3 | 20 | 5 | 2 | nenhuma |");
    const d = compararFichaComModelo(f, ECONOMICO, CATALOGO);
    expect(d).toHaveLength(1);
    expect(d[0].nivel).toBe("info");
    expect(d[0].texto).toContain("o modelo, nesta altura, usa 20 × 16 cm");
  });

  it("a medida do modelo escala com a altura pedida antes de comparar", () => {
    // Premium em 14 cm (metade da referência): a coluna de 6 × 24 passa a 3 × 12 e a ficha em 3 × 12 bate.
    const f = ficha("FICHA-BEX v1\nlinha: premium\naltura_cm: 14\npecas:\n- Coluna | Acrílico cristal | 6 | 3 | 12 | 1 | nenhuma |");
    const d = compararFichaComModelo(f, PREMIUM, CATALOGO);
    expect(d.some((x) => x.texto.includes('"Coluna"'))).toBe(false);
  });

  it("peça do modelo que a ficha não mostra aparece como informação: o preço inclui", () => {
    const f = ficha("FICHA-BEX v1\nlinha: economico\naltura_cm: 18\npecas:\n- Placa principal | Acrílico cristal | 2 | 20 | 16 | 1 | nenhuma |");
    const d = compararFichaComModelo(f, ECONOMICO, CATALOGO);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ nivel: "info" });
    expect(d[0].texto).toContain('O modelo tem "Base" (2) que a ficha não mostra; o preço inclui.');
  });

  it("espessura acima do corte do laser é apontada", () => {
    const f = ficha("FICHA-BEX v1\nlinha: premium\naltura_cm: 28\npecas:\n- Base maciça | Acrílico preto | 15 | 20 | 7 | 1 | nenhuma |");
    const d = compararFichaComModelo(f, PREMIUM, CATALOGO);
    expect(d.some((x) => x.nivel === "atencao" && x.texto.includes("corta até 10 mm"))).toBe(true);
  });

  it("peça sem material ou sem espessura não é conferida, e a frase diz qual falta", () => {
    const f = ficha("FICHA-BEX v1\nlinha: economico\naltura_cm: 18\npecas:\n- Placa | A CONFIRMAR | 2 | 20 | 16 | 1 | nenhuma |\n- Base | Acrílico preto | A CONFIRMAR | 20 | 5 | 2 | nenhuma |");
    const textos = compararFichaComModelo(f, ECONOMICO, CATALOGO).map((d) => d.texto);
    expect(textos).toContain('A ficha não diz o material de "Placa": não deu para conferir.');
    expect(textos).toContain('A ficha não diz a espessura de "Base": não deu para conferir.');
  });

  it("mais nomes individuais do que troféus é apontado", () => {
    const f = ficha("FICHA-BEX v1\nquantidade: 5\nnomes_individuais: 8");
    expect(compararFichaComModelo(f, null, CATALOGO).some((d) => d.texto.includes("mais nomes individuais do que troféus"))).toBe(true);
  });

  it("sem modelo escolhido, pede para escolher; sem peças na ficha, não inventa conferência", () => {
    expect(compararFichaComModelo(ficha(JARICROSS), null, CATALOGO).map((d) => d.texto)).toContain("Escolha o modelo para ver o que a ficha tem a mais ou a menos que ele.");
    expect(compararFichaComModelo(fichaVazia(), ECONOMICO, CATALOGO)).toEqual([]);
  });

  it("máquina que a casa não tem é só aviso", () => {
    const f = ficha("FICHA-BEX v1\nlinha: premium\npecas:\n- Placa | Acrílico cristal | 3 | 13 | 13 | 1 | vinil_laminado | CNC router\nobservacoes: impressão UV/DTF no logo, gravação a laser de fibra");
    const avisos = avisosDeMaquina(f);
    expect(avisos).toHaveLength(3);
    expect(avisos.join(" ")).toMatch(/fresa/);
    expect(avisos.join(" ")).toMatch(/laser de fibra/);
    expect(avisos.join(" ")).toMatch(/UV\/DTF/);
    expect(avisosDeMaquina(ficha(JARICROSS))).toEqual([]);
  });
});

describe("o material da ficha no cadastro", () => {
  it("encontra pela cor e pela espessura, sem ligar para marca nem 'virgem' e sem olhar estoque", () => {
    expect(acharMaterial("Acrílico preto", 3, CATALOGO.materiais)).toEqual({ estado: "cadastrado", nome: PRETO_3 });
    expect(acharMaterial("acrilico espelhado dourado", 2, CATALOGO.materiais)).toEqual({ estado: "cadastrado", nome: DOURADO_2 });
  });

  it("cristal na ficha prefere o CRISTAL ao TRANSPARENTE de outra marca", () => {
    expect(acharMaterial("Acrílico cristal", 3, CATALOGO.materiais)).toEqual({ estado: "cadastrado", nome: CRISTAL_3 });
    expect(acharMaterial("Acrílico transparente", 3, CATALOGO.materiais)).toMatchObject({ estado: "cadastrado" });
  });

  it("cor que existe só em outra espessura diz quais; cor que não existe é sem cadastro", () => {
    expect(acharMaterial("Acrílico dourado", 3, CATALOGO.materiais)).toEqual({ estado: "outra_espessura", opcoes: ["2 mm"] });
    expect(acharMaterial("Acrílico cristal", 4, CATALOGO.materiais)).toEqual({ estado: "outra_espessura", opcoes: ["2 mm", "3 mm", "6 mm"] });
    expect(acharMaterial("Acrílico prata", 1, CATALOGO.materiais)).toEqual({ estado: "sem_cadastro" });
    expect(acharMaterial("MDF cru", 6, CATALOGO.materiais)).toEqual({ estado: "sem_cadastro" });
    expect(acharMaterial(null, 3, CATALOGO.materiais)).toEqual({ estado: "nao_informado" });
  });

  it("sem espessura na ficha, basta existir a cor", () => {
    expect(acharMaterial("Acrílico preto", null, CATALOGO.materiais)).toMatchObject({ estado: "cadastrado" });
  });

  it("a família é a cor ou o tipo", () => {
    expect(familiaDoMaterial("ACRILICO CRISTAL VIRGEM 2MM")).toBe("cristal");
    expect(familiaDoMaterial("Acrílico espelhado dourado")).toBe("dourado");
    expect(familiaDoMaterial("espelhado prata")).toBe("prata");
    expect(familiaDoMaterial("Acrílico espelhado")).toBe("espelhado");
    expect(familiaDoMaterial("Acrílico preto")).toBe("preto");
    expect(familiaDoMaterial("MDF")).toBeNull();
    expect(familiaDoMaterial(null)).toBeNull();
  });
});

describe("o modelo sugerido e o que vai para a calculadora", () => {
  it("a linha da ficha escolhe o modelo", () => {
    expect(modeloSugerido(ficha("FICHA-BEX v1\nlinha: premium"), CATALOGO.modelos)).toBe("m-pre");
    expect(modeloSugerido(ficha("FICHA-BEX v1\nlinha: padrao"), CATALOGO.modelos)).toBe("m-pad");
  });

  it("sem linha, o número de peças sugere: até 3 econômico, 4 a 6 padrão, 7 ou mais premium", () => {
    const comPecas = (n: number) => ficha(`FICHA-BEX v1\naltura_cm: 18\npecas:\n${Array.from({ length: n }, (_, i) => `- P${i} | Acrílico cristal | 3 | 5 | 5 | 1 | nenhuma |`).join("\n")}`);
    expect(modeloSugerido(comPecas(2), CATALOGO.modelos)).toBe("m-eco");
    expect(modeloSugerido(comPecas(5), CATALOGO.modelos)).toBe("m-pad");
    expect(modeloSugerido(comPecas(9), CATALOGO.modelos)).toBe("m-pre");
    expect(modeloSugerido(ficha("FICHA-BEX v1\naltura_cm: 18"), CATALOGO.modelos)).toBeNull();
  });

  it("a calculadora recebe só o que a ficha trouxe: nada é apagado", () => {
    const f = ficha("FICHA-BEX v1\nlinha: padrao\naltura_cm: 22,5\nquantidade: 12\nurgencia: sim\narte: criacao_exclusiva\nnomes_individuais: 4");
    expect(escolhasDaFicha(f, "m-pad")).toEqual({ modeloId: "m-pad", alturaTexto: "22,5", quantidadeTexto: "12", urgente: true, arteTipo: "criacao_exclusiva", nomesTexto: "4" });
    expect(escolhasDaFicha(ficha("FICHA-BEX v1\nquantidade: 3"), null)).toEqual({ quantidadeTexto: "3" });
    expect(escolhasDaFicha(fichaVazia(), "m-eco")).toEqual({ modeloId: "m-eco" });
  });
});
