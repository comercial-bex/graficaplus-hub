import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decidirCampo,
  decidirEncargos,
  custoVigenteDoMaterial,
  ehMedicaoNova,
  fracaoParaPorcentagem,
  horaCheia,
  porcentagemParaFracao,
  textoDeEncargos,
} from "../src/domain/custos/campo-de-custo";
import { escreverNumero, lerNumero } from "../src/domain/custos/planilha-csv";

const ler = (c: string) => readFileSync(join(__dirname, "..", c), "utf8");

describe("encargos: fração no banco, porcentagem na tela", () => {
  it("0,3282 vira 32,82 e volta", () => {
    expect(fracaoParaPorcentagem(0.3282)).toBe(32.82);
    expect(porcentagemParaFracao(32.82)).toBe(0.3282);
    expect(textoDeEncargos(0.3282)).toBe("32,82 %");
  });
  it("hora cheia é base x (1 + fração): 9,2102 com 32,82 % dá 12,23, e não 9,24", () => {
    expect(horaCheia(9.2102, 0.3282)).toBeCloseTo(12.23, 2);
  });
  it("digitar 32,82 grava 0,3282; digitar acima de 100 é recusado", () => {
    expect(decidirEncargos("32,82", 0.5)).toEqual({ acao: "gravar", valor: 0.3282 });
    expect(decidirEncargos("3282", 0.3282).acao).toBe("recusar");
    expect(decidirEncargos("100", 0.3282)).toEqual({ acao: "gravar", valor: 1 });
    expect(decidirEncargos("100,01", 0.3282).acao).toBe("recusar");
  });
  it("o mesmo valor do banco não regrava", () => {
    expect(decidirEncargos("32,82", 0.3282).acao).toBe("manter");
  });
  it("o CSV vai e volta no mesmo formato", () => {
    const escrito = escreverNumero(fracaoParaPorcentagem(0.3282), 2);
    expect(escrito).toBe("32,82");
    expect(decidirEncargos(escrito, 0.3282).acao).toBe("manter");
    expect(porcentagemParaFracao(lerNumero(escrito) as number)).toBe(0.3282);
  });
});

describe("campo vazio não grava zero", () => {
  it("vazio restaura, zero só quando digitado", () => {
    expect(decidirCampo("", 12).acao).toBe("manter");
    expect(decidirCampo("   ", 12).acao).toBe("manter");
    expect(decidirCampo("0", 12)).toEqual({ acao: "gravar", valor: 0 });
    expect(decidirCampo("9,5", 12)).toEqual({ acao: "gravar", valor: 9.5 });
    expect(decidirCampo("abc", 12).acao).toBe("recusar");
    expect(decidirCampo("-1", 12).acao).toBe("recusar");
  });
});

describe("custo do material que o banco usa", () => {
  it("o médio manda quando existe; senão a última compra", () => {
    expect(custoVigenteDoMaterial({ custo_unitario: 174.18, custo_medio: 87.09 })).toEqual({
      valor: 87.09,
      origem: "medio",
    });
    expect(custoVigenteDoMaterial({ custo_unitario: 10, custo_medio: null })).toEqual({
      valor: 10,
      origem: "ultima_compra",
    });
    expect(custoVigenteDoMaterial({ custo_unitario: null, custo_medio: null }).origem).toBe(
      "nenhum",
    );
  });
});

describe("processos: só número novo e maior que zero é medida", () => {
  it("vazio, zero e igual ao original não marcam", () => {
    expect(ehMedicaoNova("", undefined)).toBe(false);
    expect(ehMedicaoNova("0", undefined)).toBe(false);
    expect(ehMedicaoNova("12", "12")).toBe(false);
    expect(ehMedicaoNova("12", "")).toBe(true);
    expect(ehMedicaoNova("15", "12")).toBe(true);
  });
});

describe("as telas usam isso", () => {
  const telas = [
    "src/routes/_authenticated/custos-producao.tsx",
    "src/routes/_authenticated/planilha-custos.tsx",
    "src/routes/_authenticated/processos.tsx",
    "src/components/custos/parametros-da-casa.tsx",
    "src/components/custos/custos-fixos-da-grafica.tsx",
  ];
  it.each(telas)("%s mostra a falha de leitura com Tentar de novo", (t) => {
    expect(ler(t)).toContain("AvisoDeFalhaDeConsulta");
  });
  it("o aviso é role alert e tem o botão", () => {
    const a = ler("src/components/custos/aviso-de-falha-de-consulta.tsx");
    expect(a).toContain('role="alert"');
    expect(a).toContain("Tentar de novo");
  });
  it("a planilha põe o valor atual na key e não divide encargos por 100 na tela", () => {
    const p = ler("src/routes/_authenticated/planilha-custos.tsx");
    expect(p).toContain("key={`${m.id}-${m.custo_unitario}`}");
    expect(p).toContain("key={`${m.id}-${m.encargos_pct}`}");
    expect(p).not.toMatch(/encargos_pct \?\? 0\) \/ 100/);
    expect(p).not.toMatch(/Number\(e\.target\.value\)/);
  });
  it("custos-producao grava encargos em fração", () => {
    const p = ler("src/routes/_authenticated/custos-producao.tsx");
    expect(p).toContain("porcentagemParaFracao(encargosDoForm(form) ?? 0)");
    expect(p).not.toContain("Encargos (0,8 = 80%)");
  });
});
