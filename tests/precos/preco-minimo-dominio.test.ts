import { describe, expect, it } from "vitest";
import {
  avisosDoProduto,
  lerCustoReal,
  mensagemDoPrecoMinimoAusente,
  type CustoRealDoProduto,
} from "../../src/domain/precos/custo-real";
import {
  contar,
  filtrar,
  ordenar,
  previaDoPreco,
  problemasDaLinha,
  ROTULO_DO_PROBLEMA,
  type LinhaDePreco,
} from "../../src/domain/precos/painel-de-precos";
import {
  diferencaDoMinimo,
  faixaDoMinimo,
  fraseDaDiferencaDoMinimo,
  fraseDaPreviaDoMinimo,
  frasesDoMinimo,
  leituraDoMinimo,
  LEGENDA_DO_MINIMO,
  margemMinimaUsada,
  precoMinimoRecomendado,
  ROTULO_DA_FAIXA_DO_MINIMO,
  taxaSobreAVenda,
  textosDoPrecoMinimo,
  type EntradaDoMinimo,
  type TaxasDeVenda,
} from "../../src/domain/precos/preco-minimo";

/** O formato de reais do pt-BR usa espaço sem quebra entre o R$ e o número. */
const sp = (t: string) => t.replace(/\u00a0/g, " ");

/** Taxas de 7,75 por cento no total: imposto 4 mais metade de um cartão de 7,5. */
const TAXAS: TaxasDeVenda = { impostoVendaPct: 4, taxaCartaoPct: 7.5 };

const entrada = (o: Partial<EntradaDoMinimo> = {}): EntradaDoMinimo => ({
  materialComPerda: 11.92,
  custoProducao: 22.45,
  margemMinimaPct: 40,
  taxas: TAXAS,
  multiplicador: 3,
  ...o,
});

describe("os exemplos de conferência do dono, com ocupação de 50 por cento", () => {
  // Material com perda e falha de 13 por cento, conversão com a ocupação já dentro, margem mínima de 40.
  // Os números do dono vêm arredondados em centavos: a conta pode andar até dois centavos.
  const exemplos = [
    { nome: "Lona 280g", material: 11.92, conversao: 10.53, minimo: 42.98, trava: "piso_custo" },
    { nome: "Lona 440g", material: 23.29, conversao: 10.53, minimo: 69.87, trava: "regra_de_3" },
    { nome: "Vinil branco impresso", material: 10.59, conversao: 10.53, minimo: 40.42, trava: "piso_custo" },
    { nome: "Adesivo transparente", material: 23.91, conversao: 10.53, minimo: 71.73, trava: "regra_de_3" },
    { nome: "Vinil recortado", material: 8.32, conversao: 29.8, minimo: 72.96, trava: "piso_custo" },
  ] as const;

  for (const x of exemplos) {
    it(`${x.nome}: mínimo ${x.minimo} e manda ${x.trava}`, () => {
      const r = precoMinimoRecomendado(
        entrada({ materialComPerda: x.material, custoProducao: x.material + x.conversao }),
      );
      expect(r).not.toBeNull();
      expect(Math.abs((r?.minimo ?? 0) - x.minimo)).toBeLessThanOrEqual(0.02);
      expect(r?.trava).toBe(x.trava);
    });
  }

  it("a regra de três e o piso batem com os dois lados de cada exemplo", () => {
    const lona = precoMinimoRecomendado(entrada());
    expect(lona?.tresXMaterial).toBe(35.76);
    expect(lona?.fatorDoPiso).toBeCloseTo(0.5225, 6);
    expect(Math.abs((lona?.piso ?? 0) - 42.98)).toBeLessThanOrEqual(0.02);
    const lona440 = precoMinimoRecomendado(entrada({ materialComPerda: 23.29, custoProducao: 33.82 }));
    expect(lona440?.tresXMaterial).toBe(69.87);
    expect(lona440?.piso).toBeCloseTo(64.73, 2);
  });

  it("só a soma das taxas importa: imposto 6 mais cartão de 3,5 dá os mesmos 7,75", () => {
    const outra = precoMinimoRecomendado(
      entrada({ taxas: { impostoVendaPct: 6, taxaCartaoPct: 3.5 } }),
    );
    expect(outra?.minimo).toBe(precoMinimoRecomendado(entrada())?.minimo);
  });
});

