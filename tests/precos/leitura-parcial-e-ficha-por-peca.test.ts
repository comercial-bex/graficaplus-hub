import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  avisosDeLeitura,
  estadoDoContador,
  textoDoContador,
  type ChaveDeLeitura,
  type EstadoDaConsulta,
} from "../../src/domain/precos/leitura-da-tabela";
import {
  avisosDeLeituraParcial,
  fraseDoMaterialPorPeca,
  idDoProdutoDaPendencia,
  nomeDoProdutoDaPendencia,
  type LinhaDePreco,
} from "../../src/domain/precos/painel-de-precos";
import { prepararSimulador } from "../../src/domain/precos/simulador-de-preco";
import { lerCustoReal } from "../../src/domain/precos/custo-real";

/**
 * Onda B de 17/11: a Tabela de preços e o painel de Preços por produto nunca deixam uma falha de leitura
 * parecer lista vazia, contadores em carregamento mostram reticências, o simulador conhece a ficha por peça
 * e o aviso dos preços de parceiro abaixo do piso leva à ficha do produto.
 */

const SEM_PONTUACAO = /[()—–→←]/;
const ok: EstadoDaConsulta = { isLoading: false, isError: false };
const carregando: EstadoDaConsulta = { isLoading: true, isError: false };
const falhou = (m = "falhou"): EstadoDaConsulta => ({ isLoading: false, isError: true, error: new Error(m) });
const todas = (o: Partial<Record<ChaveDeLeitura, EstadoDaConsulta>> = {}): Record<ChaveDeLeitura, EstadoDaConsulta> => ({
  niveis: ok,
  ofertas: ok,
  concorrentes: ok,
  maoDeObra: ok,
  familias: ok,
  composicoes: ok,
  receitas: ok,
  ...o,
});
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

describe("Tabela de preços: um aviso por consulta que falhou", () => {
  it("sem falha, nenhum aviso", () => {
    expect(avisosDeLeitura(todas(), msg)).toEqual([]);
  });
  it("as duas consultas que antes ficavam de fora, famílias e mão de obra, agora avisam", () => {
    const a = avisosDeLeitura(todas({ familias: falhou("sem familia"), maoDeObra: falhou("sem mao") }), msg);
    expect(a.map((x) => x.chave)).toEqual(["maoDeObra", "familias"]);
    expect(a[0].texto).toContain("sem mao");
    expect(a[1].texto).toContain("busca por família");
  });
  it("cada consulta que falha vira o seu aviso, e as que não falharam ficam quietas", () => {
    const a = avisosDeLeitura(todas({ niveis: falhou(), ofertas: falhou(), concorrentes: falhou(), composicoes: falhou(), receitas: falhou() }), msg);
    expect(a).toHaveLength(5);
    expect(new Set(a.map((x) => x.chave)).size).toBe(5);
  });
  it("carregando não é falha", () => {
    expect(avisosDeLeitura(todas({ familias: carregando }), msg)).toEqual([]);
  });
  it("os textos não usam parênteses, travessão nem seta", () => {
    const a = avisosDeLeitura(
      todas({ niveis: falhou(), ofertas: falhou(), concorrentes: falhou(), maoDeObra: falhou(), familias: falhou(), composicoes: falhou(), receitas: falhou() }),
      msg,
    );
    for (const x of a) expect(x.texto).not.toMatch(SEM_PONTUACAO);
  });
});

describe("contadores e selos em carregamento", () => {
  it("reticências enquanto chega, traço se falhou, número só quando é confiável", () => {
    expect(estadoDoContador([ok, carregando])).toBe("carregando");
    expect(estadoDoContador([falhou(), ok])).toBe("indisponivel");
    expect(estadoDoContador([ok, ok])).toBe("pronto");
    expect(textoDoContador("carregando", 12)).toBe("…");
    expect(textoDoContador("indisponivel", 12)).toBe("—");
    expect(textoDoContador("pronto", 12)).toBe("12");
    expect(textoDoContador("pronto", 0)).toBe("0");
  });
  it("carregando vence falha: o número não aparece enquanto algo ainda chega", () => {
    expect(estadoDoContador([falhou(), carregando])).toBe("carregando");
  });
});

describe("a tela da Tabela de preços usa isso", () => {
  const src = readFileSync("src/routes/_authenticated/tabela-de-precos.tsx", "utf8");
  it("só os produtos seguram a tabela inteira, e os avisos entram na tela", () => {
    expect(src).toMatch(/const erro = produtos\.error;/);
    expect(src).toContain("avisosDeLeitura(");
    expect(src).toContain("estimativaDeMaoDeObra");
    expect(src).toMatch(/maoDeObra: estimativaDeMaoDeObra, familias/);
  });
  it("contadores e selos da ficha passam pelo estado, nunca pelo número cru", () => {
    expect(src).toContain("textoDoContador(a.estado, a.n)");
    expect(src).toMatch(/estadoDoContador\(\[composicoes, receitas\]\)/);
    expect(src).toMatch(/estadoDoContador\(\[concorrentes\]\)/);
    expect(src).not.toMatch(/carregando \? "…" : a\.n/);
  });
  it("o cartão do produto recebe o estado da ficha", () => {
    const cartao = readFileSync("src/components/precos/cartao-do-produto.tsx", "utf8");
    expect(cartao).toContain("fichaEstado");
    expect(cartao).toMatch(/fichaEstado === "pronto" \? <SeloDaFicha/);
  });
});

