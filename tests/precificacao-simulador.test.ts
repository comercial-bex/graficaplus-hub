import { describe, expect, it } from "vitest";
import {
  alterados,
  comZeroNoQueFalta,
  lerParametros,
  rotuloDoParametro,
  type LinhaDeParametro,
} from "../src/domain/precificacao/parametros";
import {
  custoDoMaterial,
  margemNoPreco,
  maquinaEscolhida,
  materiaisDoProduto,
  precoDaMargemMinima,
  precoDeTabela,
  simular,
  type EntradaDaSimulacao,
} from "../src/domain/precificacao/simulador";

/**
 * O simulador de preço nascia com 45, 8, 25, 35, 12, 5 e margem 50 escritos
 * no código. Estes testes travam o contrário: a conta sai dos parâmetros da
 * casa e do motor de custo do orçamento, e o que falta é dito, não inventado.
 */

// As dez linhas de `custos_tabela` como estavam no banco em 02/10/2026.
const CASA: LinhaDeParametro[] = [
  { id: "1", codigo: "energia_tarifa_kwh", descricao: "Tarifa de energia (com tributos)", unidade: "R$/kWh", valor: "1.1339" },
  { id: "2", codigo: "custo_admin_hora", descricao: "Custo administrativo por hora", unidade: "R$/h", valor: "12.00" },
  { id: "3", codigo: "mo_custo_hora", descricao: "Mão de obra - custo por hora", unidade: "R$/h", valor: "40.00" },
  { id: "4", codigo: "mo_encargos_pct", descricao: "Encargos sobre mão de obra", unidade: "%", valor: "80" },
  { id: "5", codigo: "markup_atacado", descricao: "Markup para atacado", unidade: "%", valor: "35" },
  { id: "6", codigo: "markup_padrao", descricao: "Markup padrão de venda", unidade: "%", valor: "60" },
  { id: "7", codigo: "pct_falha_producao", descricao: "Falha de produção", unidade: "%", valor: "5" },
  { id: "8", codigo: "pct_perda_material", descricao: "Perda média de material (refile)", unidade: "%", valor: "8" },
  { id: "9", codigo: "impostos_venda", descricao: "Impostos sobre venda", unidade: "%", valor: "6" },
  { id: "10", codigo: "taxa_cartao", descricao: "Taxa média de cartão", unidade: "%", valor: "3.5" },
];

const PARAMETROS = comZeroNoQueFalta(lerParametros(CASA).valores);

// "Banner com bastão e corda" como está no catálogo: ficha com 1 m² de lona
// 280g (R$ 9,50) e 1 bastão + corda (R$ 5,00), 40 min na plotter i1600
// (R$ 14,4313/h, 1 kW).
const PLOTTER = maquinaEscolhida({
  id: "plotter",
  nome: "Plotter de Impressão i1600 180 — Eco",
  custo_hora: "14.4313",
  potencia_kw: "1.0",
  setup_min: 0,
});

function banner(extra: Partial<EntradaDaSimulacao> = {}): EntradaDaSimulacao {
  return {
    quantidade: 1,
    materiais: [
      { chave: "a", material_id: "lona", nome: "Lona 280g brilho", unidade: "m2", porUnidade: 1, custoUnitario: 9.5 },
      { chave: "b", material_id: "bastao", nome: "Bastão + corda para banner", unidade: "un", porUnidade: 1, custoUnitario: 5 },
    ],
    maquina: PLOTTER,
    minutosPorUnidade: 40,
    outrosPorUnidade: 0,
    tabela: "varejo",
    pagamento: "media",
    parametros: PARAMETROS,
    ...extra,
  };
}

