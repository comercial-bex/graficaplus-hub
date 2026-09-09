import { describe, expect, it } from "vitest";
import {
  custoDoTempo,
  tempoCorteLaser,
  tempoImpressao,
  tempoMarcacaoFiber,
  tempoRecorte,
  velocidadeDeCorte,
  type VelocidadePorMaterial,
} from "../src/domain/producao/tempo-de-maquina";

/**
 * Cada máquina cobra de um jeito. Estes testes fixam as CONTAS, não os
 * números de velocidade — os números vêm de tabela e mudam por máquina; a
 * conta é a regra do negócio e não pode mudar sem quebrar aqui.
 */

// Tabela do fabricante para CO2 100W (GWEIKE), best speed.
const TABELA: VelocidadePorMaterial[] = [
  { material: "acrilico", espessuraMm: 3, velocidadeMmS: 25 },
  { material: "acrilico", espessuraMm: 5, velocidadeMmS: 10 },
  { material: "acrilico", espessuraMm: 8, velocidadeMmS: 5 },
  { material: "acrilico", espessuraMm: 10, velocidadeMmS: 3 },
  { material: "mdf", espessuraMm: 3, velocidadeMmS: 18 },
  { material: "mdf", espessuraMm: 5, velocidadeMmS: 13 },
  { material: "mdf", espessuraMm: 10, velocidadeMmS: 5 },
];

describe("impressão: a peça é a área", () => {
  it("banner de 6 m² a 14 m²/h leva 25,7 min, não uma hora", () => {
    const r = tempoImpressao({ areaM2: 6, velocidadeM2H: 14 });
    expect(r.minutos).toBeCloseTo(25.71, 1);
    expect(r.derivado).toBe(true);
    expect(r.memoria).toContain("6 m² ÷ 14 m²/h");
  });

  it("sem velocidade, não inventa: pede as horas", () => {
    const r = tempoImpressao({ areaM2: 6, velocidadeM2H: 0 });
    expect(r.derivado).toBe(false);
    expect(r.memoria).toContain("informe as horas");
  });
});

describe("corte a laser: a peça é o percurso, e a velocidade depende da chapa", () => {
  it("escolhe a velocidade pelo material e pela espessura", () => {
    expect(velocidadeDeCorte(TABELA, "acrilico", 3)?.velocidadeMmS).toBe(25);
    expect(velocidadeDeCorte(TABELA, "mdf", 10)?.velocidadeMmS).toBe(5);
    expect(velocidadeDeCorte(TABELA, "MDF", 3)?.velocidadeMmS).toBe(18); // caixa não importa
  });

  it("espessura sem linha exata usa a mais próxima ACIMA — a de baixo não atravessa a chapa", () => {
    // 4 mm de acrílico: não há linha. 3 mm cortaria rápido e não atravessa;
    // 5 mm atravessa. Peça que não atravessa é peça refeita.
    expect(velocidadeDeCorte(TABELA, "acrilico", 4)?.espessuraMm).toBe(5);
  });

  it("acima da espessura máxima cai na maior — o operador decide se tenta", () => {
    expect(velocidadeDeCorte(TABELA, "acrilico", 15)?.espessuraMm).toBe(10);
  });

  it("material fora da tabela devolve null, e a conta pede o tempo", () => {
    expect(velocidadeDeCorte(TABELA, "vidro", 3)).toBeNull();
    const r = tempoCorteLaser({ comprimentoCorteM: 2, material: "vidro", espessuraMm: 3, tabela: TABELA });
    expect(r.derivado).toBe(false);
    expect(r.memoria).toContain("sem velocidade cadastrada");
  });

  it("2 m de traçado em acrílico 3 mm: 2000 mm ÷ 25 mm/s × 1,25 de curvas = 100 s", () => {
    const r = tempoCorteLaser({ comprimentoCorteM: 2, material: "acrilico", espessuraMm: 3, tabela: TABELA });
    expect(r.minutos).toBeCloseTo(100 / 60, 2);
    expect(r.memoria).toContain("acrilico 3 mm");
  });

  it("o mesmo traçado em acrílico 10 mm leva 8× mais — um mm/s único erraria por isso", () => {
    const fino = tempoCorteLaser({ comprimentoCorteM: 2, material: "acrilico", espessuraMm: 3, tabela: TABELA });
    const grosso = tempoCorteLaser({ comprimentoCorteM: 2, material: "acrilico", espessuraMm: 10, tabela: TABELA });
    expect(grosso.minutos / fino.minutos).toBeCloseTo(25 / 3, 1);
  });

  it("gravação raster soma ao corte: 10 cm² a 0,1 mm são 10.000 mm de percurso", () => {
    const r = tempoCorteLaser({
      comprimentoCorteM: 0, material: "mdf", espessuraMm: 3, tabela: TABELA,
      areaGravacaoCm2: 10, velocidadeGravacaoMmS: 250, intervaloLinhaMm: 0.1,
    });
    // 10.000 mm ÷ 250 mm/s = 40 s × 1,3 = 52 s
    expect(r.minutos).toBeCloseTo(52 / 60, 2);
    expect(r.memoria).toContain("10 cm² gravados");
  });

  it("aplica o mínimo de 10 min do mercado e diz que aplicou", () => {
    const r = tempoCorteLaser({
      comprimentoCorteM: 0.2, material: "mdf", espessuraMm: 3, tabela: TABELA, minimoMin: 10,
    });
    expect(r.minutos).toBe(10);
    expect(r.memoria).toContain("mínimo de 10 min aplicado");
  });

  it("setup entra uma vez, não por metro", () => {
    const a = tempoCorteLaser({ comprimentoCorteM: 1, material: "mdf", espessuraMm: 3, tabela: TABELA, setupMin: 5 });
    const b = tempoCorteLaser({ comprimentoCorteM: 2, material: "mdf", espessuraMm: 3, tabela: TABELA, setupMin: 5 });
    // dobrar o corte NÃO dobra o total: o setup é fixo
    expect(b.minutos - a.minutos).toBeCloseTo(a.minutos - 5, 1);
  });
});

