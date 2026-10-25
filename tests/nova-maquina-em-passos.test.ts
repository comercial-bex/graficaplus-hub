import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  maquinaDasRespostas,
  minutosPorM2,
  nomeSugerido,
  pendenciaDoPassoDaMaquina,
  RESPOSTAS_VAZIAS_DA_MAQUINA,
  respostasDoTipo,
  TIPOS_DE_MAQUINA,
  type RespostasDaMaquina,
} from "@/domain/maquinas/nova-maquina-em-passos";

const tipo = (c: string) => TIPOS_DE_MAQUINA.find((t) => t.chave === c)!;
const base = (p: Partial<RespostasDaMaquina>): RespostasDaMaquina => ({
  ...RESPOSTAS_VAZIAS_DA_MAQUINA,
  ...p,
});

describe("tipos de máquina", () => {
  it("usam as chaves que o cadastro já tem em maquinas.tipo", () => {
    expect(TIPOS_DE_MAQUINA.map((t) => t.chave)).toEqual([
      "plotter_impressao",
      "plotter_recorte",
      "laser_co2",
      "laser_fiber",
      "impressora_dtf_uv",
      "impressora_3d",
    ]);
  });

  it("só a plotter de impressão pede velocidade", () => {
    expect(TIPOS_DE_MAQUINA.filter((t) => t.temVelocidade).map((t) => t.chave)).toEqual([
      "plotter_impressao",
    ]);
  });

  it("escolher o tipo sugere a potência sem apagar a digitada", () => {
    expect(respostasDoTipo(RESPOSTAS_VAZIAS_DA_MAQUINA, tipo("laser_co2")).potencia_kw).toBe("1.9");
    expect(respostasDoTipo(base({ potencia_kw: "2,2" }), tipo("laser_co2")).potencia_kw).toBe(
      "2,2",
    );
  });
});

describe("conta e passos", () => {
  it("14 m²/h são 4,3 minutos por m²", () => {
    expect(minutosPorM2(14)).toBe(4.3);
    expect(minutosPorM2(0)).toBe(0);
  });

  it("não avança sem tipo, sem nome, e a plotter sem velocidade", () => {
    expect(pendenciaDoPassoDaMaquina(1, RESPOSTAS_VAZIAS_DA_MAQUINA)).toBeTruthy();
    expect(pendenciaDoPassoDaMaquina(2, RESPOSTAS_VAZIAS_DA_MAQUINA)).toBeTruthy();
    expect(pendenciaDoPassoDaMaquina(3, base({ tipo: tipo("plotter_impressao") }))).toMatch(
      /velocidade/,
    );
    expect(
      pendenciaDoPassoDaMaquina(
        3,
        base({ tipo: tipo("plotter_impressao"), velocidade_m2_h: "14" }),
      ),
    ).toBeNull();
    expect(pendenciaDoPassoDaMaquina(3, base({ tipo: tipo("laser_co2") }))).toBeNull();
  });

  it("recusa disponibilidade fora de 1 a 100", () => {
    expect(
      pendenciaDoPassoDaMaquina(3, base({ tipo: tipo("laser_co2"), disponibilidade_pct: "0" })),
    ).toBeTruthy();
    expect(
      pendenciaDoPassoDaMaquina(3, base({ tipo: tipo("laser_co2"), disponibilidade_pct: "101" })),
    ).toBeTruthy();
  });

  it("sugere o nome pelo tipo, fabricante e modelo", () => {
    expect(
      nomeSugerido(base({ tipo: tipo("laser_co2"), fabricante: "Vuze", modelo: "10060" })),
    ).toBe("Laser CO₂ (CNC) Vuze 10060");
  });
});

describe("a linha de maquinas", () => {
  const plotter = base({
    tipo: tipo("plotter_impressao"),
    nome: " Plotter nova ",
    velocidade_m2_h: "14",
    largura_util_m: "1,8",
    avanco_m: "0,2",
    potencia_kw: "1",
    custo_hora: "14,43",
    setup_min: "5",
  });

  it("leva a velocidade, a boca e o avanço da plotter de impressão", () => {
    expect(maquinaDasRespostas(plotter, true)).toMatchObject({
      nome: "Plotter nova",
      tipo: "plotter_impressao",
      setor: "Impressão",
      velocidade_m2_h: 14,
      largura_util_m: 1.8,
      avanco_m: 0.2,
      custo_hora: 14.43,
      ativa: true,
    });
  });

  it("quem não vê custo não manda a chave, para não gravar 0 por cima", () => {
    expect("custo_hora" in maquinaDasRespostas(plotter, false)).toBe(false);
  });

  it("máquina sem velocidade grava 0 e a 3D não leva largura útil", () => {
    const m = maquinaDasRespostas(
      base({ tipo: tipo("impressora_3d"), nome: "A1", velocidade_m2_h: "9", largura_util_m: "1" }),
      true,
    );
    expect(m.velocidade_m2_h).toBe(0);
    expect(m.largura_util_m).toBeNull();
    expect(m.setor).toBeNull();
  });
});

describe("a tela", () => {
  const tela = readFileSync("src/components/maquinas/nova-maquina-em-passos.tsx", "utf8");
  const pagina = readFileSync("src/routes/_authenticated/maquinas.tsx", "utf8");
  it("'Nova máquina' abre o assistente e o cadastro completo continua", () => {
    expect(pagina).toContain("<NovaMaquinaEmPassos");
    expect(pagina).toContain("setPassosAberto(true)");
    expect(pagina).toContain("Cadastro completo");
  });
  it("o custo por hora só aparece para quem vê custo", () => {
    expect(tela).toContain("canSeeFinancials &&");
    expect(tela).toContain("maquinaDasRespostas(r, canSeeFinancials)");
  });
});
