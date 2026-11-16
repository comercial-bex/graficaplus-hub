import { describe, expect, it } from "vitest";
import {
  avisosDoProduto,
  celulaDoMapa,
  colunaDoMapa,
  diferencaDaRegra,
  faixaDaRegra,
  fraseDaDiferenca,
  lerCustoReal,
  leituraReal,
  mapaDeMargem,
  margemLiquida,
  mensagemDoCustoRealAusente,
  regraDeTres,
  resumoDoMapa,
  vezesOCusto,
  type CustoRealDoProduto,
} from "../../src/domain/precos/custo-real";
import { filtrar, type LinhaDePreco } from "../../src/domain/precos/painel-de-precos";

const real = (o: Partial<CustoRealDoProduto> = {}): CustoRealDoProduto => ({
  ...lerCustoReal({}),
  custo_real: 33.9,
  ...o,
});
const linha = (o: Partial<LinhaDePreco> = {}): LinhaDePreco => ({
  id: "1",
  nome: "Adesivo vinil",
  familia: "Adesivos",
  unidade: "m2",
  custo: 10,
  custo_cheio: 12,
  preco: 55,
  margem_minima: 40,
  preco_parceiro: null,
  real: real({ custo_real: 20.03 }),
  ...o,
});

describe("as contas", () => {
  it("margem líquida é sobre o balcão e usa o custo real", () => {
    expect(margemLiquida(55, 20.03)).toBe(63.6);
    expect(margemLiquida(70, 33.9)).toBe(51.6);
  });
  it("vezes o custo tem uma casa e some sem custo", () => {
    expect(vezesOCusto(55, 20.03)).toBe(2.7);
    expect(vezesOCusto(55, 0)).toBeNull();
    expect(vezesOCusto(55, null)).toBeNull();
    expect(vezesOCusto(null, 20)).toBeNull();
  });
  it("regra de três é três vezes o custo real em centavos", () => {
    expect(regraDeTres(33.9)).toBe(101.7);
    expect(regraDeTres(20.03)).toBe(60.09);
    expect(regraDeTres(0)).toBeNull();
    expect(regraDeTres(null)).toBeNull();
  });
  it("diferença é balcão menos regra", () => {
    expect(diferencaDaRegra(70, 101.7)).toBe(-31.7);
    expect(diferencaDaRegra(110, 101.7)).toBe(8.3);
    expect(diferencaDaRegra(70, null)).toBeNull();
  });
  it("a diferença sai em palavras, sem sinal solto", () => {
    expect(fraseDaDiferenca(-31.7)).toContain("abaixo da regra");
    expect(fraseDaDiferenca(8.3)).toContain("acima da regra");
    expect(fraseDaDiferenca(0)).toBe("Igual à regra de três");
    expect(fraseDaDiferenca(null)).toContain("falta custo real");
    expect(fraseDaDiferenca(-31.7)).not.toMatch(/[-−()]/);
  });
  it("as quatro faixas da regra de três", () => {
    expect(faixaDaRegra(30, 33.9, 101.7)).toBe("abaixo_do_custo");
    expect(faixaDaRegra(70, 33.9, 101.7)).toBe("abaixo_da_regra");
    expect(faixaDaRegra(101, 33.9, 101.7)).toBe("na_regra");
    expect(faixaDaRegra(120, 33.9, 101.7)).toBe("acima");
    expect(faixaDaRegra(70, null, null)).toBe("sem_dado");
  });
  it("leitura usa o preço dado e não o do cadastro", () => {
    const l = linha();
    expect(leituraReal(l, 55).margem).toBe(63.6);
    expect(leituraReal(l, 40).margem).toBe(49.9);
    expect(leituraReal({ ...l, real: null }, 55).semCustoReal).toBe(true);
  });
});

describe("lendo a visão", () => {
  it("texto vira número e falta vira nulo e falso, nunca zero inventado", () => {
    const r = lerCustoReal({ custo_real: "33.9", sem_tinta: true, vezes_o_custo: null });
    expect(r.custo_real).toBe(33.9);
    expect(r.sem_tinta).toBe(true);
    expect(r.vezes_o_custo).toBeNull();
    expect(r.material_sem_custo).toBe(false);
    expect(r.preco_regra_de_tres).toBeNull();
  });
  it("coluna ou visão ausente vira frase humana, permissão negada não", () => {
    expect(
      mensagemDoCustoRealAusente('relation "public.produto_custo_real" does not exist'),
    ).toContain("Avise o suporte");
    expect(
      mensagemDoCustoRealAusente("column produto_custo_real.sem_tinta does not exist"),
    ).not.toBeNull();
    expect(mensagemDoCustoRealAusente("permission denied for view produto_custo_real")).toBeNull();
    expect(mensagemDoCustoRealAusente("timeout")).toBeNull();
  });
});

