import { describe, expect, it } from "vitest";
import {
  alavancasDeLucro,
  filtrarAlavancas,
  fraseDoAltoDoPainel,
  ordenarAlavancas,
  ROTULO_DE_QUEM,
  textoDoGanho,
  type AlavancaPronta,
  type PainelDeAlavancas,
} from "../../src/domain/precos/alavancas-de-lucro";
import {
  prepararSimulador,
  simularNoPreco,
  type Simulacao,
  type SimuladorPronto,
} from "../../src/domain/precos/simulador-de-preco";
import type { LinhaDePreco } from "../../src/domain/precos/painel-de-precos";
import { lerCustoReal, type CustoRealDoProduto } from "../../src/domain/precos/custo-real";

/** Painel "O que melhora o lucro": contas puras em centavos, sem tela e sem banco. */

const SEM_PONTUACAO = /[()—–→←]/;

const real = (o: Partial<CustoRealDoProduto> = {}): CustoRealDoProduto => ({
  ...lerCustoReal({}),
  custo_producao: 28.47,
  custo_real: 30.86,
  custo_ocupacao: 1.5,
  ocupacao_alvo_pct: 50,
  tres_x_material: 38.4,
  multiplicador_regra_de_tres: 3,
  preco_minimo_recomendado: 40.5,
  trava_que_manda: "piso_custo",
  ...o,
});

const linha = (o: Partial<LinhaDePreco> = {}): LinhaDePreco => ({
  id: "p1",
  nome: "Lona 440g",
  familia: "Lonas",
  unidade: "m2",
  custo: 12,
  custo_cheio: 24,
  preco: 70,
  margem_minima: 30,
  preco_parceiro: 55,
  real: real(),
  taxas: { impostoVendaPct: 4, taxaCartaoPct: 7.5 },
  composicao: { material: 12, maquina: 5, maoDeObra: 4, indireto: 3 },
  menor_concorrente: 62,
  ...o,
});

function monta(
  o: Partial<LinhaDePreco> = {},
  precoCentavos?: number,
): { l: LinhaDePreco; p: SimuladorPronto; s: Simulacao; painel: PainelDeAlavancas } {
  const l = linha(o);
  const p = prepararSimulador(l);
  if (p.estado !== "pronto") throw new Error(`esperava pronto, veio ${p.motivo}`);
  const s = simularNoPreco(p, precoCentavos ?? p.precoDeHojeCentavos ?? 7000);
  if (s.estado !== "ok") throw new Error("simulação inválida");
  return { l, p, s, painel: alavancasDeLucro(l, p, s) };
}

const achar = (painel: PainelDeAlavancas, codigo: string) =>
  painel.prontas.find((a) => a.codigo === codigo);

describe("alavanca de preço", () => {
  it("abaixo do mínimo recomendado, sobe até o mínimo e o ganho é a diferença de lucro", () => {
    const { p, s, painel } = monta({}, 3500);
    const a = achar(painel, "preco_ate_minimo") as AlavancaPronta;
    expect(a).toBeDefined();
    expect(a.precoAlvoCentavos).toBe(4050);
    expect(a.quem).toBe("gerente");
    expect(a.podePropor).toBe(true);
    const depois = simularNoPreco(p, 4050);
    if (depois.estado !== "ok") throw new Error("x");
    expect(a.ganhoCentavos).toBe(depois.lucroCentavos - s.lucroCentavos);
    expect(a.lucroDepoisCentavos).toBe(depois.lucroCentavos);
    expect(a.ganhoPontos).toBeCloseTo(depois.lucroPct - s.lucroPct, 10);
  });

  it("acima do mínimo recomendado não há alavanca de preço, mesmo abaixo de três vezes o custo real", () => {
    const { painel } = monta({}, 7000);
    expect(achar(painel, "preco_ate_minimo")).toBeUndefined();
    expect(painel.prontas.map((a) => a.codigo)).not.toContain("preco_ate_regra_de_tres");
    expect(painel.prontas.some((a) => a.codigo === "preco_ate_minimo")).toBe(false);
  });

  it("no preço da regra de três ou acima dela não há alavanca de preço", () => {
    const { painel } = monta({}, 9500);
    expect(achar(painel, "preco_ate_minimo")).toBeUndefined();
  });

  it("sem mínimo recomendado, não há alavanca de preço", () => {
    const { painel } = monta({ real: real({ preco_minimo_recomendado: null, tres_x_material: null, multiplicador_regra_de_tres: null }) }, 7000);
    expect(achar(painel, "preco_ate_minimo")).toBeUndefined();
  });
});

