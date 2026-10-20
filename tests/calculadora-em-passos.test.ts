import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PASSOS,
  estadoDosPassos,
  passoAnterior,
  passoSeguinte,
  rotuloDoBotaoPrincipal,
} from "../src/domain/orcamentos/passos-da-calculadora";
import { BarraDePassos } from "../src/components/orcamento/passos-da-calculadora";

/**
 * A calculadora de custo em passos (20/10/2026). Medido antes: uma janela só,
 * de 554 linhas e 24 campos, com materiais, máquinas, mão de obra, fechamento
 * e resultado abertos ao mesmo tempo — a janela mais pesada do sistema, usada
 * pelo financeiro uma vez por item. Agora: uma pergunta por passo, e o preço
 * no fim. O que foi digitado fica guardado ao trocar de passo.
 */

const CALC = readFileSync("src/components/orcamento/calculadora-custo.tsx", "utf8");
const sp = (t: string) => t.replace(/ /g, " ");

describe("os quatro passos", () => {
  it("são materiais, máquinas, mão de obra e resultado, cada um com a sua pergunta", () => {
    expect(PASSOS.map((p) => p.titulo)).toEqual(["Materiais", "Máquinas", "Mão de obra", "Resultado"]);
    for (const p of PASSOS) expect(p.pergunta.length, p.titulo).toBeGreaterThan(10);
  });

  it("avançar e voltar param nas pontas", () => {
    expect(passoSeguinte(1)).toBe(2);
    expect(passoSeguinte(4)).toBe(4);
    expect(passoAnterior(1)).toBe(1);
    expect(passoAnterior(3)).toBe(2);
  });

  it("o botão principal diz para onde vai; no último, aplica", () => {
    expect(rotuloDoBotaoPrincipal(1)).toBe("Avançar: Máquinas");
    expect(rotuloDoBotaoPrincipal(3)).toBe("Avançar: Resultado");
    expect(rotuloDoBotaoPrincipal(4)).toBe("Aplicar ao item");
  });
});

describe("a barra diz o que cada passo já tem", () => {
  const vazio = {
    materiais: 0, processos: 0, maoDeObra: 0,
    custoMateriais: 0, custoProcessos: 0, custoMaoDeObra: 0, custoTotal: 0, temVetada: false,
  };

  it("tudo vazio: 'nenhum' e 'sem custo ainda'", () => {
    const e = estadoDosPassos(vazio);
    expect(e.map((x) => x.situacao)).toEqual(["vazio", "vazio", "vazio", "vazio"]);
    expect(e[0].resumo).toBe("nenhum");
    expect(e[3].resumo).toBe("sem custo ainda");
  });

  it("preenchido: a contagem e o subtotal, no singular e no plural", () => {
    const e = estadoDosPassos({ ...vazio, materiais: 2, custoMateriais: 18, processos: 1, custoProcessos: 5.5, custoTotal: 23.5 });
    expect(sp(e[0].resumo)).toBe("2 materiais · R$ 18,00");
    expect(sp(e[1].resumo)).toBe("1 máquina · R$ 5,50");
    expect(sp(e[3].resumo)).toBe("custo R$ 23,50");
    expect(e.map((x) => x.situacao)).toEqual(["preenchido", "preenchido", "vazio", "preenchido"]);
  });

  it("linha posta mas sem custo não ganha o check (no laboratório, a função sem horas aparecia pronta)", () => {
    const e = estadoDosPassos({ ...vazio, maoDeObra: 1, custoMaoDeObra: 0, materiais: 1, custoMateriais: 24.35, custoTotal: 24.35 });
    expect(e[2].situacao).toBe("vazio");
    expect(e[2].resumo).toBe("1 função sem custo");
    expect(e[0].situacao).toBe("preenchido");
  });

  it("máquina que não faz o material: o passo das máquinas e o resultado ficam em problema", () => {
    const e = estadoDosPassos({ ...vazio, processos: 1, custoTotal: 10, temVetada: true });
    expect(e[1].situacao).toBe("problema");
    expect(e[1].resumo).toBe("máquina que não faz este material");
    expect(e[3].situacao).toBe("problema");
  });

  it("desenha quatro botões; o atual é o passo da página e o problema fica em vermelho", () => {
    const estados = estadoDosPassos({ ...vazio, materiais: 1, custoMateriais: 4, temVetada: true, processos: 1 });
    const html = renderToStaticMarkup(createElement(BarraDePassos, { atual: 2, estados, onIr: () => undefined }));
    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("máquina que não faz este material");
    expect(html).toContain("text-destructive");
    expect(html).toContain("min-h-11");
  });
});

describe("a janela", () => {
  it("cada seção só aparece no seu passo", () => {
    expect(CALC).toContain("{passo === 1 && (");
    expect(CALC).toContain("{passo === 2 && (");
    expect(CALC).toContain("{passo === 3 && (");
    expect(CALC).toContain("{passo === 4 && (");
    // Os quatro marcadores vêm na ordem dos passos.
    const i = [1, 2, 3, 4].map((n) => CALC.indexOf(`{passo === ${n} && (`));
    expect(i).toEqual([...i].sort((a, b) => a - b));
    expect(CALC).toContain("<BarraDePassos atual={passo} estados={estados} onIr={setPasso} />");
  });

  it("o que foi digitado não se perde ao trocar de passo: o estado mora fora dos passos", () => {
    // Os três estados são declarados antes de `passo`, no componente, não dentro de cada seção.
    const declaracoes = CALC.slice(0, CALC.indexOf("const [passo, setPasso]"));
    for (const st of ["const [materiais, setMateriais]", "const [processos, setProcessos]", "const [maoDeObra, setMaoDeObra]"]) {
      expect(declaracoes).toContain(st);
    }
  });

  it("fechar a janela volta ao passo 1; 'Aplicar' só existe no passo 4 e continua travado por linha vetada", () => {
    expect(CALC).toContain("setPasso(1);");
    expect(CALC).toContain("const podeAplicar = !!resultado && temAlgumaLinha && resultado.custoTotal > 0 && !temVetada;");
    expect(CALC).toContain("{passo < 4 ? (");
    expect(CALC).toContain("{rotuloDoBotaoPrincipal(4)}");
    expect(CALC).toContain("disabled={!podeAplicar}");
  });

  it("a margem boa aparece (text-accent sumia no branco) e o percentual sai com vírgula", () => {
    expect(CALC).toContain('resultado.margemPct < 0.2 ? "text-destructive" : "text-success"');
    expect(CALC).toContain('const pct = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;');
  });

  it("ficou mais estreita (uma seção por vez cabe em 3xl) e o aviso de carga continua em todos os passos", () => {
    expect(CALC).toContain('className="max-w-3xl max-h-[90vh] overflow-auto"');
    expect(CALC.indexOf("falhasDeCarga.length > 0 && (")).toBeLessThan(CALC.indexOf("<BarraDePassos"));
  });
});
