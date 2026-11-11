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

/* -------------------------------------------------------------------------- */
/* Sobra de avanço                                                             */
/* -------------------------------------------------------------------------- */

test("o avanço soma ao metro linear: o rolo puxa material para carregar e para cortar", () => {
  const semAvanco = planejarBobina({
    larguraPeca: 0.5, alturaPeca: 1, quantidade: 2, ...MAQUINA, ...BOBINA,
  });
  const comAvanco = planejarBobina({
    larguraPeca: 0.5, alturaPeca: 1, quantidade: 2, ...MAQUINA, ...BOBINA, avancoM: 0.2,
  });
  expect(semAvanco.cabe && comAvanco.cabe).toBe(true);
  if (!semAvanco.cabe || !comAvanco.cabe) return;
  expect(comAvanco.plano.metrosLineares - semAvanco.plano.metrosLineares).toBeCloseTo(0.2, 3);
  expect(comAvanco.plano.avanco).toBe(0.2);
  // O m² consumido segue o metro linear: é a mesma bobina mais comprida.
  expect(comAvanco.plano.m2Consumidos).toBeCloseTo(1.06 * comAvanco.plano.metrosLineares, 3);
});

test("em peça pequena o avanço É o consumo — 20 cm de avanço numa tira de 20 cm", () => {
  const r = planejarBobina({
    larguraPeca: 0.2, alturaPeca: 0.2, quantidade: 1, ...MAQUINA, ...BOBINA, avancoM: 0.2,
  });
  expect(r.cabe).toBe(true);
  if (!r.cabe) return;
  // 0,20 de peça + 0,20 de avanço: metade do material vai embora.
  expect(r.plano.metrosLineares).toBeCloseTo(0.4, 3);
  expect(r.plano.avanco / r.plano.metrosLineares).toBeCloseTo(0.5, 2);
});

test("o avanço entra uma vez por trabalho, não por fileira", () => {
  const uma = planejarBobina({
    larguraPeca: 0.5, alturaPeca: 1, quantidade: 2, ...MAQUINA, ...BOBINA, avancoM: 0.3,
  });
  const dez = planejarBobina({
    larguraPeca: 0.5, alturaPeca: 1, quantidade: 20, ...MAQUINA, ...BOBINA, avancoM: 0.3,
  });
  expect(uma.cabe && dez.cabe).toBe(true);
  if (!uma.cabe || !dez.cabe) return;
  expect(uma.plano.avanco).toBe(dez.plano.avanco);
  // 10 fileiras contra 1: a diferença é só de peça, o avanço não multiplica.
  expect(dez.plano.metrosLineares - uma.plano.metrosLineares).toBeCloseTo(9 * 1.003, 2);
});

test("avanço negativo não vira crédito de material", () => {
  const r = planejarBobina({
    larguraPeca: 0.5, alturaPeca: 1, quantidade: 2, ...MAQUINA, ...BOBINA, avancoM: -5,
  });
  expect(r.cabe).toBe(true);
  if (!r.cabe) return;
  expect(r.plano.avanco).toBe(0);
  expect(r.plano.metrosLineares).toBeGreaterThan(0);
});

/* -------------------------------------------------------------------------- */
/* Divisão inteira: o encaixe exato não perde coluna (10/11/2026)              */
/* -------------------------------------------------------------------------- */

// A definição, sem divisão nenhuma: o maior n com n·l + (n−1)·e ≤ d, tudo em milímetros inteiros.
function porDefinicao(d: number, l: number, e: number): number {
  if (d < l) return 0;
  let n = 1;
  while ((n + 1) * l + n * e <= d) n++;
  return n;
}

test("encaixe exato: 0,6 de largura com peça de 0,2 e sem espaço são 3 colunas, não 2", () => {
  // Em metros de ponto flutuante 0,6 ÷ 0,2 vale 2,9999999999999996, e o Math.floor devolvia 2.
  expect(colunasQueCabem(0.6, 0.2, 0)).toBe(3);
});