describe("alavanca de ocupação", () => {
  it("de 50 para 60 e para 70: o custo de conversão cai pela relação exata da migração", () => {
    const { s, painel } = monta({}, 7000);
    // base = custo_ocupacao x o / (100 - o) = 1,5 em 50 por cento
    const a60 = achar(painel, "ocupacao_60") as AlavancaPronta;
    const a70 = achar(painel, "ocupacao_70") as AlavancaPronta;
    expect(a60.ganhoCentavos).toBe(Math.floor(1.5 * (2 - 100 / 60) * 100 + 1e-9));
    expect(a70.ganhoCentavos).toBe(Math.floor(1.5 * (2 - 100 / 70) * 100 + 1e-9));
    expect(a70.ganhoCentavos).toBeGreaterThan(a60.ganhoCentavos);
    expect(a60.lucroDepoisCentavos).toBe(s.lucroCentavos + a60.ganhoCentavos);
    expect(a60.ganhoPontos).toBeCloseTo((a60.ganhoCentavos / 7000) * 100, 10);
    expect(a60.quem).toBe("dono");
    expect(a60.podePropor).toBe(false);
    expect(a60.cautela).toContain("decisão de vendas e agenda");
    expect(a60.cautela).toContain("não um botão");
  });

  it("ocupação 100 não divide por zero e vira sem dado", () => {
    const { painel } = monta({ real: real({ ocupacao_alvo_pct: 100, custo_ocupacao: 0 }) }, 7000);
    expect(achar(painel, "ocupacao_60")).toBeUndefined();
    const sem = painel.semDado.find((a) => a.codigo === "ocupacao_60");
    expect(sem?.frase).toContain("100 por cento");
    for (const a of painel.prontas) {
      expect(Number.isFinite(a.ganhoCentavos)).toBe(true);
      expect(Number.isFinite(a.ganhoPontos)).toBe(true);
    }
  });

  it("ocupação 100 com custo de ocupação preenchido por engano também não quebra", () => {
    const { painel } = monta({ real: real({ ocupacao_alvo_pct: 100, custo_ocupacao: 3 }) }, 7000);
    expect(painel.semDado.some((a) => a.codigo === "ocupacao_60")).toBe(true);
  });

  it("já em 65 só a de 70 cabe, e em 70 ou mais não sobra nenhuma", () => {
    const em65 = monta({ real: real({ ocupacao_alvo_pct: 65, custo_ocupacao: 1 }) }, 7000).painel;
    expect(achar(em65, "ocupacao_60")).toBeUndefined();
    expect(achar(em65, "ocupacao_70")).toBeDefined();
    const em70 = monta({ real: real({ ocupacao_alvo_pct: 70, custo_ocupacao: 1 }) }, 7000).painel;
    expect(achar(em70, "ocupacao_70")).toBeUndefined();
    expect(em70.semDado.find((a) => a.codigo === "ocupacao_60")?.frase).toContain("Não há 60 nem 70");
  });

  it("sem ocupação lida ou sem custo de ocupação, diz o que falta", () => {
    const a = monta({ real: real({ ocupacao_alvo_pct: null }) }, 7000).painel;
    expect(a.semDado.find((x) => x.codigo === "ocupacao_60")?.frase).toContain("não tem ocupação alvo para medir");
    const b = monta({ real: real({ custo_ocupacao: null }) }, 7000).painel;
    expect(b.semDado.some((x) => x.codigo === "ocupacao_60")).toBe(true);
  });

  it("produto sem horas sujeitas à ocupação, como serviço, não ganha alavanca", () => {
    const { painel } = monta({ real: real({ custo_ocupacao: 0 }) }, 7000);
    expect(achar(painel, "ocupacao_60")).toBeUndefined();
    expect(painel.semDado.find((x) => x.codigo === "ocupacao_60")?.frase).toContain("não tem horas");
  });
});

describe("alavanca de perda e falha", () => {
  it("deduz a porcentagem do material com perda e mede um ponto a menos", () => {
    const { s, painel } = monta({}, 7000);
    const a = achar(painel, "perda_e_falha") as AlavancaPronta;
    expect(a).toBeDefined();
    // material 12 e material com perda 12,80 dão 6,25 por cento. Com 5,25 por cento o custo da perda cai
    const perdas = 12.8 - 12;
    const novas = 12 / (1 - 0.0525) - 12;
    expect(a.ganhoCentavos).toBe(Math.floor((perdas - novas) * 100 + 1e-9));
    expect(a.lucroDepoisCentavos).toBe(s.lucroCentavos + a.ganhoCentavos);
    expect(a.quem).toBe("producao");
    expect(a.cautela).toContain("não do cadastro");
  });

  it("perda menor que um ponto desce só até zero", () => {
    const { painel } = monta({ real: real({ tres_x_material: 36.3 }) }, 7000);
    const a = achar(painel, "perda_e_falha") as AlavancaPronta;
    // 12,10 de material com perda dão 0,83 por cento. O passo é de 0,83, não de 1, e a perda vai a zero
    expect(a.titulo).toContain("0,8 ponto");
    expect(a.ganhoCentavos).toBe(10);
  });

  it("sem perda, sem multiplicador ou sem material, mostra o que falta", () => {
    const zero = monta({ real: real({ tres_x_material: 36 }) }, 7000).painel;
    expect(zero.semDado.find((x) => x.codigo === "perda_e_falha")?.frase).toContain("em zero");
    const semMult = monta({ real: real({ multiplicador_regra_de_tres: null }) }, 7000).painel;
    expect(semMult.semDado.find((x) => x.codigo === "perda_e_falha")?.frase).toContain("Falta o material com perda");
    const semMat = monta({ composicao: { material: 0, maquina: 5, maoDeObra: 4, indireto: 3 } }, 7000).painel;
    expect(semMat.semDado.find((x) => x.codigo === "perda_e_falha")?.frase).toContain("Falta o custo de material");
  });
});

