import { describe, expect, it } from "vitest";
import { calcularTrofeu, ErroDoTrofeu, precoDaArte } from "@/domain/trofeus/conta";
import {
  avisosDeEstoque,
  cotacaoComCusto,
  cotacaoPublica,
  cotarTrofeuComABase,
  montarTaxas,
  necessidadePorMaterial,
  type BaseDaCotacao,
  type EntradaDaCotacao,
} from "@/domain/trofeus/cotacao";
import { ECONOMICO, ID, MODELOS, PADRAO, PREMIUM, baseDoBanco } from "./apoio/trofeus-banco";
import { MATERIAL, REGRAS, REGRAS_DA_ARTE, TAXAS } from "./apoio/trofeus";

/**
 * 22/11/2026. A cotação do troféu junta o cadastro do banco e a conta pura. Estes testes travam: (1) que as linhas
 * do banco viram as MESMAS taxas do fixture da conta (o preço sai igual, ao centavo); (2) a fonte de cada taxa
 * (médio antes do último, consumo medido antes da estimativa); (3) que cadastro incompleto é erro em português; (4) que a
 * resposta do vendedor não carrega nenhum custo.
 */
const entrada = (e: Partial<EntradaDaCotacao> = {}): EntradaDaCotacao => ({
  alturaCm: 18,
  quantidade: 1,
  urgente: false,
  arte: null,
  ...e,
});

const cota = (modelo = ECONOMICO, e: Partial<EntradaDaCotacao> = {}, mexer?: (b: BaseDaCotacao) => void) => {
  const base = baseDoBanco(modelo);
  mexer?.(base);
  return cotarTrofeuComABase(base, entrada({ alturaCm: modelo.alturaDeReferenciaM * 100, ...e }));
};

describe("as linhas do banco viram as taxas da conta", () => {
  it("o preço do banco é o preço do fixture, modelo a modelo e quantidade a quantidade", () => {
    for (const modelo of MODELOS) {
      for (const quantidade of [1, 5, 20, 50]) {
        const doBanco = cota(modelo, { quantidade }).resultado;
        const doFixture = calcularTrofeu({ modelo, alturaM: modelo.alturaDeReferenciaM, quantidade }, TAXAS, REGRAS);
        expect(doBanco, `${modelo.nome} x ${quantidade}`).toEqual(doFixture);
      }
    }
  });

  it("1 troféu: R$ 53,90, R$ 85,90 e R$ 201,90 (os números de 22/11 depois dos dados do dono)", () => {
    expect(MODELOS.map((m) => cota(m).resultado.precoUnitario)).toEqual([53.9, 85.9, 201.9]);
  });

  it("as taxas montadas são as do fixture", () => {
    const { taxas, regras } = montarTaxas(baseDoBanco(PREMIUM));
    expect(taxas.laserHora).toBeCloseTo(TAXAS.laserHora, 6);
    expect(taxas.moHora).toBeCloseTo(TAXAS.moHora, 6);
    expect(taxas.plotterM2).toBeCloseTo(TAXAS.plotterM2, 6);
    expect(taxas.custoMlCola).toBeCloseTo(TAXAS.custoMlCola, 6);
    expect(taxas.velocidadeDeCorteMPorMin).toEqual(TAXAS.velocidadeDeCorteMPorMin);
    expect(regras).toEqual(REGRAS);
  });

  it("a altura vem em centímetros e vira metros sem sujeira de ponto flutuante", () => {
    expect(cota(ECONOMICO, { alturaCm: 18 }).resultado.alturaM).toBe(0.18);
    expect(cota(ECONOMICO, { alturaCm: 22.5 }).resultado.alturaM).toBe(0.225);
    expect(cota(PREMIUM, { alturaCm: 28 }).resultado.alturaM).toBe(0.28);
  });

  it("altura fora do limite e quantidade inválida são frases da conta", () => {
    expect(() => cota(ECONOMICO, { alturaCm: 8 })).toThrow("A altura vai de 12 a 40 cm.");
    expect(() => cota(ECONOMICO, { alturaCm: 18, quantidade: 0 })).toThrow("Informe a quantidade de troféus");
  });
});