describe("recorte de vinil: a máquina é rápida, a decapagem manda", () => {
  it("num adesivo médio de 1 m², a mão de obra é maior que a máquina", () => {
    const r = tempoRecorte({
      comprimentoCorteM: 20, velocidadeMmS: 800, areaM2: 1, complexidade: "media",
    });
    // máquina: 20.000 mm ÷ 800 = 25 s × 1,2 = 30 s = 0,5 min
    expect(r.minutosMaquina).toBeCloseTo(0.5, 1);
    // decapagem 8 + transporte 2 = 10 min
    expect(r.minutosMaoDeObra).toBe(10);
    expect(r.minutosMaoDeObra).toBeGreaterThan(r.minutosMaquina * 10);
  });

  it("texto pequeno custa quase 7× mais decapagem que letra grande", () => {
    const simples = tempoRecorte({ comprimentoCorteM: 10, velocidadeMmS: 800, areaM2: 1, complexidade: "simples" });
    const detalhada = tempoRecorte({ comprimentoCorteM: 10, velocidadeMmS: 800, areaM2: 1, complexidade: "detalhada" });
    expect(detalhada.minutos).toBeGreaterThan(simples.minutos * 2);
    expect(detalhada.memoria).toContain("detalhada");
  });
});

describe("marcação a fiber: por peça", () => {
  it("50 chaveiros de 4 cm² em aço: setup uma vez, marcar + trocar por peça", () => {
    const r = tempoMarcacaoFiber({
      pecas: 50, areaMarcacaoCm2: 4, velocidadeMmS: 1000, intervaloLinhaMm: 0.05, setupMin: 5, trocaPecaSeg: 15,
    });
    // 4 cm² = 400 mm² ÷ 0,05 = 8.000 mm ÷ 1000 mm/s = 8 s + 15 s de troca = 23 s
    expect(r.porPeca).toBeCloseTo(23 / 60, 3);
    expect(r.minutos).toBeCloseTo(5 + (50 * 23) / 60, 1);
    expect(r.memoria).toContain("50 peças");
  });

  it("no eixo rotativo, a troca de peça triplica", () => {
    const plana = tempoMarcacaoFiber({ pecas: 10, areaMarcacaoCm2: 4, velocidadeMmS: 1000 });
    const rotativa = tempoMarcacaoFiber({ pecas: 10, areaMarcacaoCm2: 4, velocidadeMmS: 1000, rotativo: true });
    expect(rotativa.minutos).toBeGreaterThan(plana.minutos);
    expect(rotativa.memoria).toContain("45 s de troca");
  });

  it("gravação profunda em 3 passadas triplica o tempo de marcação, não a troca", () => {
    // Área grande de propósito: com 4 cm², 8 s viram 0,13 min e 24 s viram
    // 0,40 — a razão dos ARREDONDADOS dá 3,08 e o teste falharia por ruído,
    // não por regra. Com 40 cm² (80 s e 240 s) o arredondamento some.
    const uma = tempoMarcacaoFiber({ pecas: 1, areaMarcacaoCm2: 40, velocidadeMmS: 1000, trocaPecaSeg: 0 });
    const tres = tempoMarcacaoFiber({ pecas: 1, areaMarcacaoCm2: 40, velocidadeMmS: 1000, trocaPecaSeg: 0, passadas: 3 });
    expect(tres.minutos / uma.minutos).toBeCloseTo(3, 1);
  });

  it("zero peças não inventa tempo", () => {
    expect(tempoMarcacaoFiber({ pecas: 0, areaMarcacaoCm2: 4, velocidadeMmS: 1000 }).minutos).toBe(0);
  });
});