describe("as regras da fórmula", () => {
  it("empate vai para a regra de três", () => {
    // fator 0,5225: custo 20,9 dá piso 40; material 13,333... dá três vezes 40
    const r = precoMinimoRecomendado(entrada({ materialComPerda: 40 / 3, custoProducao: 20.9 }));
    expect(r?.tresXMaterial).toBe(40);
    expect(r?.piso).toBe(40);
    expect(r?.trava).toBe("regra_de_3");
  });
  it("margem mínima vazia, zero ou nula vale 30, como COALESCE(NULLIF(margem, 0), 30)", () => {
    expect(margemMinimaUsada(null)).toBe(30);
    expect(margemMinimaUsada(0)).toBe(30);
    expect(margemMinimaUsada(undefined)).toBe(30);
    expect(margemMinimaUsada(40)).toBe(40);
    const com30 = precoMinimoRecomendado(entrada({ margemMinimaPct: 30 }));
    expect(precoMinimoRecomendado(entrada({ margemMinimaPct: 0 }))?.piso).toBe(com30?.piso);
    expect(precoMinimoRecomendado(entrada({ margemMinimaPct: null }))?.piso).toBe(com30?.piso);
  });
  it("o multiplicador do cadastro muda a regra de três", () => {
    expect(precoMinimoRecomendado(entrada({ multiplicador: 4 }))?.tresXMaterial).toBe(47.68);
  });
  it("sem material fica só o piso; sem custo de produção fica só a regra; sem nenhum, nulo", () => {
    const soPiso = precoMinimoRecomendado(entrada({ materialComPerda: null }));
    expect(soPiso?.tresXMaterial).toBeNull();
    expect(soPiso?.trava).toBe("piso_custo");
    expect(soPiso?.minimo).toBe(soPiso?.piso);
    const soRegra = precoMinimoRecomendado(entrada({ custoProducao: null }));
    expect(soRegra?.piso).toBeNull();
    expect(soRegra?.trava).toBe("regra_de_3");
    expect(precoMinimoRecomendado(entrada({ materialComPerda: null, custoProducao: null }))).toBeNull();
    expect(precoMinimoRecomendado(entrada({ materialComPerda: 0, custoProducao: 0 }))).toBeNull();
  });
  it("sem taxas lidas não há piso, e a tela não inventa percentual", () => {
    const r = precoMinimoRecomendado(entrada({ taxas: null }));
    expect(r?.piso).toBeNull();
    expect(r?.trava).toBe("regra_de_3");
  });
  it("margem e taxas que comem tudo, fator zero ou negativo, não geram piso", () => {
    expect(precoMinimoRecomendado(entrada({ margemMinimaPct: 95 }))?.piso).toBeNull();
    expect(precoMinimoRecomendado(entrada({ margemMinimaPct: 92.25 }))?.piso).toBeNull();
  });
  it("taxa acima de cem por cento é limitada a 99, como o banco", () => {
    expect(taxaSobreAVenda({ impostoVendaPct: 150, taxaCartaoPct: 0 })).toBe(0.99);
    expect(taxaSobreAVenda({ impostoVendaPct: -5, taxaCartaoPct: 0 })).toBe(0);
    expect(taxaSobreAVenda(null)).toBeNull();
    expect(taxaSobreAVenda(TAXAS)).toBeCloseTo(0.0775, 6);
  });
});

describe("a faixa contra o preço de balcão", () => {
  it("abaixo, no mínimo até dois por cento acima, acima e sem dado", () => {
    expect(faixaDoMinimo(40, 42.98)).toBe("abaixo");
    expect(faixaDoMinimo(42.97, 42.98)).toBe("abaixo");
    expect(faixaDoMinimo(42.98, 42.98)).toBe("no_minimo");
    expect(faixaDoMinimo(43.8, 42.98)).toBe("no_minimo");
    expect(faixaDoMinimo(44, 42.98)).toBe("acima");
    expect(faixaDoMinimo(null, 42.98)).toBe("sem_dado");
    expect(faixaDoMinimo(0, 42.98)).toBe("sem_dado");
    expect(faixaDoMinimo(50, null)).toBe("sem_dado");
  });
  it("a diferença é o balcão menos o mínimo, em centavos", () => {
    expect(diferencaDoMinimo(50, 42.98)).toBe(7.02);
    expect(diferencaDoMinimo(40, 42.98)).toBe(-2.98);
    expect(diferencaDoMinimo(null, 42.98)).toBeNull();
  });
  it("as frases usam palavras, sem sinal solto nem seta", () => {
    expect(fraseDaDiferencaDoMinimo(7.02)).toContain("acima do mínimo");
    expect(fraseDaDiferencaDoMinimo(-2.98)).toContain("abaixo do mínimo");
    expect(fraseDaDiferencaDoMinimo(-2.98)).not.toContain("-");
    expect(fraseDaDiferencaDoMinimo(0)).toBe("Igual ao mínimo");
    expect(fraseDaDiferencaDoMinimo(null)).toContain("falta o mínimo");
  });
  it("os rótulos são os três pedidos", () => {
    expect(ROTULO_DA_FAIXA_DO_MINIMO.abaixo).toBe("Abaixo do mínimo");
    expect(ROTULO_DA_FAIXA_DO_MINIMO.no_minimo).toBe("No mínimo");
    expect(ROTULO_DA_FAIXA_DO_MINIMO.acima).toBe("Acima do mínimo");
    expect(LEGENDA_DO_MINIMO).toHaveLength(3);
  });
});

