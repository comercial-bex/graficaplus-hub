import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calcularTrofeu,
  ErroDoTrofeu,
  fecharEm90,
  multiplicadorDaQuantidade,
  precoDaArte,
  type ModeloDeTrofeu,
} from "@/domain/trofeus/conta";
import { ECONOMICO, MATERIAL, MODELOS, PADRAO, PREMIUM, REGRAS, REGRAS_DA_ARTE, TAXAS } from "./apoio/trofeus";

/**
 * 22/11/2026. O dono pediu o orçamento de troféu de acrílico: preço pela regra do ×3 sobre o custo cheio, com
 * desconto por quantidade. Estes testes travam a conta, para que mudar uma taxa mude o preço de propósito.
 */
const calcula = (modelo: ModeloDeTrofeu, quantidade = 1, extra: { alturaM?: number; urgente?: boolean } = {}) =>
  calcularTrofeu({ modelo, alturaM: extra.alturaM ?? modelo.alturaDeReferenciaM, quantidade, urgente: extra.urgente }, TAXAS, REGRAS);

describe("o preço fecha em ,90", () => {
  it("é o menor valor terminado em ,90 que não fica abaixo do calculado", () => {
    expect(fecharEm90(55.79)).toBe(55.9);
    expect(fecharEm90(84.89)).toBe(84.9);
    expect(fecharEm90(84.95)).toBe(85.9);
    expect(fecharEm90(193.05)).toBe(193.9);
    expect(fecharEm90(60)).toBe(60.9);
    expect(fecharEm90(55.9)).toBe(55.9);
  });
  it("preço zero ou inválido não vira preço", () => {
    expect(fecharEm90(0)).toBe(0);
    expect(fecharEm90(-3)).toBe(0);
    expect(fecharEm90(Number.NaN)).toBe(0);
  });
});

describe("o multiplicador: ×3 na linha, desconto por quantidade, piso e urgência", () => {
  it("a escada do ×3: 3, 2,7, 2,4 e 2,2 (o piso)", () => {
    const m = (q: number) => multiplicadorDaQuantidade(3, q, REGRAS).multiplicador;
    expect([1, 4, 5, 19, 20, 49, 50, 500].map(m)).toEqual([3, 3, 2.7, 2.7, 2.4, 2.4, 2.2, 2.2]);
  });
  it("nunca fica abaixo do piso, mesmo com base baixa", () => {
    expect(multiplicadorDaQuantidade(2.3, 100, REGRAS).multiplicador).toBe(2.2);
  });
  it("o premium exclusivo a ×3,5 segue a mesma escada", () => {
    const m = (q: number) => multiplicadorDaQuantidade(3.5, q, REGRAS).multiplicador;
    expect([m(1), m(5), m(20), m(50)]).toEqual([3.5, 3.15, 2.8, 2.5666]);
  });
  it("urgência sobe a base para ×4 e nunca baixa uma base maior", () => {
    expect(multiplicadorDaQuantidade(3, 1, REGRAS, true).multiplicador).toBe(4);
    expect(multiplicadorDaQuantidade(4.5, 1, REGRAS, true).multiplicador).toBe(4.5);
  });
  it("diz de qual faixa a quantidade é", () => {
    expect(multiplicadorDaQuantidade(3, 7, REGRAS).faixaDe).toBe(5);
    expect(multiplicadorDaQuantidade(3, 60, REGRAS).faixaDe).toBe(50);
  });
});