describe("tempo vira dinheiro", () => {
  it("25,7 min da i1600 a R$ 14,43/h custam R$ 6,18 de máquina — não R$ 14,43", () => {
    const r = custoDoTempo({ minutos: 25.71, custoHora: 14.43 });
    expect(r.custoMaquina).toBeCloseTo(6.18, 1);
  });

  it("energia usa a potência total da máquina, não só a do laser", () => {
    // CNC: 100 W de laser, mas ~1,9 kW na tomada (fonte + chiller + exaustor)
    const r = custoDoTempo({ minutos: 60, custoHora: 6.7, potenciaKw: 1.9, tarifaKwh: 1.1339 });
    expect(r.custoEnergia).toBeCloseTo(2.15, 2);
    expect(r.total).toBeCloseTo(8.85, 2);
  });
});

describe("material que a máquina não pode processar", () => {
  // O veto é do MATERIAL, não da espessura: não existe PVC fino o bastante
  // para o laser não liberar cloro.
  const COM_VETO: VelocidadePorMaterial[] = [
    ...TABELA,
    { material: "pvc", espessuraMm: 0, velocidadeMmS: 1, vetado: true, motivo: "PVC no laser libera cloro: corrói a máquina e é tóxico." },
    { material: "acm", espessuraMm: 0, velocidadeMmS: 1, vetado: true, motivo: "ACM tem miolo entre chapas de alumínio — CO2 não corta metal." },
  ];

  it("qualquer espessura de material vetado devolve o veto, não uma velocidade", () => {
    expect(velocidadeDeCorte(COM_VETO, "pvc", 3)?.vetado).toBe(true);
    expect(velocidadeDeCorte(COM_VETO, "pvc", 20)?.vetado).toBe(true);
    expect(velocidadeDeCorte(COM_VETO, "PVC", 0.5)?.vetado).toBe(true);
  });

  it("o veto ganha da linha de velocidade do mesmo material", () => {
    // Alguém pode ter medido o PVC antes de saber do cloro. O veto vem antes.
    const tabela: VelocidadePorMaterial[] = [
      { material: "pvc", espessuraMm: 3, velocidadeMmS: 30 },
      { material: "pvc", espessuraMm: 0, velocidadeMmS: 1, vetado: true, motivo: "libera cloro" },
    ];
    expect(velocidadeDeCorte(tabela, "pvc", 3)?.vetado).toBe(true);
  });

  it("a conta recusa com o motivo e não cobra nada — nem o mínimo", () => {
    const r = tempoCorteLaser({
      comprimentoCorteM: 2, material: "pvc", espessuraMm: 3, tabela: COM_VETO,
      setupMin: 5, minimoMin: 10,
    });
    expect(r.vetado).toBe(true);
    expect(r.derivado).toBe(false);
    expect(r.minutos).toBe(0);
    expect(r.memoria).toContain("cloro");
  });

  it("recusa mesmo sem traçado: o material já basta", () => {
    const r = tempoCorteLaser({
      comprimentoCorteM: 0, material: "acm", espessuraMm: 3, tabela: COM_VETO,
      areaGravacaoCm2: 50,
    });
    expect(r.vetado).toBe(true);
    expect(r.minutos).toBe(0);
  });

  it("material só não cadastrado NÃO é veto — pede o tempo, sem alarme falso", () => {
    const r = tempoCorteLaser({ comprimentoCorteM: 2, material: "vidro", espessuraMm: 3, tabela: COM_VETO });
    expect(r.vetado).toBe(false);
    expect(r.memoria).toContain("sem velocidade cadastrada");
  });

  it("material liberado segue calculando com o veto na tabela ao lado", () => {
    const r = tempoCorteLaser({ comprimentoCorteM: 2, material: "acrilico", espessuraMm: 3, tabela: COM_VETO });
    expect(r.vetado).toBe(false);
    expect(r.derivado).toBe(true);
  });
});

describe("modo de qualidade da impressora", () => {
  it("mais passadas, mais tempo: alta qualidade leva o dobro da produção", () => {
    const producao = tempoImpressao({ areaM2: 6, velocidadeM2H: 14 });
    const alta = tempoImpressao({ areaM2: 6, velocidadeM2H: 7 });
    expect(alta.minutos / producao.minutos).toBeCloseTo(2, 2);
  });
});