describe("os parâmetros da casa", () => {
  it("lê os dez parâmetros vivos sem nada faltando", () => {
    const l = lerParametros(CASA);
    expect(l.faltando).toEqual([]);
    expect(l.valores.markup_padrao).toBe(60);
    expect(l.valores.energia_tarifa_kwh).toBeCloseTo(1.1339, 4);
    expect(l.linhas.markup_padrao?.id).toBe("6");
  });

  it("parâmetro que falta vai para `faltando` e não ganha valor inventado", () => {
    const l = lerParametros(CASA.filter((c) => c.codigo !== "markup_padrao"));
    expect(l.faltando).toEqual(["markup_padrao"]);
    expect(l.valores.markup_padrao).toBeUndefined();
    // Na conta ele entra como o que a casa afirma sobre ele: nada.
    expect(comZeroNoQueFalta(l.valores).markup_padrao).toBe(0);
  });

  it("valor ilegível conta como faltando, não como zero", () => {
    const l = lerParametros([...CASA.filter((c) => c.codigo !== "taxa_cartao"), { id: "x", codigo: "taxa_cartao", descricao: null, unidade: "%", valor: "três" }]);
    expect(l.faltando).toEqual(["taxa_cartao"]);
  });

  it("ignora linha de custos_tabela que o simulador não usa", () => {
    const l = lerParametros([...CASA, { id: "y", codigo: "aluguel_mes", descricao: "Aluguel", unidade: "R$", valor: "2500" }]);
    expect(Object.keys(l.valores)).toHaveLength(10);
  });

  it("diz exatamente o que a simulação mudou", () => {
    const casa = lerParametros(CASA).valores;
    expect(alterados(casa, casa)).toEqual([]);
    expect(alterados(casa, { ...casa, markup_padrao: 65 })).toEqual(["markup_padrao"]);
    // Ruído abaixo da quarta casa não é decisão de mudar a tarifa.
    expect(alterados(casa, { ...casa, energia_tarifa_kwh: 1.13390001 })).toEqual([]);
  });

  it("mostra a descrição que o admin vê na tela de parâmetros", () => {
    const l = lerParametros(CASA);
    expect(rotuloDoParametro("markup_padrao", l.linhas.markup_padrao)).toBe("Markup padrão de venda");
    expect(rotuloDoParametro("markup_padrao", null)).toBe("Markup de varejo");
  });
});

describe("a conta do banner com os números da casa", () => {
  const r = simular(banner());

  it("material leva perda + falha (13%) como no orçamento: 1 ÷ 0,87", () => {
    expect(r.perdaPct).toBeCloseTo(0.13, 6);
    // lona 9,50 / 0,87 = 10,92 ; bastão 5,00 / 0,87 = 5,75
    expect(r.calculo.materiais[0].custo).toBeCloseTo(10.92, 2);
    expect(r.calculo.materiais[1].custo).toBeCloseTo(5.75, 2);
    expect(r.calculo.custoMateriais).toBeCloseTo(16.67, 2);
  });

  it("máquina = horas × custo/hora + energia da tarifa da casa", () => {
    // 2/3 h × 14,4313 = 9,62 ; 2/3 h × 1 kW × 1,1339 = 0,76
    expect(r.calculo.custoProcessos).toBeCloseTo(10.38, 2);
  });

  it("mão de obra usa os encargos da casa pela régua de encargos.ts", () => {
    expect(r.maoDeObraHora).toBe(72); // 40 + 80%
    expect(r.calculo.custoMaoDeObra).toBeCloseTo(48, 2); // 2/3 h × 72
  });

  it("rateio administrativo por hora, como no custo cheio do produto", () => {
    expect(r.rateioAdministrativo).toBeCloseTo(8, 2); // 2/3 h × 12
  });

  it("preço sugerido = custo × (1 + markup de varejo)", () => {
    expect(r.calculo.custoTotal).toBeCloseTo(83.05, 2);
    expect(r.markupPct).toBeCloseTo(0.6, 6);
    expect(r.calculo.precoFinal).toBeCloseTo(83.05 * 1.6, 0);
  });

  it("taxas da média da casa: imposto + metade do cartão, sobre o preço", () => {
    expect(r.taxasVendaPct).toBeCloseTo(0.0775, 6);
    expect(r.calculo.taxasVenda).toBeCloseTo(r.calculo.precoFinal * 0.0775, 2);
    // margem líquida no preço sugerido: (1,6 − 1 − 0,124) / 1,6 ≈ 29,7%
    expect(r.calculo.margemPct).toBeCloseTo(0.297, 2);
  });

  it("não tem aviso quando a peça está completa", () => {
    expect(r.avisos).toEqual([]);
  });

  it("o preço de tabela de hoje (R$ 110) deixa 16,7% — abaixo dos 40% do cadastro", () => {
    const m = margemNoPreco(110, r.calculo.custoTotal, r.taxasVendaPct);
    expect(m.margemPct).toBeCloseTo(0.1675, 3);
    expect(precoDaMargemMinima(r.calculo.custoTotal, 40, r.taxasVendaPct)).toBeCloseTo(158.95, 1);
  });
});