describe("os três modelos, com o custo do banco de 22/11/2026", () => {
  it("custo cheio e preço de 1 troféu na altura de referência", () => {
    const eco = calcula(ECONOMICO);
    const pad = calcula(PADRAO);
    const pre = calcula(PREMIUM);
    expect([eco.custoCheio, pad.custoCheio, pre.custoCheio]).toEqual([17.74, 28.45, 63.7]);
    expect([eco.precoUnitario, pad.precoUnitario, pre.precoUnitario]).toEqual([53.9, 85.9, 191.9]);
  });

  it("o preço é o custo cheio vezes 3, fechado em ,90 (nunca abaixo do ×3)", () => {
    for (const modelo of MODELOS) {
      const r = calcula(modelo);
      expect(r.multiplicador).toBe(3);
      expect(r.precoUnitario).toBeGreaterThanOrEqual(r.precoCalculado);
      expect(r.precoUnitario - r.precoCalculado).toBeLessThan(1);
      expect(r.precoCalculado).toBeCloseTo(r.custoCheio * 3, 1);
    }
  });

  it("a margem líquida de 1 troféu fica acima de 40% em todos", () => {
    for (const modelo of MODELOS) expect(calcula(modelo).margemLiquidaPct).toBeGreaterThan(40);
  });

  it("a margem líquida é a conta de fora: preço sem imposto e sem metade do cartão, menos o custo de produção", () => {
    for (const modelo of MODELOS) {
      const r = calcula(modelo);
      const liquido = r.precoUnitario * (1 - (6 + 3.5 / 2) / 100);
      expect(r.margemLiquidaPct).toBeCloseTo(((liquido - r.custoDeProducao) / r.precoUnitario) * 100, 1);
    }
  });

  it("o custo de produção é maior que o cheio: leva a sobra de corte, a falha e a ocupação", () => {
    for (const modelo of MODELOS) {
      const r = calcula(modelo);
      expect(r.custoDeProducao).toBeGreaterThan(r.custoCheio);
    }
  });

  it("as parcelas somam o custo cheio", () => {
    for (const modelo of MODELOS) {
      const r = calcula(modelo);
      const soma = Object.values(r.custo).reduce((s, v) => s + v, 0);
      expect(soma).toBeCloseTo(r.custoCheio, 1);
    }
  });

  it("o premium tem mais peças, mais corte e mais laser que o econômico", () => {
    const eco = calcula(ECONOMICO);
    const pre = calcula(PREMIUM);
    expect(eco.pecas).toBe(3);
    expect(pre.pecas).toBe(11);
    expect(pre.corteM).toBeGreaterThan(eco.corteM);
    expect(pre.minutosDeLaser).toBeGreaterThan(eco.minutosDeLaser);
  });
});

describe("a altura escala o troféu", () => {
  it("dobrar a altura quadruplica a área e dobra o corte", () => {
    // o econômico tem 18 cm: dobrado, 36 cm, ainda dentro do limite de 40 cm
    const base = calcula(ECONOMICO);
    const dobro = calcula(ECONOMICO, 1, { alturaM: ECONOMICO.alturaDeReferenciaM * 2 });
    expect(dobro.fatorDeEscala).toBe(2);
    expect(dobro.areaUtilM2).toBeCloseTo(base.areaUtilM2 * 4, 3);
    expect(dobro.corteM).toBeCloseTo(base.corteM * 2, 2);
    expect(dobro.minutosDeMaoDeObra).toBeCloseTo(base.minutosDeMaoDeObra * 2, 2);
  });
  it("pela metade, a área cai a um quarto e o corte à metade", () => {
    const base = calcula(PREMIUM);
    const metade = calcula(PREMIUM, 1, { alturaM: PREMIUM.alturaDeReferenciaM / 2 });
    expect(metade.fatorDeEscala).toBe(0.5);
    expect(metade.areaUtilM2).toBeCloseTo(base.areaUtilM2 / 4, 3);
    expect(metade.corteM).toBeCloseTo(base.corteM / 2, 2);
  });
  it("um troféu maior custa e cobra mais; um menor, menos", () => {
    const ref = calcula(ECONOMICO);
    expect(calcula(ECONOMICO, 1, { alturaM: 0.25 }).precoUnitario).toBeGreaterThan(ref.precoUnitario);
    expect(calcula(ECONOMICO, 1, { alturaM: 0.15 }).precoUnitario).toBeLessThan(ref.precoUnitario);
  });
  it("a altura fora do limite é recusada com a faixa na frase", () => {
    expect(() => calcula(ECONOMICO, 1, { alturaM: 0.05 })).toThrow("A altura vai de 12 a 40 cm.");
    expect(() => calcula(ECONOMICO, 1, { alturaM: 0.9 })).toThrow("A altura vai de 12 a 40 cm.");
  });
});