const real = (o: Partial<CustoRealDoProduto> = {}): CustoRealDoProduto => ({
  ...lerCustoReal({}),
  custo_real: 24.34,
  custo_producao: 22.45,
  preco_minimo_recomendado: 42.98,
  piso_custo_producao: 42.98,
  tres_x_material: 35.76,
  trava_que_manda: "piso_custo",
  ocupacao_alvo_pct: 50,
  multiplicador_regra_de_tres: 3,
  custo_ocupacao: 5.27,
  ...o,
});
const linha = (o: Partial<LinhaDePreco> = {}): LinhaDePreco => ({
  id: "1",
  nome: "Lona 280g",
  familia: "Lonas",
  unidade: "m2",
  custo: 10,
  custo_cheio: 12,
  preco: 55,
  margem_minima: 40,
  preco_parceiro: null,
  real: real(),
  taxas: TAXAS,
  ...o,
});

describe("ler a linha do banco", () => {
  it("lê os sete números novos e transforma a trava desconhecida em nulo", () => {
    const r = lerCustoReal({
      custo_ocupacao: "5.27",
      tres_x_material: "35.76",
      piso_custo_producao: "42.98",
      preco_minimo_recomendado: "42.98",
      trava_que_manda: "piso_custo",
      ocupacao_alvo_pct: "50",
      multiplicador_regra_de_tres: "3",
    });
    expect(r.preco_minimo_recomendado).toBe(42.98);
    expect(r.trava_que_manda).toBe("piso_custo");
    expect(r.ocupacao_alvo_pct).toBe(50);
    expect(lerCustoReal({ trava_que_manda: "outra" }).trava_que_manda).toBeNull();
    expect(lerCustoReal({}).preco_minimo_recomendado).toBeNull();
  });
  it("coluna ausente vira frase humana; permissão negada não", () => {
    expect(
      mensagemDoPrecoMinimoAusente("column produto_custo_real.preco_minimo_recomendado does not exist"),
    ).toContain("Avise o suporte");
    expect(mensagemDoPrecoMinimoAusente("permission denied for view produto_custo_real")).toBeNull();
    expect(mensagemDoPrecoMinimoAusente("timeout")).toBeNull();
  });
});

describe("a leitura do mínimo de um produto", () => {
  it("o banco manda: usa o mínimo e a trava dele", () => {
    const l = leituraDoMinimo(linha(), 55);
    expect(l.minimo).toBe(42.98);
    expect(l.trava).toBe("piso_custo");
    expect(l.faixa).toBe("acima");
    expect(l.diferenca).toBe(12.02);
    expect(l.multiplicador).toBe(3);
    expect(l.materialComPerda).toBe(11.92);
    expect(l.ocupacaoAlvoPct).toBe(50);
  });
  it("a função reproduz o banco com as mesmas entradas, a menos de um centavo", () => {
    const calc = leituraDoMinimo(
      linha({ real: real({ preco_minimo_recomendado: null, piso_custo_producao: null, trava_que_manda: null }) }),
      55,
    );
    expect(Math.abs((calc.minimo ?? 0) - 42.98)).toBeLessThanOrEqual(0.02);
    expect(calc.trava).toBe("piso_custo");
  });
  it("sem o mínimo do banco e sem taxas, sobra a regra de três quando há material", () => {
    const l = leituraDoMinimo(
      linha({ taxas: null, real: real({ preco_minimo_recomendado: null, piso_custo_producao: null, trava_que_manda: null }) }),
      55,
    );
    expect(l.minimo).toBe(35.76);
    expect(l.trava).toBe("regra_de_3");
  });
  it("sem nada, não há mínimo e a faixa é sem dado", () => {
    const l = leituraDoMinimo(linha({ real: null }), 55);
    expect(l.semMinimo).toBe(true);
    expect(l.minimo).toBeNull();
    expect(l.trava).toBeNull();
    expect(l.faixa).toBe("sem_dado");
  });
  it("margem mínima zero no cadastro vale 30 na leitura", () => {
    expect(leituraDoMinimo(linha({ margem_minima: 0 }), 55).margemMinimaPct).toBe(30);
  });
  it("o preço digitado muda a diferença e a faixa, não o mínimo", () => {
    const baixo = leituraDoMinimo(linha(), 40);
    const alto = leituraDoMinimo(linha(), 80);
    expect(baixo.minimo).toBe(alto.minimo);
    expect(baixo.faixa).toBe("abaixo");
    expect(alto.faixa).toBe("acima");
  });
});