test("os encaixes exatos que o ponto flutuante estragava dão a conta de inteiros", () => {
  expect(colunasQueCabem(0.3, 0.1, 0)).toBe(3);
  expect(colunasQueCabem(0.7, 0.1, 0)).toBe(7);
  expect(colunasQueCabem(0.57, 0.19, 0)).toBe(3);
  expect(colunasQueCabem(2.4, 0.8, 0)).toBe(3);
  expect(colunasQueCabem(0.29, 0.01, 0)).toBe(29);
  // 3 peças de 0,1 e 2 espaços de 0,05 ocupam 0,4.
  expect(colunasQueCabem(0.4, 0.1, 0.05)).toBe(3);
  // Os que já davam certo continuam dando.
  expect(colunasQueCabem(1.1, 0.1, 0)).toBe(11);
  expect(colunasQueCabem(0.9, 0.3, 0)).toBe(3);
});

test("1 mm a menos perde a coluna: a conta inteira não arredonda para cima", () => {
  expect(colunasQueCabem(0.599, 0.2, 0)).toBe(2);
  expect(colunasQueCabem(0.6, 0.2, 0)).toBe(3);
  expect(colunasQueCabem(1.239, 0.244, 0.005)).toBe(4);
  expect(colunasQueCabem(1.24, 0.244, 0.005)).toBe(5);
});

test("o exemplo do relatório: bobina 1,27 m, margem 15 mm, espaço 5 mm, peça 244 × 159 mm, 100 peças", () => {
  // A conta certa: 1,27 − 2 × 0,015 = 1,24 de largura útil e (1,24 + 0,005) ÷ (0,244 + 0,005) = 5 exatos.
  // A antiga dizia 4 colunas, 25 fileiras e 4,095 m: 25% de material a mais.
  const r = planejarBobina({
    larguraPeca: 0.244,
    alturaPeca: 0.159,
    quantidade: 100,
    larguraBobina: 1.27,
    larguraUtilMaquina: 1.8,
    margemLateral: 0.015,
    espacamento: 0.005,
    permitirRotacao: false,
  });
  if (!r.cabe) throw new Error("deveria caber");
  expect(r.plano.larguraUtilizavel).toBe(1.24);
  expect(r.plano.colunas).toBe(5);
  expect(r.plano.linhas).toBe(20);
  expect(r.plano.metrosLineares).toBe(3.275);
  // As 5 colunas fecham a largura útil sem sobra.
  expect(r.plano.sobraLateral).toBe(0);
});

test("com o giro liberado, a conta certa deixa a peça em pé; a antiga virava a peça e gastava mais", () => {
  // Antiga: em pé eram 4 colunas e 4,095 m, e a peça virada (7 colunas, 15 fileiras) dava 3,73 m, então virava.
  // Certa: em pé são 5 colunas, 20 fileiras e 3,275 m, menos que os 3,73 m da peça virada.
  const r = planejarBobina({
    larguraPeca: 0.244,
    alturaPeca: 0.159,
    quantidade: 100,
    larguraBobina: 1.27,
    larguraUtilMaquina: 1.8,
    margemLateral: 0.015,
    espacamento: 0.005,
  });
  if (!r.cabe) throw new Error("deveria caber");
  expect(r.plano.orientacao).toBe("normal");
  expect(r.plano.colunas).toBe(5);
  expect(r.plano.linhas).toBe(20);
  expect(r.plano.metrosLineares).toBe(3.275);
});