describe("a quantidade", () => {
  it("o preço de cada um cai pela escada e nunca passa abaixo de ×2,2 do custo cheio", () => {
    for (const modelo of MODELOS) {
      const precos = [1, 5, 20, 50].map((q) => calcula(modelo, q).precoUnitario);
      expect(precos).toEqual([...precos].sort((a, b) => b - a));
      const r = calcula(modelo, 200);
      expect(r.multiplicador).toBe(2.2);
      expect(r.precoCalculado).toBeCloseTo(r.custoCheio * 2.2, 1);
    }
  });
  it("o preparo do laser se divide pelos troféus: a máquina de cada um cai", () => {
    expect(calcula(ECONOMICO, 1).custo.maquina).toBeGreaterThan(calcula(ECONOMICO, 50).custo.maquina);
    expect(calcula(ECONOMICO, 10).minutosDeLaser).toBeLessThan(calcula(ECONOMICO, 1).minutosDeLaser);
  });
  it("o total é o preço de cada vezes a quantidade", () => {
    const r = calcula(PADRAO, 12);
    expect(r.precoTotal).toBeCloseTo(r.precoUnitario * 12, 2);
  });
  it("urgência cobra ×4 e a margem sobe", () => {
    const normal = calcula(PADRAO, 1);
    const urgente = calcula(PADRAO, 1, { urgente: true });
    expect(urgente.multiplicador).toBe(4);
    expect(urgente.precoUnitario).toBeGreaterThan(normal.precoUnitario);
    expect(urgente.margemLiquidaPct).toBeGreaterThan(normal.margemLiquidaPct);
  });
  it("quantidade fracionada, zero ou negativa é recusada", () => {
    for (const q of [0, -2, 2.5, Number.NaN]) {
      expect(() => calcula(ECONOMICO, q)).toThrow("Informe a quantidade de troféus, em número inteiro.");
    }
  });
});

describe("a decoração e o que entra no custo", () => {
  it("só a peça de vinil laminado leva decoração; a gravação a laser entra no tempo da máquina", () => {
    const semDecoracao: ModeloDeTrofeu = { ...ECONOMICO, pecas: ECONOMICO.pecas.map((p) => ({ ...p, decoracao: "nenhuma" as const })) };
    expect(calcula(semDecoracao).custo.decoracao).toBe(0);
    expect(calcula(ECONOMICO).custo.decoracao).toBeGreaterThan(0);

    const gravado: ModeloDeTrofeu = { ...ECONOMICO, pecas: ECONOMICO.pecas.map((p) => ({ ...p, decoracao: "gravacao_laser" as const })) };
    expect(calcula(gravado).custo.decoracao).toBe(0);
    expect(calcula(gravado).minutosDeLaser).toBeGreaterThan(calcula(semDecoracao).minutosDeLaser);
  });
  it("a cola conta uma junção por peça depois da primeira", () => {
    const umaPeca: ModeloDeTrofeu = { ...ECONOMICO, pecas: [{ ...ECONOMICO.pecas[0], quantidade: 1 }] };
    expect(calcula(umaPeca).custo.cola).toBe(0);
    expect(calcula(ECONOMICO).custo.cola).toBeCloseTo(2 * TAXAS.colaMlPorJuncao * TAXAS.custoMlCola, 2);
  });
  it("o material entra pela área útil: área × custo do m²", () => {
    const placa: ModeloDeTrofeu = {
      ...ECONOMICO,
      pecas: [{ nome: "Placa", materialId: MATERIAL.cristal3, espessuraMm: 3, larguraM: 0.5, alturaM: 0.4, quantidade: 1, fatorDeForma: 1, decoracao: "nenhuma" }],
      alturaDeReferenciaM: 0.4,
    };
    // 0,5 × 0,4 = 0,2 m² a R$ 180,00 = R$ 36,00
    expect(calcula(placa).custo.material).toBe(36);
  });
});