describe("painel de Preços por produto: leitura parcial", () => {
  it("sem falha, nenhuma frase", () => {
    expect(avisosDeLeituraParcial({})).toEqual([]);
  });
  it("cada falha vira a sua frase, em ordem fixa, sem pontuação proibida", () => {
    const todas = avisosDeLeituraParcial({ taxas: true, concorrentes: true, pendencias: true, composicao: true, fichaPorPeca: true });
    expect(todas).toHaveLength(5);
    expect(todas[0]).toContain("itens de custo faltando");
    for (const f of todas) expect(f).not.toMatch(SEM_PONTUACAO);
  });
  it("o servidor marca a falha de cada leitura e devolve a lista de avisos", () => {
    const srv = readFileSync("src/lib/api/precos-por-produto.functions.ts", "utf8");
    expect(srv).toContain("avisosDeLeitura: avisosDeLeituraParcial(falhas)");
    for (const campo of ["falhas.pendencias = true", "falhas.taxas = lidas.falhou", "falhas.concorrentes = lidos.falhou", "falhas.composicao = true", "falhas.fichaPorPeca = porPeca.falhou"])
      expect(srv).toContain(campo);
  });
  it("a tela mostra a lista", () => {
    const tela = readFileSync("src/routes/_authenticated/precos.tsx", "utf8");
    expect(tela).toContain('data-testid="avisos-de-leitura"');
    expect(tela).toContain("painel.data.avisosDeLeitura.map");
  });
});

describe("pendência de parceiro abaixo do piso leva à ficha do produto", () => {
  const id = "1dc26b82-fefa-41a7-92c5-f880668a978f";
  it("lê o id do código parceiro:<uuid> e recusa qualquer outro formato", () => {
    expect(idDoProdutoDaPendencia(`parceiro:${id}`)).toBe(id);
    expect(idDoProdutoDaPendencia(`parceiro:${id.toUpperCase()}`)).toBe(id);
    expect(idDoProdutoDaPendencia("parceiro:123")).toBeNull();
    expect(idDoProdutoDaPendencia(`custo:${id}`)).toBeNull();
    expect(idDoProdutoDaPendencia("")).toBeNull();
  });
  it("extrai o nome do produto do rótulo, mesmo com dois pontos no nome", () => {
    expect(nomeDoProdutoDaPendencia("Preço de parceiro de Lona 440g: margem líquida de menos 20 por cento, o mínimo é 30 por cento")).toBe("Lona 440g");
    expect(nomeDoProdutoDaPendencia("Preço de parceiro de Kit: 3 peças: margem líquida de 28 por cento, o mínimo é 30 por cento")).toBe("Kit: 3 peças");
  });
  it("a tela tem o botão para a ficha, só para quem abre o cadastro", () => {
    const tela = readFileSync("src/routes/_authenticated/precos.tsx", "utf8");
    expect(tela).toContain('to="/produtos/$id"');
    expect(tela).toMatch(/p\.produtoId && podeAbrirFicha/);
    expect(tela).toContain("podeAbrirRota(\"/produtos\", hasPermission)");
  });
});