describe("o que muda a conta", () => {
  it("atacado usa o markup de atacado da casa", () => {
    const r = simular(banner({ tabela: "atacado" }));
    expect(r.markupPct).toBeCloseTo(0.35, 6);
    expect(r.calculo.precoFinal).toBeCloseTo(r.calculo.custoTotal * 1.35, 0);
  });

  it("PIX não paga cartão; cartão paga a taxa inteira", () => {
    expect(simular(banner({ pagamento: "pix" })).taxasVendaPct).toBeCloseTo(0.06, 6);
    expect(simular(banner({ pagamento: "cartao" })).taxasVendaPct).toBeCloseTo(0.095, 6);
  });

  it("mudar o parâmetro na simulação muda o preço — e só a simulação sabe disso", () => {
    const casa = lerParametros(CASA).valores;
    const simulacao = { ...PARAMETROS, markup_padrao: 80 };
    const r = simular(banner({ parametros: simulacao }));
    expect(r.calculo.precoFinal).toBeCloseTo(r.calculo.custoTotal * 1.8, 0);
    expect(alterados(casa, simulacao)).toEqual(["markup_padrao"]);
  });

  it("quantidade multiplica consumo e horas", () => {
    const um = simular(banner());
    const dez = simular(banner({ quantidade: 10 }));
    expect(dez.horas).toBeCloseTo(um.horas * 10, 6);
    expect(dez.custoUnitario).toBeCloseTo(um.custoUnitario, 1);
  });

  it("outros custos por unidade entram no custo e levam markup", () => {
    const r = simular(banner({ outrosPorUnidade: 10 }));
    expect(r.outros).toBe(10);
    expect(r.calculo.outrosCustos).toBeCloseTo(18, 2); // 10 + rateio 8
  });
});

describe("o que a conta não tem é dito, não somado como zero", () => {
  it("sem tempo de produção, máquina, gente e rateio ficam fora — com aviso", () => {
    const r = simular(banner({ minutosPorUnidade: 0 }));
    expect(r.calculo.processos).toHaveLength(0);
    expect(r.calculo.maoDeObra).toHaveLength(0);
    expect(r.rateioAdministrativo).toBe(0);
    expect(r.avisos.join(" ")).toMatch(/Sem tempo de produção/);
  });

  it("máquina sem custo por hora entra só com a energia, e a tela é avisada", () => {
    const fiber = maquinaEscolhida({ id: "f", nome: "Fiber 30W", custo_hora: "0", potencia_kw: "0.5", setup_min: 0 });
    const r = simular(banner({ maquina: fiber, minutosPorUnidade: 60 }));
    // 1 h × 0,5 kW × 1,1339
    expect(r.calculo.custoProcessos).toBeCloseTo(0.57, 2);
    expect(r.avisos.join(" ")).toMatch(/Fiber 30W está sem custo por hora/);
  });

  it("material sem custo é nomeado", () => {
    const r = simular(
      banner({
        materiais: [{ chave: "z", material_id: "m", nome: "Ilhós metálico", unidade: "un", porUnidade: 8, custoUnitario: 0 }],
      }),
    );
    expect(r.avisos.join(" ")).toMatch(/Ilhós metálico está sem custo/);
  });

  it("sem quantidade, nada a custear", () => {
    const r = simular(banner({ quantidade: 0 }));
    expect(r.calculo.custoTotal).toBe(0);
    expect(r.avisos.join(" ")).toMatch(/Informe a quantidade/);
  });

  it("casa sem parâmetro nenhum: preço = custo, sem número de reserva", () => {
    const r = simular(banner({ parametros: comZeroNoQueFalta({}) }));
    expect(r.calculo.precoFinal).toBeCloseTo(r.calculo.custoTotal, 2);
    expect(r.calculo.taxasVenda).toBe(0);
  });
});