describe("taxa que falta é erro, nunca preço com número de fábrica", () => {
  it("material sem custo por m²", () => {
    const sem = { ...TAXAS, custoM2PorMaterial: { ...TAXAS.custoM2PorMaterial, [MATERIAL.preto3]: null } };
    expect(() => calcularTrofeu({ modelo: ECONOMICO, alturaM: 0.18, quantidade: 1 }, sem, REGRAS)).toThrow(
      'O material de "Base" está sem custo por m² no cadastro. Avise a gerência.',
    );
  });
  it("material que nem está no cadastro", () => {
    const sem = { ...TAXAS, custoM2PorMaterial: {} };
    expect(() => calcularTrofeu({ modelo: ECONOMICO, alturaM: 0.18, quantidade: 1 }, sem, REGRAS)).toThrow(ErroDoTrofeu);
  });
  it("espessura sem velocidade de corte", () => {
    const sem = { ...TAXAS, velocidadeDeCorteMPorMin: { "3": 1 } };
    expect(() => calcularTrofeu({ modelo: ECONOMICO, alturaM: 0.18, quantidade: 1 }, sem, REGRAS)).toThrow(
      "Falta a velocidade de corte do acrílico de 2 mm.",
    );
  });
  it("modelo sem peças", () => {
    expect(() => calcula({ ...ECONOMICO, pecas: [] })).toThrow("O modelo não tem peças.");
  });
  it("perda ou falha negativa", () => {
    const sem = { ...TAXAS, pctPerdaMaterial: -5 };
    expect(() => calcularTrofeu({ modelo: ECONOMICO, alturaM: 0.18, quantidade: 1 }, sem, REGRAS)).toThrow(
      "Perda e falha não podem ser negativas.",
    );
  });
  it("perda e falha que somam 90% ou mais", () => {
    const sem = { ...TAXAS, pctPerdaMaterial: 60, pctFalhaProducao: 30 };
    expect(() => calcularTrofeu({ modelo: ECONOMICO, alturaM: 0.18, quantidade: 1 }, sem, REGRAS)).toThrow(
      "A soma de perda e falha não pode passar de 90%.",
    );
  });
});

describe("a arte do troféu é uma linha separada", () => {
  const arte = (tipo: "cliente_manda" | "adaptar_modelo" | "criacao_exclusiva", extra: object = {}, q = 10) =>
    precoDaArte({ tipo, quantidadeDeTrofeus: q, ...extra }, TAXAS, REGRAS_DA_ARTE);

  it("arte pronta do cliente e adaptação do modelo não cobram nada", () => {
    expect(arte("cliente_manda")).toEqual({ linhas: [], total: 0 });
    expect(arte("adaptar_modelo")).toEqual({ linhas: [], total: 0 });
  });
  it("criação exclusiva: 3 horas de designer a ×3, fechada na dezena (R$ 220,00)", () => {
    const r = arte("criacao_exclusiva");
    expect(r.total).toBe(220);
    expect(r.linhas).toHaveLength(1);
  });
  it("a partir de 20 troféus a criação exclusiva leva o desconto", () => {
    expect(arte("criacao_exclusiva", {}, 19).total).toBe(220);
    expect(arte("criacao_exclusiva", {}, 20).total).toBe(110);
  });
  it("alteração extra e nome individual entram em linhas próprias", () => {
    const r = arte("adaptar_modelo", { alteracoesExtras: 2, nomesIndividuais: 8 });
    expect(r.linhas.map((l) => l.valor)).toEqual([60, 32]);
    expect(r.total).toBe(92);
  });
  it("mais nomes do que troféus é recusado", () => {
    expect(() => arte("adaptar_modelo", { nomesIndividuais: 11 }, 10)).toThrow("Há mais nomes individuais do que troféus.");
  });
  it("quantidade zero é recusada", () => {
    expect(() => arte("cliente_manda", {}, 0)).toThrow("Informe a quantidade de troféus.");
  });
});

describe("a conta é função pura", () => {
  it("não importa banco, React nem rede", () => {
    const fonte = readFileSync("src/domain/trofeus/conta.ts", "utf8");
    expect(fonte).not.toMatch(/from\s+["'](react|@tanstack|@supabase|@\/integrations|@\/lib)/);
    expect(fonte).not.toMatch(/\bfetch\(|supabase|process\.env/);
  });
  it("dá o mesmo resultado na segunda chamada", () => {
    expect(calcula(PREMIUM, 7)).toEqual(calcula(PREMIUM, 7));
  });
});