describe("os avisos", () => {
  const codigos = (l: LinhaDePreco, p: number | null = l.preco) =>
    avisosDoProduto(l, p).map((a) => a.codigo);
  it("produto limpo, sem aviso", () => {
    expect(codigos(linha({ real: real({ custo_real: 20.03 }) }), 60)).toEqual([]);
  });
  it("cada marca da visão vira o aviso do seu código", () => {
    const l = linha({
      real: real({
        custo_real: 20.03,
        sem_tinta: true,
        material_sem_custo: true,
        sem_mao_de_obra: true,
        custo_incompleto: true,
        tempo_presumido: true,
        parceiro_abaixo_do_piso: true,
        velocidade_usada_m2_h: 10,
        velocidade_nominal_m2_h: 14,
      }),
    });
    const c = codigos(l, 60);
    for (const k of [
      "sem_tinta",
      "material_sem_custo",
      "sem_mao_de_obra",
      "custo_incompleto",
      "tempo_presumido",
      "parceiro_abaixo_do_piso_liquido",
      "velocidade_com_margem",
    ])
      expect(c, k).toContain(k);
  });
  it("a velocidade com margem usa as duas velocidades e só aparece quando a usada é menor", () => {
    const f = avisosDoProduto(
      linha({ real: real({ velocidade_usada_m2_h: 10, velocidade_nominal_m2_h: 14 }) }),
      60,
    ).find((a) => a.codigo === "velocidade_com_margem");
    expect(f?.frase).toBe(
      "A máquina faz 14 metros quadrados por hora. O custo é calculado com 10, por margem de segurança. A agenda e a capacidade seguem os 14.",
    );
    expect(
      codigos(
        linha({ real: real({ velocidade_usada_m2_h: 14, velocidade_nominal_m2_h: 14 }) }),
        60,
      ),
    ).not.toContain("velocidade_com_margem");
  });
  it("abaixo do custo é grave e vem primeiro", () => {
    const a = avisosDoProduto(linha({ real: real({ custo_real: 33.9, sem_tinta: true }) }), 30);
    expect(a[0].codigo).toBe("abaixo_do_custo");
    expect(a[0].gravidade).toBe("alta");
  });
  it("parceiro acima do balcão e margem abaixo do mínimo", () => {
    const c = codigos(linha({ preco_parceiro: 70, real: real({ custo_real: 50 }) }), 60);
    expect(c).toContain("parceiro_acima_do_balcao");
    expect(c).toContain("margem_liquida_abaixo_do_minimo");
  });
  it("lona com regra de três acima do mercado de 70 avisa", () => {
    const l = linha({ nome: "Lona 440g", real: real({ custo_real: 33.9 }) });
    const a = avisosDoProduto(l, 70).find((x) => x.codigo === "mercado_local_da_lona");
    expect(a?.frase).toContain("R$");
    expect(a?.frase).toContain("70,00");
    expect(
      codigos(linha({ nome: "Placa PS", real: real({ custo_real: 33.9 }) }), 70),
    ).not.toContain("mercado_local_da_lona");
  });
  it("sem custo real avisa", () => {
    expect(codigos(linha({ real: null }), 60)).toContain("sem_custo_real");
  });
  it("nenhuma frase tem parênteses, travessão ou seta", () => {
    const l = linha({
      nome: "Lona",
      preco_parceiro: 99,
      real: real({
        sem_tinta: true,
        material_sem_custo: true,
        sem_mao_de_obra: true,
        custo_incompleto: true,
        tempo_presumido: true,
        parceiro_abaixo_do_piso: true,
        velocidade_usada_m2_h: 10,
        velocidade_nominal_m2_h: 14,
      }),
    });
    for (const p of [20, 50, 80, 150])
      for (const a of avisosDoProduto(l, p)) expect(a.frase, a.codigo).not.toMatch(/[()—–→←]/);
  });
});

describe("o mapa", () => {
  it("as bordas: 2 vai para a coluna do meio e 3 para a última", () => {
    expect(colunaDoMapa(1.9)).toBe(0);
    expect(colunaDoMapa(2)).toBe(1);
    expect(colunaDoMapa(2.9)).toBe(1);
    expect(colunaDoMapa(3)).toBe(2);
    expect(colunaDoMapa(4.5)).toBe(2);
  });
  it("margem boa e 3 vezes ou mais é a meta, no canto", () => {
    // custo 20, preço 70: margem 71,4, vezes 3,5. Mínimo 40.
    expect(celulaDoMapa({ margem_minima: 40, real: real({ custo_real: 20 }) }, 70)).toEqual({
      margem: 2,
      vezes: 2,
    });
    // margem 20 por cento, abaixo do mínimo, 1,3 vez.
    expect(celulaDoMapa({ margem_minima: 40, real: real({ custo_real: 40 }) }, 50)).toEqual({
      margem: 0,
      vezes: 0,
    });
  });
  it("sem custo real ou sem mínimo, fica fora da grade", () => {
    expect(celulaDoMapa({ margem_minima: 40, real: null }, 50)).toBeNull();
    expect(celulaDoMapa({ margem_minima: null, real: real() }, 50)).toBeNull();
  });
  it("conta por célula, separa os sem dados e escreve o resumo", () => {
    const ls = [
      linha({ preco: 70, real: real({ custo_real: 20 }) }),
      linha({ preco: 70, real: real({ custo_real: 20 }) }),
      linha({ preco: 50, real: real({ custo_real: 40 }) }),
      linha({ real: null }),
    ];
    const m = mapaDeMargem(ls);
    expect(m.celulas[2][2]).toBe(2);
    expect(m.celulas[0][0]).toBe(1);
    expect(m.semDados).toBe(1);
    const r = resumoDoMapa(m);
    expect(r).toContain("2 produtos estão na meta");
    expect(r).toContain("1 produto está abaixo do mínimo");
    expect(r).toContain("1 produto fica de fora");
    expect(r).not.toMatch(/[()—–→←]/);
  });
  it("tocar na célula filtra a lista", () => {
    const ls = [
      linha({ id: "a", preco: 70, real: real({ custo_real: 20 }) }),
      linha({ id: "b", preco: 50, real: real({ custo_real: 40 }) }),
    ];
    const f = (celula: { margem: 0 | 1 | 2; vezes: 0 | 1 | 2 } | null) =>
      filtrar(ls, { familia: null, problema: "todos", busca: "", celula }).map((l) => l.id);
    expect(f({ margem: 2, vezes: 2 })).toEqual(["a"]);
    expect(f({ margem: 0, vezes: 0 })).toEqual(["b"]);
    expect(f(null)).toEqual(["a", "b"]);
  });
});