describe("o produto real", () => {
  const catalogo = [
    { id: "lona", nome: "Lona 280g brilho", unidade: "m2", custo_medio: "9.50", custo_unitario: "9.50" },
    { id: "acr", nome: "Acrilico esp dourado 2mm", unidade: "mt", custo_medio: "0", custo_unitario: "174.18" },
  ];
  let n = 0;
  const chave = () => `k${++n}`;

  it("custo do material: o médio; sem ele, o da última compra", () => {
    expect(custoDoMaterial(catalogo[0])).toBe(9.5);
    expect(custoDoMaterial(catalogo[1])).toBe(174.18);
    expect(custoDoMaterial({ custo_medio: null, custo_unitario: null })).toBe(0);
  });

  it("a ficha técnica manda quando existe", () => {
    const r = materiaisDoProduto({ unidade: "un", custo_medio: "14.50" }, [{ material_id: "lona", quantidade_por_unidade: "1.0" }], catalogo, chave);
    expect(r.origem).toBe("ficha");
    expect(r.linhas[0]).toMatchObject({ nome: "Lona 280g brilho", porUnidade: 1, custoUnitario: 9.5 });
    expect(r.linhas[0].semFicha).toBeFalsy();
  });

  it("sem ficha, o custo digitado no produto — sem perda em cima", () => {
    const r = materiaisDoProduto({ unidade: "un", custo_medio: "55" }, [], catalogo, chave);
    expect(r.origem).toBe("custo_do_produto");
    expect(r.linhas[0].semFicha).toBe(true);
    const s = simular(banner({ materiais: r.linhas, maquina: null, minutosPorUnidade: 60 }));
    expect(s.calculo.custoMateriais).toBe(55);
    // 55 + 1 h × 72 + 1 h × 12
    expect(s.calculo.custoTotal).toBeCloseTo(139, 2);
  });

  it("sem ficha e sem custo, nenhuma linha — zero faria a peça parecer de graça", () => {
    const r = materiaisDoProduto({ unidade: "un", custo_medio: "0" }, [], catalogo, chave);
    expect(r).toEqual({ origem: "nenhuma", linhas: [] });
  });
});

describe("o preço de tabela de hoje", () => {
  const faixas = [
    { id: "f1", quantidade_minima: 50, preco_unitario: 1.2 },
    { id: "f2", quantidade_minima: 100, preco_unitario: 1.0 },
    { id: "velha", quantidade_minima: 10, preco_unitario: 0.5, vigencia_fim: "2026-01-31" },
  ];
  const hoje = new Date("2026-10-02T12:00:00Z");

  it("a faixa alcançada manda", () => {
    expect(precoDeTabela({ preco_base: null, unidade: "un" }, faixas, 50, hoje)).toEqual({ tem: true, unitario: 1.2, origem: "faixa", aPartirDe: 50 });
    expect(precoDeTabela({ preco_base: null, unidade: "un" }, faixas, 150, hoje)).toMatchObject({ unitario: 1.0, aPartirDe: 100 });
  });

  it("faixa vencida não vale", () => {
    const r = precoDeTabela({ preco_base: null, unidade: "un" }, faixas, 20, hoje);
    expect(r).toEqual({ tem: false, motivo: "O produto é vendido por faixa e a menor começa em 50 un." });
  });

  it("sem faixa, o preço base", () => {
    expect(precoDeTabela({ preco_base: "110.00" }, [], 3, hoje)).toEqual({ tem: true, unitario: 110, origem: "preco_base" });
  });

  it("sem nada, diz por quê", () => {
    expect(precoDeTabela({ preco_base: null }, [], 3, hoje)).toEqual({ tem: false, motivo: "O produto não tem preço de tabela cadastrado." });
    expect(precoDeTabela(null, [], 3, hoje).tem).toBe(false);
  });
});