describe("de onde vem cada taxa (as mesmas fontes do custo cheio do produto)", () => {
  it("o custo do material é o MÉDIO antes do último preço, como o produto lê", () => {
    const comMedio = cota(PREMIUM, {}, (b) => {
      const d = b.materiais.find((m) => m.id === MATERIAL.dourado2)!;
      d.custo_unitario = 174.18;
      d.custo_medio = 87.09;
    }).resultado;
    // com médio 87,09 o dourado custa menos que a R$ 240 do cadastro de hoje
    expect(comMedio.custo.material).toBeLessThan(cota(PREMIUM).resultado.custo.material);
    const semMedio = cota(PREMIUM, {}, (b) => {
      const d = b.materiais.find((m) => m.id === MATERIAL.dourado2)!;
      d.custo_unitario = 174.18;
      d.custo_medio = null;
    }).resultado;
    // sem médio, vale o último
    expect(semMedio.custo.material).toBeGreaterThan(comMedio.custo.material);
  });

  it("o consumo de tinta medido (custos fixos) vence a estimativa das regras", () => {
    const estimado = cota(ECONOMICO).resultado.custo.decoracao;
    const medido = cota(ECONOMICO, {}, (b) => {
      b.custos = b.custos.map((c) => (c.codigo === "tinta_consumo_ml_m2" ? { ...c, valor: 24 } : c));
    }).resultado.custo.decoracao;
    expect(medido).toBeGreaterThan(estimado);
    const dobro = calcularTrofeu(
      { modelo: ECONOMICO, alturaM: 0.18, quantidade: 1 },
      { ...TAXAS, tintaMlM2: 24 },
      REGRAS,
    ).custo.decoracao;
    expect(medido).toBe(dobro);
  });

  it("a mão de obra é a do setor do laser, e a de maior custo se nenhuma casa", () => {
    const base = baseDoBanco();
    base.maoDeObra = [
      { funcao: "Designer", setor: "Arte", custo_hora: 20, encargos_pct: 0 },
      { funcao: "Acabamento", setor: "Acabamento", custo_hora: 10, encargos_pct: 0.5 },
    ];
    expect(montarTaxas(base).taxas.moHora).toBe(15);
    base.maoDeObra = [
      { funcao: "Designer", setor: "Arte", custo_hora: 20, encargos_pct: 0 },
      { funcao: "Impressor", setor: "Impressão", custo_hora: 10, encargos_pct: 0 },
    ];
    expect(montarTaxas(base).taxas.moHora).toBe(20);
  });

  it("a plotter usa a velocidade de cálculo, não a nominal", () => {
    const base = baseDoBanco();
    const plotter = base.maquinas.find((m) => m.tipo === "plotter_impressao")!;
    const comCalculo = montarTaxas(base).taxas.plotterM2;
    plotter.velocidade_calculo_m2_h = null;
    const nominal = montarTaxas(base).taxas.plotterM2;
    expect(nominal).toBeLessThan(comCalculo);
  });

  it("a cola vira custo por ml pelo rendimento do frasco", () => {
    const base = baseDoBanco();
    (base.regras as { cola_ml_por_frasco: number }).cola_ml_por_frasco = 125;
    expect(montarTaxas(base).taxas.custoMlCola).toBeCloseTo(71.26 / 125, 6);
  });

  it("material que não é vendido em m² não tem custo por m²", () => {
    expect(() =>
      cota(ECONOMICO, {}, (b) => {
        b.materiais.find((m) => m.id === MATERIAL.preto3)!.unidade = "un";
      }),
    ).toThrow('O material de "Base" está sem custo por m² no cadastro. Avise a gerência.');
  });

  it("peça mais grossa que 10 mm é recusada com a frase do laser", () => {
    expect(() =>
      cota(ECONOMICO, {}, (b) => {
        b.pecas[0].espessura_mm = 12;
      }),
    ).toThrow('"Placa principal" tem 12 mm: o laser da casa corta acrílico até 10 mm.');
  });
});