describe("as frases do tooltip por produto", () => {
  it("dizem qual trava manda, os dois valores em frase e a ocupação", () => {
    const f = frasesDoMinimo(leituraDoMinimo(linha(), 55));
    const t = f.join(" ");
    expect(t).toContain("Hoje manda o piso do custo de produção");
    expect(t).toContain("A regra de três dá");
    expect(t).toContain("35,76");
    expect(t).toContain("3 vezes o material com perda e falha");
    expect(t).toContain("O piso do custo de produção dá");
    expect(t).toContain("42,98");
    expect(t).toContain("margem mínima de 40 por cento");
    expect(t).toContain("imposto sobre a venda de 4 por cento");
    expect(t).toContain("metade da taxa do cartão, 3,75 por cento");
    expect(t).toContain("ocupação alvo de 50 por cento");
    expect(t).toContain("Nem a plotter, nem o impressor, nem o aluguel");
  });
  it("quando a regra de três manda, diz isso", () => {
    const l = linha({
      real: real({ preco_minimo_recomendado: 69.87, tres_x_material: 69.87, piso_custo_producao: 64.73, trava_que_manda: "regra_de_3" }),
    });
    expect(frasesDoMinimo(leituraDoMinimo(l, 80)).join(" ")).toContain("Hoje manda a regra de três");
  });
  it("sem mínimo, explica o que falta em vez de calar", () => {
    expect(frasesDoMinimo(leituraDoMinimo(linha({ real: null }), 55))[0]).toContain(
      "ainda não tem preço mínimo recomendado",
    );
  });
  it("sem material, avisa que a regra de três não entra", () => {
    const l = linha({
      real: real({ tres_x_material: null, preco_minimo_recomendado: 42.98, trava_que_manda: "piso_custo" }),
    });
    expect(frasesDoMinimo(leituraDoMinimo(l, 55)).join(" ")).toContain("A regra de três não entra");
  });
  it("nenhuma frase tem parênteses, travessão ou seta", () => {
    const todas = [
      ...frasesDoMinimo(leituraDoMinimo(linha(), 55)),
      ...frasesDoMinimo(leituraDoMinimo(linha({ real: null }), 55)),
      fraseDaPreviaDoMinimo(leituraDoMinimo(linha(), 40), 40),
      fraseDaPreviaDoMinimo(leituraDoMinimo(linha(), 43), 43),
      fraseDaPreviaDoMinimo(leituraDoMinimo(linha(), 60), 60),
      fraseDaPreviaDoMinimo(leituraDoMinimo(linha({ real: null }), 60), 60),
      ...Object.values(textosDoPrecoMinimo({ ocupacaoAlvoPct: 50, multiplicador: 3 })),
      ...Object.values(textosDoPrecoMinimo(null)),
    ];
    for (const f of todas) expect(f).not.toMatch(/[()—–→←]/);
  });
});

describe("a prévia ao digitar um preço", () => {
  it("diz se o preço digitado está abaixo, no mínimo ou acima, além do piso", () => {
    const l = linha({ preco: 55 });
    const abaixo = previaDoPreco(l, "40");
    expect(abaixo.minimo.faixa).toBe("abaixo");
    expect(sp(fraseDaPreviaDoMinimo(abaixo.minimo, 40))).toBe(
      "Mínimo recomendado R$ 42,98. O preço digitado está R$ 2,98 abaixo do mínimo.",
    );
    expect(previaDoPreco(l, "43").minimo.faixa).toBe("no_minimo");
    const acima = previaDoPreco(l, "60");
    expect(sp(fraseDaPreviaDoMinimo(acima.minimo, 60))).toContain("R$ 17,02 acima do mínimo");
    expect(abaixo.piso).not.toBeNull();
  });
  it("abaixo do mínimo recomendado NÃO bloqueia o pedido nem exige motivo: a aprovação segue como está", () => {
    const l = linha({ custo: 10, margem_minima: 40, preco: 55 });
    const p = previaDoPreco(l, "40");
    expect(p.minimo.faixa).toBe("abaixo");
    expect(p.podePedir).toBe(true);
    expect(p.exigeMotivo).toBe(false);
    expect(p.aviso).toBeNull();
  });
  it("texto digitado inválido cai para o preço atual, sem inventar faixa", () => {
    expect(previaDoPreco(linha({ preco: 55 }), "abc").minimo.faixa).toBe("acima");
  });
  it("sem mínimo, diz que falta custo", () => {
    expect(fraseDaPreviaDoMinimo(leituraDoMinimo(linha({ real: null }), 60), 60)).toContain(
      "Sem mínimo recomendado",
    );
  });
});

