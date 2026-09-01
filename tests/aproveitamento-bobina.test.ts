import { test, expect } from "vitest";
import {
  colunasQueCabem,
  planejarBobina,
} from "../src/domain/producao/aproveitamento-bobina";

// Cenário real da Bex Print: máquina i1600 com boca de 1,80 m e bobina de vinil
// adesivo de 1,06 m — que é a medida padrão do mercado.
const MAQUINA = { larguraUtilMaquina: 1.8 };
const BOBINA = { larguraBobina: 1.06 };

test("o gargalo é a bobina, não a boca da máquina", () => {
  const r = planejarBobina({
    larguraPeca: 0.33,
    alturaPeca: 0.33,
    quantidade: 100,
    ...MAQUINA,
    ...BOBINA,
  });
  expect(r.cabe).toBe(true);
  if (!r.cabe) return;
  // 1,06 − 2×0,01 = 1,04 de largura aproveitável, não 1,78.
  expect(r.plano.larguraUtilizavel).toBe(1.04);
  // (1,04 + 0,003) ÷ (0,33 + 0,003) = 3,13 → 3 por fileira.
  expect(r.plano.colunas).toBe(3);
});

test("a última peça da fileira não paga espaçamento à direita", () => {
  // Sem esse detalhe a conta perde uma coluna justamente na peça pequena.
  expect(colunasQueCabem(1.04, 0.07, 0.003)).toBe(14);
  // 14 × 0,07 + 13 × 0,003 = 1,019 ≤ 1,04. A 15ª exigiria 1,092.
  expect(14 * 0.07 + 13 * 0.003).toBeLessThanOrEqual(1.04);
  expect(15 * 0.07 + 14 * 0.003).toBeGreaterThan(1.04);
});

test("praguinha 7 × 7: 1.000 peças na bobina de 1,06", () => {
  const r = planejarBobina({
    larguraPeca: 0.07,
    alturaPeca: 0.07,
    quantidade: 1000,
    ...MAQUINA,
    ...BOBINA,
  });
  expect(r.cabe).toBe(true);
  if (!r.cabe) return;
  expect(r.plano.colunas).toBe(14);
  expect(r.plano.linhas).toBe(Math.ceil(1000 / 14)); // 72
  // 72 × 0,073 − 0,003 = 5,253 m lineares.
  expect(r.plano.metrosLineares).toBeCloseTo(5.253, 3);
  // A largura inteira do rolo é consumida, inclusive a sobra lateral.
  expect(r.plano.m2Consumidos).toBeCloseTo(1.06 * 5.253, 3);
});

test("o m² consumido sustenta o preço do catálogo", () => {
  // Catálogo: praguinha 7 × 7, 1.000 un = R$ 430,00 na régua de R$ 75/m².
  // Isso implica ~5,73 m² de bobina. A conta de aproveitamento precisa chegar
  // na mesma ordem de grandeza, senão a régua do catálogo não fecha.
  const r = planejarBobina({
    larguraPeca: 0.07,
    alturaPeca: 0.07,
    quantidade: 1000,
    ...MAQUINA,
    ...BOBINA,
  });
  if (!r.cabe) throw new Error("deveria caber");
  const implicitoNoCatalogo = 430 / 75;
  const diferenca = Math.abs(r.plano.m2Consumidos - implicitoNoCatalogo) / implicitoNoCatalogo;
  expect(diferenca).toBeLessThan(0.06);
});

test("gira a peça quando isso rende menos metro linear", () => {
  // Testeira 90 × 12: em pé não cabe (0,90 > 0,84 útil da bobina de 0,86);
  // deitada, a peça de 0,12 de largura enfileira várias por fileira.
  const r = planejarBobina({
    larguraPeca: 0.9,
    alturaPeca: 0.12,
    quantidade: 100,
    larguraUtilMaquina: 1.8,
    larguraBobina: 0.86,
  });
  expect(r.cabe).toBe(true);
  if (!r.cabe) return;
  expect(r.plano.orientacao).toBe("girada");
});

test("peça mais larga que a bobina não cabe, e diz por quê", () => {
  const r = planejarBobina({
    larguraPeca: 1.5,
    alturaPeca: 1.5,
    quantidade: 10,
    larguraUtilMaquina: 1.8,
    larguraBobina: 1.06,
  });
  expect(r.cabe).toBe(false);
  if (r.cabe) return;
  expect(r.motivo).toMatch(/não cabe na largura/i);
});

test("sem cadastro de largura, avisa em vez de inventar", () => {
  const r = planejarBobina({
    larguraPeca: 0.33,
    alturaPeca: 0.33,
    quantidade: 100,
    larguraUtilMaquina: 0,
    larguraBobina: 0,
  });
  expect(r.cabe).toBe(false);
  if (r.cabe) return;
  expect(r.motivo).toMatch(/cadastre a largura/i);
});

test("bolão 48 × 48 aproveita bem: duas colunas quase preenchem a bobina", () => {
  const r = planejarBobina({
    larguraPeca: 0.48,
    alturaPeca: 0.48,
    quantidade: 100,
    ...MAQUINA,
    ...BOBINA,
  });
  if (!r.cabe) throw new Error("deveria caber");
  expect(r.plano.colunas).toBe(2);
  // 2 × 0,48 + 0,003 = 0,963 de 1,04 → sobram 7,7 cm de faixa lateral.
  expect(r.plano.sobraLateral).toBeCloseTo(0.077, 3);
  expect(r.plano.aproveitamentoPct).toBeCloseTo(0.9, 2);
});

test("peça de medida ruim para a bobina desperdiça de verdade", () => {
  // 0,60 × 0,60 na bobina de 1,06: cabe UMA por fileira e sobram 44 cm de
  // largura em todo o comprimento — 43% da bobina vira sobra.
  const r = planejarBobina({
    larguraPeca: 0.6,
    alturaPeca: 0.6,
    quantidade: 50,
    ...MAQUINA,
    ...BOBINA,
  });
  if (!r.cabe) throw new Error("deveria caber");
  expect(r.plano.colunas).toBe(1);
  expect(r.plano.aproveitamentoPct).toBeLessThan(0.6);
});