describe("cadastro incompleto é erro em português, nunca preço com número de fábrica", () => {
  const quebra = (mexer: (b: BaseDaCotacao) => void) => () => cota(ECONOMICO, {}, mexer);

  it("sem tarifa de energia", () => {
    expect(quebra((b) => (b.custos = b.custos.filter((c) => c.codigo !== "energia_tarifa_kwh")))).toThrow(
      "Falta a tarifa de energia (kWh) nos custos fixos. Avise a gerência.",
    );
  });
  it("sem laser, ou com dois", () => {
    expect(quebra((b) => (b.maquinas = b.maquinas.filter((m) => m.tipo !== "laser_co2")))).toThrow("Não há laser CO2 ativo");
    expect(
      quebra((b) => {
        b.maquinas.push({ ...b.maquinas[0], nome: "Outro laser" });
      }),
    ).toThrow("Há mais de um laser CO2 ativo");
  });
  it("laser sem custo por hora", () => {
    expect(quebra((b) => (b.maquinas[0].custo_hora = 0))).toThrow("Falta o custo por hora do laser");
  });
  it("sem plotter, ou plotter sem velocidade", () => {
    expect(quebra((b) => (b.maquinas = b.maquinas.filter((m) => m.tipo !== "plotter_impressao")))).toThrow("Não há plotter de impressão ativa");
    expect(
      quebra((b) => {
        const p = b.maquinas.find((m) => m.tipo === "plotter_impressao")!;
        p.velocidade_calculo_m2_h = 0;
        p.velocidade_m2_h = 0;
      }),
    ).toThrow("Falta a velocidade da plotter");
  });
  it("sem mão de obra cadastrada", () => {
    expect(quebra((b) => (b.maoDeObra = []))).toThrow("Não há custo de mão de obra cadastrado");
  });
  it("sem custo administrativo, ocupação, perda ou falha", () => {
    for (const [codigo, frase] of [
      ["custo_admin_hora", "Falta o custo administrativo por hora"],
      ["ocupacao_alvo_pct", "Falta a ocupação alvo"],
      ["pct_perda_material", "Falta a perda de material"],
      ["pct_falha_producao", "Falta a falha de produção"],
      ["impostos_venda", "Faltam os impostos sobre a venda"],
      ["taxa_cartao", "Falta a taxa de cartão"],
    ] as const) {
      expect(quebra((b) => (b.custos = b.custos.filter((c) => c.codigo !== codigo))), codigo).toThrow(frase);
    }
  });
  it("vinil, laminação, tinta ou cola sem custo", () => {
    for (const [id, frase] of [
      [ID.vinil, "O vinil da decoração está sem custo"],
      [ID.laminacao, "A laminação da decoração está sem custo"],
      [ID.tinta, "A tinta está sem custo"],
      [ID.cola, "A cola está sem custo"],
    ] as const) {
      expect(
        quebra((b) => {
          const m = b.materiais.find((x) => x.id === id)!;
          m.custo_unitario = 0;
          m.custo_medio = 0;
        }),
        id,
      ).toThrow(frase);
    }
  });
  it("material do vinil que sumiu do cadastro", () => {
    expect(quebra((b) => (b.materiais = b.materiais.filter((m) => m.id !== ID.vinil)))).toThrow("O vinil da decoração está sem custo");
  });
  it("regras sem faixas, sem velocidade ou com número ilegível", () => {
    expect(quebra((b) => ((b.regras as { faixas: unknown }).faixas = []))).toThrow("Faltam as faixas de quantidade");
    expect(quebra((b) => ((b.regras as { velocidade_de_corte: unknown }).velocidade_de_corte = null))).toThrow("Faltam as velocidades de corte");
    expect(quebra((b) => ((b.regras as { gravacao_min_por_m2: unknown }).gravacao_min_por_m2 = "abc"))).toThrow("Falta o tempo de gravação");
    expect(quebra((b) => ((b.regras as { piso_do_multiplicador: unknown }).piso_do_multiplicador = null))).toThrow("Falta o piso do multiplicador");
  });
  it("modelo sem linha, peça com decoração desconhecida", () => {
    expect(quebra((b) => (b.modelo.linha = "luxo"))).toThrow("está sem linha");
    expect(quebra((b) => (b.pecas[0].decoracao = "serigrafia"))).toThrow("decoração que o troféu não conhece");
  });
  it("todo erro é um ErroDoTrofeu, com a frase pronta para quem usa", () => {
    try {
      cota(ECONOMICO, {}, (b) => (b.maoDeObra = []));
      throw new Error("deveria ter lançado");
    } catch (e) {
      expect(e).toBeInstanceOf(ErroDoTrofeu);
    }
  });
});