describe("alavanca do parceiro", () => {
  const abaixo = { real: real({ parceiro_abaixo_do_piso: true }), preco_parceiro: 40 };

  it("só aparece quando o parceiro está abaixo do piso líquido", () => {
    expect(achar(monta({}, 7000).painel, "preco_do_parceiro")).toBeUndefined();
    expect(monta({}, 7000).painel.semDado.some((x) => x.codigo === "preco_do_parceiro")).toBe(false);
  });

  it("sobe até o piso líquido, o custo real dividido por 1 menos a margem mínima", () => {
    const { p, painel } = monta(abaixo, 7000);
    const a = achar(painel, "preco_do_parceiro") as AlavancaPronta;
    expect(a).toBeDefined();
    const piso = Math.ceil(Math.round((30.86 / 0.7) * 1e6) / 1e4);
    expect(a.precoAlvoCentavos).toBe(piso);
    const antes = simularNoPreco(p, 4000);
    const depois = simularNoPreco(p, piso);
    if (antes.estado !== "ok" || depois.estado !== "ok") throw new Error("x");
    expect(a.ganhoCentavos).toBe(depois.lucroCentavos - antes.lucroCentavos);
    expect(a.quem).toBe("gerente");
    expect(a.podePropor).toBe(false);
    expect(a.cautela).toContain("só trata o preço do balcão");
  });

  it("margem mínima vazia ou zero vale 30, como no banco", () => {
    const a = achar(monta({ ...abaixo, margem_minima: null }, 7000).painel, "preco_do_parceiro") as AlavancaPronta;
    const b = achar(monta({ ...abaixo, margem_minima: 0 }, 7000).painel, "preco_do_parceiro") as AlavancaPronta;
    expect(a.precoAlvoCentavos).toBe(b.precoAlvoCentavos);
  });

  it("não passa do balcão simulado e avisa que o balcão também precisa subir", () => {
    const { painel } = monta(abaixo, 4400);
    const a = achar(painel, "preco_do_parceiro") as AlavancaPronta;
    expect(a.precoAlvoCentavos).toBe(4400);
    expect(a.frase).toContain("O balcão também precisa subir");
  });

  it("parceiro já no balcão não tem ganho a medir", () => {
    const { painel } = monta({ ...abaixo, preco_parceiro: 44 }, 4400);
    expect(achar(painel, "preco_do_parceiro")).toBeUndefined();
    expect(painel.semDado.find((x) => x.codigo === "preco_do_parceiro")?.frase).toContain("não pode passar do balcão");
  });

  it("sem preço de parceiro ou sem custo real diz o que falta, e quem não vê custo não recebe", () => {
    const sem = monta({ real: real({ parceiro_abaixo_do_piso: true }), preco_parceiro: null }, 7000).painel;
    expect(sem.semDado.find((x) => x.codigo === "preco_do_parceiro")?.frase).toContain("Falta o preço do parceiro");
    const l = linha(abaixo);
    const p = prepararSimulador(l) as SimuladorPronto;
    const s = simularNoPreco(p, 7000) as Simulacao;
    const semCusto = alavancasDeLucro(l, p, s, { podeVerCusto: false });
    expect(semCusto.prontas.some((a) => a.codigo === "preco_do_parceiro")).toBe(false);
    expect(semCusto.semDado.some((a) => a.codigo === "preco_do_parceiro")).toBe(false);
  });
});