describe("o filtro Abaixo do mínimo recomendado", () => {
  const todas = [
    linha({ id: "a", nome: "Abaixo", preco: 40, custo: 5 }),
    linha({ id: "b", nome: "No minimo", preco: 43, custo: 5 }),
    linha({ id: "c", nome: "Acima", preco: 90, custo: 5 }),
    linha({ id: "d", nome: "Sem real", preco: 40, custo: 5, real: null }),
  ];
  it("tem rótulo e conta só quem está abaixo do mínimo", () => {
    expect(ROTULO_DO_PROBLEMA.abaixo_do_minimo).toBe("Abaixo do mínimo recomendado");
    expect(contar(todas).abaixo_do_minimo).toBe(1);
  });
  it("filtra pela faixa e some quando o produto não tem mínimo", () => {
    expect(
      filtrar(todas, { familia: null, problema: "abaixo_do_minimo", busca: "" }).map((l) => l.id),
    ).toEqual(["a"]);
  });
  it("entra na lista de problemas da linha e sobe na ordem de abertura", () => {
    expect(problemasDaLinha(todas[0])).toContain("abaixo_do_minimo");
    expect(problemasDaLinha(todas[2])).not.toContain("abaixo_do_minimo");
    expect(ordenar(todas, "problema")[0].id).toBe("a");
  });
  it("o mapa de margem e a margem líquida seguem como antes", () => {
    const sem = linha({ real: real({ preco_minimo_recomendado: null }) });
    expect(problemasDaLinha(sem)).not.toContain("abaixo_do_minimo");
  });
});

describe("o aviso por produto", () => {
  it("abaixo do mínimo gera aviso de cuidado com a trava e a recomendação", () => {
    const a = avisosDoProduto(linha({ preco: 40 }), 40).find(
      (x) => x.codigo === "abaixo_do_minimo_recomendado",
    );
    expect(a?.gravidade).toBe("media");
    expect(sp(a?.frase ?? "")).toContain("R$ 2,98 abaixo do preço mínimo recomendado de R$ 42,98");
    expect(a?.frase).toContain("o piso do custo de produção");
    expect(a?.frase).not.toMatch(/[()—–→←]/);
  });
  it("acima do mínimo ou sem mínimo, nada a avisar sobre isso", () => {
    expect(
      avisosDoProduto(linha(), 90).some((x) => x.codigo === "abaixo_do_minimo_recomendado"),
    ).toBe(false);
    expect(
      avisosDoProduto(linha({ real: real({ preco_minimo_recomendado: null }), taxas: null }), 40).some(
        (x) => x.codigo === "abaixo_do_minimo_recomendado",
      ),
    ).toBe(false);
  });
});

describe("o texto explicativo da tela", () => {
  it("explica a fórmula, a ocupação com o número de hoje e a diferença entre as duas regras de três", () => {
    const t = textosDoPrecoMinimo({ ocupacaoAlvoPct: 50, multiplicador: 3 });
    expect(t.formula).toContain("maior entre dois valores");
    expect(t.formula).toContain("3 vezes o material com perda e falha");
    expect(t.formula).toContain("piso do custo de produção");
    expect(t.ocupacao).toContain("Nem a plotter, nem o impressor, nem o aluguel trabalham cem por cento do tempo");
    expect(t.ocupacao).toContain("hoje 50 por cento");
    expect(t.ocupacao).toContain("A energia e as perdas não sobem");
    expect(t.nomes).toContain("custo real vezes três");
  });
  it("sem os parâmetros do banco, não inventa a ocupação de hoje", () => {
    const t = textosDoPrecoMinimo(null);
    expect(t.ocupacao).not.toContain("hoje");
    expect(t.formula).toContain("3 vezes");
  });
  it("com outro multiplicador, o texto acompanha", () => {
    expect(textosDoPrecoMinimo({ ocupacaoAlvoPct: 60, multiplicador: 2.5 }).formula).toContain(
      "2,5 vezes",
    );
  });
});