describe("a arte entra como linha separada, pela mesma regra da conta", () => {
  it("criação exclusiva de 1 troféu: R$ 220,00; a partir de 20, R$ 110,00", () => {
    expect(cota(ECONOMICO, { arte: { tipo: "criacao_exclusiva", alteracoesExtras: 0, nomesIndividuais: 0 } }).arte?.total).toBe(220);
    expect(cota(ECONOMICO, { quantidade: 20, arte: { tipo: "criacao_exclusiva", alteracoesExtras: 0, nomesIndividuais: 0 } }).arte?.total).toBe(110);
  });
  it("é a mesma conta de precoDaArte com as taxas do fixture", () => {
    const pedido = { tipo: "criacao_exclusiva" as const, alteracoesExtras: 2, nomesIndividuais: 5 };
    const doBanco = cota(ECONOMICO, { quantidade: 10, arte: pedido }).arte;
    const doFixture = precoDaArte({ tipo: pedido.tipo, quantidadeDeTrofeus: 10, alteracoesExtras: 2, nomesIndividuais: 5 }, TAXAS, REGRAS_DA_ARTE);
    expect(doBanco).toEqual(doFixture);
  });
  it("cliente manda a arte pronta ou adaptar o modelo: R$ 0", () => {
    for (const tipo of ["cliente_manda", "adaptar_modelo"] as const) {
      expect(cota(ECONOMICO, { arte: { tipo, alteracoesExtras: 0, nomesIndividuais: 0 } }).arte?.total).toBe(0);
    }
  });
  it("sem arte pedida, não há linha de arte", () => {
    expect(cota(ECONOMICO).arte).toBeNull();
  });
});

describe("os avisos dizem o que ainda é estimativa, em frase e sem número de custo", () => {
  it("o dourado só aparece quando o modelo usa dourado", () => {
    expect(cota(PREMIUM).avisos.join(" ")).toContain("espelhado dourado");
    expect(cota(ECONOMICO).avisos.join(" ")).not.toContain("espelhado dourado");
  });
  it("os avisos da arte só aparecem quando a arte é pedida", () => {
    expect(cota(ECONOMICO).avisos.join(" ")).not.toContain("criação da arte");
    const comArte = cota(ECONOMICO, { arte: { tipo: "criacao_exclusiva", alteracoesExtras: 0, nomesIndividuais: 0 } });
    expect(comArte.avisos.join(" ")).toContain("criação da arte");
  });
  it("laser pesquisado, medidas das imagens e DTF UV por compra externa", () => {
    const texto = cota(ECONOMICO).avisos.join(" ");
    expect(texto).toContain("velocidade de corte do laser foi pesquisada");
    expect(texto).toContain("tempo de gravação a laser foi pesquisado");
    expect(texto).toContain("medidas das peças vêm das imagens");
    expect(texto).toContain("DTF UV");
  });
  it("plotter sem manutenção e cabeçote avisa quando há decoração impressa, e cala quando foram informados", () => {
    expect(cota(ECONOMICO).avisos.join(" ")).toContain("manutenção, a limpeza e o cabeçote da plotter");
    const informado = cota(ECONOMICO, {}, (b) => {
      b.custos = b.custos.map((c) => ({ ...c, valor: c.valor ?? 1 }));
    });
    expect(informado.avisos.join(" ")).not.toContain("cabeçote da plotter");
  });
  it("parâmetro provisório que a tela não conhece vira frase genérica, nunca o nome interno", () => {
    const r = cota(ECONOMICO, {}, (b) => ((b.regras as { provisorios: unknown }).provisorios = ["coisa_nova_do_dono"]));
    expect(r.avisos).toContain("Há um parâmetro do troféu ainda em estimativa.");
    expect(r.avisos.join(" ")).not.toContain("coisa_nova_do_dono");
  });
  it("nenhum aviso carrega número", () => {
    for (const m of MODELOS) {
      const c = cota(m, { arte: { tipo: "criacao_exclusiva", alteracoesExtras: 0, nomesIndividuais: 0 } });
      for (const aviso of c.avisos) expect(aviso, aviso).not.toMatch(/\d/);
    }
  });
});