describe("ordem, filtros e soma", () => {
  it("ordena do maior ganho para o menor, e todos os ganhos são positivos", () => {
    const { painel } = monta({ real: real({ parceiro_abaixo_do_piso: true }), preco_parceiro: 40 }, 3500);
    const ganhos = painel.prontas.map((a) => a.ganhoCentavos);
    expect(ganhos.length).toBeGreaterThanOrEqual(3);
    expect([...ganhos].sort((a, b) => b - a)).toEqual(ganhos);
    expect(ganhos.every((g) => g > 0)).toBe(true);
  });

  it("empate de ganho segue a ordem fixa, preço antes de ocupação", () => {
    const r = ordenarAlavancas([
      { codigo: "ocupacao_60", ganhoCentavos: 10 },
      { codigo: "preco_ate_minimo", ganhoCentavos: 10 },
      { codigo: "perda_e_falha", ganhoCentavos: 10 },
    ]);
    expect(r.map((x) => x.codigo)).toEqual(["preco_ate_minimo", "ocupacao_60", "perda_e_falha"]);
  });

  it("filtra por quem decide", () => {
    const { painel } = monta({}, 3500);
    expect(filtrarAlavancas(painel.prontas, "todas")).toHaveLength(painel.prontas.length);
    expect(filtrarAlavancas(painel.prontas, "dono").every((a) => a.quem === "dono")).toBe(true);
    expect(filtrarAlavancas(painel.prontas, "gerente").every((a) => a.codigo.startsWith("preco"))).toBe(true);
    expect(filtrarAlavancas(painel.prontas, "producao")).toHaveLength(1);
  });

  it("a soma do balcão é preço mais a maior ocupação mais a perda e falha, sem contar 60 e 70 juntas", () => {
    const { painel } = monta({}, 3500);
    const g = (c: string) => (achar(painel, c) as AlavancaPronta).ganhoCentavos;
    expect(painel.somaDoBalcaoCentavos).toBe(g("preco_ate_minimo") + g("ocupacao_70") + g("perda_e_falha"));
  });

  it("a soma bate com o lucro calculado de uma vez: preço e custo se somam sem contar duas vezes", () => {
    const { l, p, s, painel } = monta({}, 3500);
    const todas = (c: string) => (achar(painel, c) as AlavancaPronta).ganhoCentavos;
    // o preço novo no mesmo custo, mais as duas reduções de custo, dão o lucro das três juntas
    const alvo = simularNoPreco(p, 4050);
    if (alvo.estado !== "ok") throw new Error("x");
    const juntas = alvo.lucroCentavos + todas("ocupacao_70") + todas("perda_e_falha");
    expect(juntas - s.lucroCentavos).toBe(painel.somaDoBalcaoCentavos);
    expect(l.nome).toBe("Lona 440g");
  });

  it("com menos de duas alavancas do balcão não há soma", () => {
    const { painel } = monta({ real: real({ ocupacao_alvo_pct: 100, custo_ocupacao: 0, tres_x_material: 36 }) }, 7000);
    expect(painel.somaDoBalcaoCentavos).toBeNull();
  });
});

describe("selo, textos e produtos sem composição", () => {
  it("repete os motivos de custo incompleto", () => {
    const { painel } = monta({ real: real({ custo_incompleto: true, sem_tinta: true }) }, 7000);
    expect(painel.custoIncompleto.length).toBeGreaterThan(0);
    expect(monta({}, 7000).painel.custoIncompleto).toEqual([]);
  });

  it("produto sem composição não monta o simulador, então não há painel para quebrar", () => {
    const p = prepararSimulador(linha({ composicao: null }));
    expect(p.estado).toBe("sem_dado");
  });

  it("nenhuma alavanca com número: a frase do alto manda ver o que falta", () => {
    const { painel } = monta(
      { real: real({ ocupacao_alvo_pct: null, tres_x_material: null, multiplicador_regra_de_tres: null, preco_minimo_recomendado: null }), preco: 400 },
      40000,
    );
    expect(painel.prontas).toHaveLength(0);
    expect(fraseDoAltoDoPainel(painel)).toContain("Nenhuma alavanca com número");
    expect(painel.semDado.length).toBeGreaterThan(0);
  });

  it("os textos não têm parênteses, travessão nem seta, e dizem a quem cabe", () => {
    const { painel } = monta({ real: real({ parceiro_abaixo_do_piso: true, custo_incompleto: true }), preco_parceiro: 40 }, 3500);
    for (const a of painel.prontas) {
      for (const t of [a.titulo, a.frase, a.cautela, textoDoGanho(a)]) expect(t).not.toMatch(SEM_PONTUACAO);
    }
    for (const a of painel.semDado) {
      expect(a.frase).not.toMatch(SEM_PONTUACAO);
      expect(a.titulo).not.toMatch(SEM_PONTUACAO);
    }
    for (const t of Object.values(ROTULO_DE_QUEM)) expect(t).not.toMatch(SEM_PONTUACAO);
    expect(ROTULO_DE_QUEM.gerente).toContain("Gerente");
    expect(ROTULO_DE_QUEM.dono).toContain("Dono");
  });
});