describe("simulador: ficha por peça com a regra do orçamento", () => {
  const base: Pick<LinhaDePreco, "unidade" | "material_por_peca" | "area_minima_cobrada"> = {
    unidade: "m2",
    material_por_peca: [{ nome: "Bastão + corda para banner", custoPorPeca: 6.5 }],
    area_minima_cobrada: 1,
  };
  it("diz que o material conta por peça e mostra o peso por m² em peça de 1, 2 e meio m²", () => {
    const f = fraseDoMaterialPorPeca(base) ?? "";
    expect(f).toContain("Bastão + corda para banner conta por peça no orçamento, não por m²");
    const t = f.replace(/ /g, " ");
    expect(t).toContain("peça de 1 m², R$ 6,50 por m²");
    expect(t).toContain("peça de 2 m², R$ 3,25 por m²");
    expect(t).toContain("peça de 0,5 m², R$ 13,00 por m²");
    expect(f).not.toMatch(SEM_PONTUACAO);
  });
  it("não diz nada sem linha por peça, sem leitura, ou em produto que não é vendido por m²", () => {
    expect(fraseDoMaterialPorPeca({ ...base, material_por_peca: [] })).toBeNull();
    expect(fraseDoMaterialPorPeca({ ...base, material_por_peca: null })).toBeNull();
    expect(fraseDoMaterialPorPeca({ ...base, material_por_peca: undefined })).toBeNull();
    expect(fraseDoMaterialPorPeca({ ...base, unidade: "un" })).toBeNull();
    expect(fraseDoMaterialPorPeca({ ...base, material_por_peca: [{ nome: "X", custoPorPeca: 0 }] })).toBeNull();
  });
  it("soma dois materiais por peça", () => {
    const f = (fraseDoMaterialPorPeca({ ...base, material_por_peca: [{ nome: "Bastão", custoPorPeca: 4 }, { nome: "Corda", custoPorPeca: 2.5 }] }) ?? "").replace(/ /g, " ");
    expect(f).toContain("Bastão e Corda conta por peça");
    expect(f).toContain("O custo por peça é R$ 6,50");
  });
  const linha = (o: Partial<LinhaDePreco> = {}): LinhaDePreco => ({
    id: "p1",
    nome: "Banner",
    familia: "Banners",
    unidade: "m2",
    custo: 12,
    custo_cheio: 24,
    preco: 110,
    margem_minima: 30,
    preco_parceiro: 55,
    real: { ...lerCustoReal({}), custo_producao: 28.47, custo_real: 30.86, custo_ocupacao: 1.5, preco_minimo_recomendado: 40.5, multiplicador_regra_de_tres: 3 },
    taxas: { impostoVendaPct: 4, taxaCartaoPct: 7.5 },
    composicao: { material: 12, maquina: 5, maoDeObra: 4, indireto: 3 },
    ...o,
  });
  it("o simulador pronto traz o aviso do material por peça, e só quando há", () => {
    const com = prepararSimulador(linha(base));
    if (com.estado !== "pronto") throw new Error("esperava pronto");
    expect(com.avisos.map((a) => a.codigo)).toContain("material_por_peca");
    const sem = prepararSimulador(linha({ material_por_peca: [] }));
    if (sem.estado !== "pronto") throw new Error("esperava pronto");
    expect(sem.avisos.map((a) => a.codigo)).not.toContain("material_por_peca");
  });
  it("o simulador não muda nenhum número por causa da ficha por peça: só explica", () => {
    const com = prepararSimulador(linha(base));
    const sem = prepararSimulador(linha());
    if (com.estado !== "pronto" || sem.estado !== "pronto") throw new Error("esperava pronto");
    expect(com.custos).toEqual(sem.custos);
    expect(com.custoRealCentavos).toBe(sem.custoRealCentavos);
  });
  it("o servidor lê produto_materiais por_peca e a regra vem do banco: por peça conta uma vez por peça", () => {
    const srv = readFileSync("src/lib/api/precos-por-produto.functions.ts", "utf8");
    expect(srv).toContain('.from("produto_materiais")');
    expect(srv).toContain('.eq("por_peca", true)');
    expect(srv).toContain("area_minima_cobrada");
    // A mesma conta do orçamento e da previsão da OS: linha por peça multiplica pelas peças, as outras pela base de consumo.
    const check = readFileSync("src/components/orcamento-material-check.tsx", "utf8");
    expect(check).toContain("m.porPeca ? Math.max(pecas, 1) : baseDeConsumo");
  });
});

describe("migração: aprovar proposta de produto sem preço", () => {
  const sql = readFileSync("supabase/migrations/20261117214000_preco_proposta_aprovar_produto_sem_preco.sql", "utf8");
  const ensaio = readFileSync("docs/ensaio-preco-proposta-aprovar-produto-sem-preco.md", "utf8");
  it("troca a comparação pela definição viva, com âncora única, COALESCE nos dois lados", () => {
    expect(sql).toContain("BEGIN;");
    expect(sql).toMatch(/COMMIT;\s*$/);
    expect(sql).toContain("pg_get_functiondef('public.preco_proposta_aprovar(uuid)'::regprocedure)");
    expect(sql).toContain("v_de   text := 'IF v_prod.preco_base IS DISTINCT FROM v_prop.preco_atual THEN';");
    expect(sql).toContain("COALESCE(v_prod.preco_base, 0) IS DISTINCT FROM COALESCE(v_prop.preco_atual, 0)");
    expect(sql).toContain("IF n <> 1 THEN");
  });
  it("diz como desfazer e não mexe em GRANT nem em dado", () => {
    expect(sql).toContain("Como desfazer");
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP)\b\s+(public\.)?\w/);
    expect(sql).not.toMatch(/^\s*(GRANT|REVOKE)\b/m);
  });
  it("o ensaio termina em RAISE EXCEPTION, não usa WHEN OTHERS e cobre a trava de preço mudado", () => {
    expect(ensaio).toContain("RAISE EXCEPTION 'ENSAIO OK, DESFEITO");
    expect(ensaio).not.toMatch(/EXCEPTION WHEN OTHERS/);
    expect(ensaio).toContain("WHEN SQLSTATE '22023'");
    expect(ensaio).toContain("O preço do produto mudou depois da proposta");
  });
});