describe("a resposta do vendedor não tem custo, multiplicador nem margem", () => {
  const PROIBIDAS = ["custo", "multiplicador", "margem", "faixaDe", "precoCalculado", "minutosDe", "corteM", "areaUtil", "pecas"];

  function chaves(v: unknown, saida: string[] = []): string[] {
    if (Array.isArray(v)) v.forEach((x) => chaves(x, saida));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        saida.push(k);
        chaves(x, saida);
      }
    }
    return saida;
  }

  it("só traz preço, arte, total geral e avisos", () => {
    const c = cota(PREMIUM, { quantidade: 5, arte: { tipo: "criacao_exclusiva", alteracoesExtras: 1, nomesIndividuais: 2 } });
    const publica = cotacaoPublica(c);
    const todas = chaves(publica);
    for (const proibida of PROIBIDAS) {
      expect(todas.some((k) => k.toLowerCase().includes(proibida.toLowerCase())), proibida).toBe(false);
    }
    expect(Object.keys(publica).sort()).toEqual(["alturaCm", "arte", "avisos", "modelo", "precoTotal", "precoUnitario", "quantidade", "totalGeral", "urgente"]);
  });

  it("as linhas da arte do vendedor têm descrição e valor, nunca o custo da linha", () => {
    const c = cota(ECONOMICO, { arte: { tipo: "criacao_exclusiva", alteracoesExtras: 1, nomesIndividuais: 0 } });
    expect(c.arte?.linhas[0].custo).toBeGreaterThan(0);
    const publica = cotacaoPublica(c);
    for (const linha of publica.arte!.linhas) expect(Object.keys(linha).sort()).toEqual(["descricao", "valor"]);
    expect(JSON.stringify(publica)).not.toContain("custo");
  });

  it("o total geral é o preço dos troféus mais a arte", () => {
    const c = cota(ECONOMICO, { quantidade: 5, arte: { tipo: "criacao_exclusiva", alteracoesExtras: 0, nomesIndividuais: 0 } });
    const p = cotacaoPublica(c);
    expect(p.precoTotal).toBe(p.precoUnitario * 5);
    expect(p.totalGeral).toBe(Math.round((p.precoTotal + (p.arte?.total ?? 0)) * 100) / 100);
  });

  it("um campo novo na conta NÃO vaza para o vendedor (a lista de campos é explícita)", () => {
    const c = cota(ECONOMICO);
    (c.resultado as unknown as Record<string, unknown>).segredo = 123.456;
    expect(JSON.stringify(cotacaoPublica(c))).not.toContain("segredo");
    expect(JSON.stringify(cotacaoPublica(c))).not.toContain("123.456");
  });

  it("quem vê custo recebe o mesmo e mais a decomposição", () => {
    const c = cota(PREMIUM);
    const com = cotacaoComCusto(c);
    expect(com.precoUnitario).toBe(cotacaoPublica(c).precoUnitario);
    expect(com.custoCheio).toBe(67.25);
    expect(com.multiplicador).toBe(3);
    expect(com.margemLiquidaPct).toBeGreaterThan(40);
    expect(com.custo.material).toBeGreaterThan(0);
  });

  it("a resposta pública não muda quando o custo muda de lugar no objeto de entrada (copia, não referencia)", () => {
    const c = cota(ECONOMICO);
    const p = cotacaoPublica(c);
    p.avisos.push("x");
    expect(c.avisos).not.toContain("x");
  });
});

describe("os três modelos do fixture ainda são os da conta", () => {
  it("padrão e premium cotam na altura de referência", () => {
    expect(cota(PADRAO).resultado.precoUnitario).toBe(85.9);
    expect(cota(PREMIUM).resultado.precoUnitario).toBe(201.9);
  });
});

describe("o multiplicador à mão passa pela cotação", () => {
  it("quem vê custo recebe o multiplicador, se foi à mão, se ficou abaixo do piso e qual é o piso", () => {
    const c = cotarTrofeuComABase(baseDoBanco(ECONOMICO), { alturaCm: 18, quantidade: 1, urgente: false, arte: null, multiplicadorManual: 1.8 });
    const com = cotacaoComCusto(c);
    expect(com).toMatchObject({ multiplicador: 1.8, multiplicadorManual: true, abaixoDoPiso: true, pisoDoMultiplicador: 2.2, precoUnitario: 31.9 });
  });

  it("o vendedor não vê nada disso, mesmo quando a conta foi à mão", () => {
    const c = cotarTrofeuComABase(baseDoBanco(ECONOMICO), { alturaCm: 18, quantidade: 1, urgente: false, arte: null, multiplicadorManual: 1.8 });
    const texto = JSON.stringify(cotacaoPublica(c));
    for (const proibido of ["multiplicador", "abaixoDoPiso", "piso", "1.8"]) expect(texto, proibido).not.toContain(proibido);
  });

  it("o multiplicador à mão fora de ×1 a ×10 é a frase da conta", () => {
    expect(() => cotarTrofeuComABase(baseDoBanco(ECONOMICO), { alturaCm: 18, quantidade: 1, urgente: false, arte: null, multiplicadorManual: 12 })).toThrow(
      "O multiplicador vai de ×1 a ×10.",
    );
  });
});