test("grade de 4,2 milhões de combinações: nenhuma diferença contra a conta de inteiros", () => {
  // Disponível de 50 a 2.000 mm, peça de 5 a 400 mm, espaço de 0 a 5 mm, tudo em milímetros inteiros e
  // passado em metros, como a tela passa. A conta antiga errava 12.109 (0,28%), sempre uma coluna a menos.
  let combinacoes = 0;
  const diferentes: string[] = [];
  for (let d = 50; d <= 2000; d++) {
    for (let l = 5; l <= 400; l++) {
      if (d < l) continue;
      for (let e = 0; e <= 5; e++) {
        combinacoes++;
        const obtido = colunasQueCabem(d / 1000, l / 1000, e / 1000);
        const certo = porDefinicao(d, l, e);
        if (obtido !== certo && diferentes.length < 5) {
          diferentes.push(
            `disponível ${d} mm, peça ${l} mm, espaço ${e} mm: deu ${obtido}, certo ${certo}`,
          );
        }
      }
    }
  }
  expect(combinacoes).toBe(4_267_026);
  expect(diferentes).toEqual([]);
}, 60_000);

test("planejarBobina usa a conta de inteiros nas bobinas e margens da casa", () => {
  const diferentes: string[] = [];
  let combinacoes = 0;
  for (const bobina of [1.06, 1.22, 1.27, 1.6]) {
    for (const margemMm of [0, 5, 10, 15]) {
      for (const espacoMm of [0, 2, 3, 5]) {
        for (let pecaMm = 20; pecaMm <= 400; pecaMm += 7) {
          const r = planejarBobina({
            larguraPeca: pecaMm / 1000,
            alturaPeca: 0.1,
            quantidade: 100,
            larguraBobina: bobina,
            larguraUtilMaquina: 1.8,
            margemLateral: margemMm / 1000,
            espacamento: espacoMm / 1000,
            permitirRotacao: false,
          });
          const disponivelMm = Math.round(bobina * 1000) - 2 * margemMm;
          const certo = porDefinicao(disponivelMm, pecaMm, espacoMm);
          if (certo === 0) continue;
          combinacoes++;
          const obtido = r.cabe ? r.plano.colunas : 0;
          if (obtido !== certo)
            diferentes.push(
              `bobina ${bobina}, margem ${margemMm}, espaço ${espacoMm}, peça ${pecaMm}: ${obtido} contra ${certo}`,
            );
        }
      }
    }
  }
  expect(combinacoes).toBeGreaterThan(3000);
  expect(diferentes).toEqual([]);
});

test("medida que não é múltipla de 0,1 mm arredonda ao décimo de milímetro mais próximo", () => {
  // A tela só guarda 1 mm, então isto só acontece em conta feita à mão. O erro é de até 0,05 mm por medida.
  // 0,20004 m são 2000,4 décimos de mm e contam como 2000 (igual a 0,2); 0,20006 m contam como 2001.
  expect(colunasQueCabem(0.6, 0.20004, 0)).toBe(colunasQueCabem(0.6, 0.2, 0));
  expect(colunasQueCabem(0.6, 0.20006, 0)).toBe(2);
});

test("entrada que não é medida devolve 0 colunas, e espaço negativo vale 0", () => {
  expect(colunasQueCabem(1.04, 0, 0.003)).toBe(0);
  expect(colunasQueCabem(1.04, -0.1, 0.003)).toBe(0);
  expect(colunasQueCabem(Number.NaN, 0.1, 0)).toBe(0);
  expect(colunasQueCabem(1, Number.NaN, 0)).toBe(0);
  expect(colunasQueCabem(1, 0.1, Number.NaN)).toBe(0);
  expect(colunasQueCabem(Number.POSITIVE_INFINITY, 0.1, 0)).toBe(0);
  // Acima de 900 bilhões de metros o inteiro deixa de ser exato: não é medida.
  expect(colunasQueCabem(1e13, 0.1, 0)).toBe(0);
  // Não cabe nem uma.
  expect(colunasQueCabem(0.05, 0.1, 0)).toBe(0);
  expect(colunasQueCabem(-1, 0.1, 0)).toBe(0);
  expect(colunasQueCabem(1.04, 0.07, -0.5)).toBe(colunasQueCabem(1.04, 0.07, 0));
  // Largura positiva nunca vira zero (nada de divisão por zero): abaixo de 0,05 mm conta como 1 décimo.
  expect(colunasQueCabem(0.001, 0.00001, 0)).toBe(10);
});
