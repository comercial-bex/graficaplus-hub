import { describe, expect, it } from "vitest";
import { CENARIOS } from "@/domain/simulacao/cenarios-de-balcao";
import {
  degrauDePreco,
  simularPedido,
  valorProgressivo,
  type ItemDoBalcao,
} from "@/domain/simulacao/simulador-de-balcao";
import { produtoDaTabela } from "@/domain/simulacao/tabela-terceirizados";

const cenario = (id: string) => {
  const c = CENARIOS.find((x) => x.id === id);
  if (!c) throw new Error(`cenário ${id} não existe`);
  return c;
};
const rodar = (id: string, extra = {}) => {
  const c = cenario(id);
  return simularPedido(c.itens, { ...c.opcoes, ...extra });
};

describe("simulador de balcão", () => {
  it("a ordem dos itens não muda preço, tempo nem consumo (C e D = D e C)", () => {
    const a = rodar("S05");
    const b = rodar("S06");
    expect(b.total).toBe(a.total);
    expect(b.tempos.totalRelogioMin).toBe(a.tempos.totalRelogioMin);
    expect(b.material.consumoM2).toEqual(a.material.consumoM2);
  });

  it("A + B + C juntos custam a soma de cada um sozinho (sem desconto escondido)", () => {
    const soma = rodar("S01").produtos + rodar("S02").produtos + rodar("S03").produtos;
    expect(rodar("S04").produtos).toBeCloseTo(soma, 2);
  });

  it("o degrau de 6 m²: o pedido maior sai mais barato que o menor", () => {
    expect(rodar("S08b").produtos).toBeLessThan(rodar("S08a").produtos);
    const b = produtoDaTabela("adesivo_top");
    const d = degrauDePreco(b);
    expect(d?.queda).toBeGreaterThan(0);
  });

  it("o preço progressivo nunca deixa o pedido maior custar menos", () => {
    const b = produtoDaTabela("adesivo_top");
    let anterior = 0;
    for (let a = 0.5; a <= 20; a += 0.25) {
      const v = valorProgressivo(b, a);
      expect(v).toBeGreaterThanOrEqual(anterior);
      anterior = v;
    }
  });

  it("limiar por produto soma as linhas; por linha não", () => {
    expect(rodar("S09b").produtos).toBeLessThan(rodar("S09a").produtos);
  });

  it("a taxa do expresso é 12% do valor dos produtos", () => {
    const r = rodar("S18");
    expect(r.taxaExpresso).toBeCloseTo(r.produtos * 0.12, 2);
    expect(rodar("S01").taxaExpresso).toBe(0); // prazo normal não paga taxa
  });

  it("com o estoque de hoje, quase nada vai em expresso (falta vinil e ilhós)", () => {
    expect(rodar("S01").expresso.possivel).toBe(false);
    expect(rodar("S01").material.faltas.length).toBeGreaterThan(0);
  });

  it("com estoque cheio, o pedido comum cabe no expresso", () => {
    expect(rodar("S18", { estoque: "abastecido" }).expresso.possivel).toBe(true);
  });

  it("material que não está cadastrado bloqueia o expresso mesmo com estoque cheio", () => {
    const r = rodar("S07", { estoque: "abastecido" });
    expect(r.expresso.possivel).toBe(false);
  });

  it("mão de obra pesada bloqueia o expresso (500 etiquetas detalhadas)", () => {
    const r = rodar("S11", { estoque: "abastecido" });
    expect(r.tempos.gargalo).toBe("mao_de_obra");
    expect(r.expresso.possivel).toBe(false);
  });

  it("a fila na frente come a janela do expresso", () => {
    const r = rodar("S20", { estoque: "abastecido" });
    expect(r.expresso.possivel).toBe(false);
    expect(r.tempos.totalRelogioMin + 340).toBeGreaterThan(360);
  });

  it("banner pequeno é cobrado pela área mínima de 1 m²", () => {
    expect(rodar("S15").areaM2).toBeGreaterThanOrEqual(1);
    expect(rodar("S15").produtos).toBeCloseTo(37.9, 2);
  });

  it("peça maior que o rolo vira painéis com aviso de emenda", () => {
    const itens: ItemDoBalcao[] = [
      { produto: "adesivo_top", larguraM: 1.5, alturaM: 1.5, quantidade: 1 },
    ];
    const r = simularPedido(itens, { estoque: "abastecido" });
    expect(r.avisos.some((a) => a.codigo === "precisa_de_emenda")).toBe(true);
  });

  it("todos os cenários rodam sem erro e devolvem valores finitos", () => {
    for (const c of CENARIOS) {
      const r = simularPedido(c.itens, c.opcoes);
      expect(Number.isFinite(r.total), c.id).toBe(true);
      expect(r.total, c.id).toBeGreaterThan(0);
      expect(Number.isFinite(r.tempos.totalRelogioMin), c.id).toBe(true);
    }
  });
});