describe("estoque só avisa (dá para orçar sem a chapa)", () => {
  const comEstoque = (modelo = ECONOMICO, saldo: number | null = 0) => {
    const base = baseDoBanco(modelo);
    for (const m of base.materiais) m.estoque = saldo;
    return base;
  };
  const entrada18 = { alturaCm: 18, quantidade: 1, urgente: false, arte: null, multiplicadorManual: null };

  it("a necessidade é a área de cada material mais a sobra de corte e a falha", () => {
    const n = necessidadePorMaterial(ECONOMICO, 0.18, 1, 13);
    // cristal 2 mm: placa 0,20 × 0,16 = 0,032 m²; preto 3 mm: 2 bases de 0,20 × 0,05 = 0,02 m²; ambos ÷ 0,87
    expect(n.get(MATERIAL.cristal2)).toBeCloseTo(0.032 / 0.87, 6);
    expect(n.get(MATERIAL.preto3)).toBeCloseTo(0.02 / 0.87, 6);
  });

  it("a necessidade cresce com a quantidade e com o quadrado da altura", () => {
    const um = necessidadePorMaterial(ECONOMICO, 0.18, 1, 13).get(MATERIAL.preto3)!;
    expect(necessidadePorMaterial(ECONOMICO, 0.18, 10, 13).get(MATERIAL.preto3)).toBeCloseTo(um * 10, 6);
    expect(necessidadePorMaterial(ECONOMICO, 0.36, 1, 13).get(MATERIAL.preto3)).toBeCloseTo(um * 4, 6);
  });

  it("estoque zero: um aviso por material em falta, com o nome, e o preço sai igual", () => {
    const c = cotarTrofeuComABase(comEstoque(), entrada18);
    const avisos = c.avisos.filter((a) => a.startsWith("Estoque de"));
    expect(avisos).toHaveLength(2);
    expect(avisos.join(" ")).toContain("ACRILICO CRISTAL VIRGEM 2MM");
    expect(avisos.join(" ")).toContain("ACRILICO PRETO VIRGEM 3MM");
    expect(c.resultado.precoUnitario).toBe(53.9);
  });

  it("estoque que cobre o pedido não avisa; estoque que cobre só 1 troféu avisa para 100", () => {
    const sobra = cotarTrofeuComABase(comEstoque(ECONOMICO, 5), entrada18);
    expect(sobra.avisos.some((a) => a.startsWith("Estoque de"))).toBe(false);
    const cem = cotarTrofeuComABase(comEstoque(ECONOMICO, 0.5), { ...entrada18, quantidade: 100 });
    expect(cem.avisos.some((a) => a.startsWith("Estoque de"))).toBe(true);
    const um = cotarTrofeuComABase(comEstoque(ECONOMICO, 0.5), entrada18);
    expect(um.avisos.some((a) => a.startsWith("Estoque de"))).toBe(false);
  });

  it("material sem saldo cadastrado, ou que não é vendido em m², não gera aviso (não se inventa falta)", () => {
    const base = comEstoque(ECONOMICO, null);
    expect(avisosDeEstoque(base, necessidadePorMaterial(ECONOMICO, 0.18, 1, 13))).toEqual([]);
    const outra = comEstoque(ECONOMICO, 0);
    outra.materiais.find((m) => m.id === MATERIAL.preto3)!.unidade = "un";
    expect(avisosDeEstoque(outra, necessidadePorMaterial(ECONOMICO, 0.18, 1, 13)).join(" ")).not.toContain("PRETO");
  });

  it("o aviso não traz quantidade nem valor (só o nome do material) e diz que o orçamento sai normalmente", () => {
    const c = cotarTrofeuComABase(comEstoque(), entrada18);
    for (const a of c.avisos.filter((x) => x.startsWith("Estoque de"))) {
      expect(a).toContain("O orçamento sai normalmente; o gestor precisa repor antes de produzir.");
      // o nome do material tem número ("2MM"); quantidade ou valor em m² ou reais é que não pode aparecer
      expect(a).not.toMatch(/\d+[.,]\d+|R\$|m²/);
    }
  });
});
