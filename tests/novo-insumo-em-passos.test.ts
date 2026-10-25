import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  custoPorUnidade,
  entradaInicial,
  estoqueMinimoDoCheio,
  materialDasRespostas,
  pendenciaDoPassoDoInsumo,
  quantidadePorEmbalagem,
  RESPOSTAS_VAZIAS_DO_INSUMO,
  TIPOS_DE_INSUMO,
  type RespostasDoInsumo,
} from "@/domain/materiais/novo-insumo-em-passos";

const tipo = (c: string) => TIPOS_DE_INSUMO.find((t) => t.chave === c)!;
const base = (parcial: Partial<RespostasDoInsumo>): RespostasDoInsumo => ({
  ...RESPOSTAS_VAZIAS_DO_INSUMO,
  ...parcial,
});

describe("embalagem e custo", () => {
  it("a bobina de 1,6 × 50 m tem 80 m² e o custo sai do que pagou", () => {
    const r = base({
      tipo: tipo("bobina"),
      largura: "1,6",
      comprimento: "50",
      precoDaEmbalagem: "760",
    });
    expect(quantidadePorEmbalagem(r)).toBe(80);
    expect(custoPorUnidade(r)).toBe(9.5);
  });

  it("chapa usa largura × altura", () => {
    const r = base({
      tipo: tipo("chapa"),
      largura: "1.22",
      comprimento: "2.44",
      precoDaEmbalagem: "297,68",
    });
    expect(quantidadePorEmbalagem(r)).toBe(2.977);
    expect(custoPorUnidade(r)).toBeCloseTo(100, 0);
  });

  it("tinta, filamento e peça usam a quantidade por embalagem", () => {
    const r = base({
      tipo: tipo("filamento"),
      quantidadeNaEmbalagem: "1000",
      precoDaEmbalagem: "120",
    });
    expect(quantidadePorEmbalagem(r)).toBe(1000);
    expect(custoPorUnidade(r)).toBe(0.12);
  });

  it("sem preço ou sem medida o custo é zero, não infinito", () => {
    expect(custoPorUnidade(base({ tipo: tipo("bobina"), largura: "1,6", comprimento: "50" }))).toBe(
      0,
    );
    expect(custoPorUnidade(base({ tipo: tipo("bobina"), precoDaEmbalagem: "10" }))).toBe(0);
  });
});

describe("estoque cheio, aviso de compra e entrada", () => {
  it("o mínimo é 15% do estoque cheio", () => {
    expect(estoqueMinimoDoCheio(200)).toBe(30);
    expect(estoqueMinimoDoCheio(80)).toBe(12);
    expect(estoqueMinimoDoCheio(0)).toBe(0);
  });

  it("a entrada é embalagens vezes a medida da embalagem", () => {
    const r = base({
      tipo: tipo("bobina"),
      largura: "1,06",
      comprimento: "50",
      embalagensAgora: "2",
    });
    expect(entradaInicial(r)).toBe(106);
  });
});

describe("passos", () => {
  it("não avança sem tipo, sem material, sem medida ou sem nome", () => {
    expect(pendenciaDoPassoDoInsumo(1, RESPOSTAS_VAZIAS_DO_INSUMO)).toBeTruthy();
    expect(pendenciaDoPassoDoInsumo(2, RESPOSTAS_VAZIAS_DO_INSUMO)).toBeTruthy();
    expect(pendenciaDoPassoDoInsumo(4, base({ tipo: tipo("bobina") }))).toBeTruthy();
    expect(pendenciaDoPassoDoInsumo(6, RESPOSTAS_VAZIAS_DO_INSUMO)).toBeTruthy();
    expect(pendenciaDoPassoDoInsumo(3, RESPOSTAS_VAZIAS_DO_INSUMO)).toBeNull();
  });

  it("dar entrada agora exige o preço pago", () => {
    const r = base({
      tipo: tipo("bobina"),
      largura: "1,6",
      comprimento: "50",
      embalagensAgora: "1",
    });
    expect(pendenciaDoPassoDoInsumo(5, r)).toBeTruthy();
    expect(pendenciaDoPassoDoInsumo(5, { ...r, precoDaEmbalagem: "700" })).toBeNull();
  });

  it("estoque cheio zero ou negativo é recusado, vazio é permitido (o painel cobra)", () => {
    expect(
      pendenciaDoPassoDoInsumo(5, base({ tipo: tipo("bobina"), estoqueCheio: "0" })),
    ).toBeTruthy();
    expect(
      pendenciaDoPassoDoInsumo(5, base({ tipo: tipo("bobina"), estoqueCheio: "" })),
    ).toBeNull();
  });
});

describe("a linha de materiais", () => {
  it("nasce com saldo zero (a entrada vai por RPC) e leva o máximo, o mínimo e a bobina", () => {
    const linha = materialDasRespostas(
      base({
        tipo: tipo("bobina"),
        variante: tipo("bobina").variantes[0],
        nome: " Vinil adesivo branco brilho ",
        fornecedor: "Avery",
        largura: "1,06",
        comprimento: "50",
        precoDaEmbalagem: "503,50",
        estoqueCheio: "530",
      }),
    );
    expect(linha).toMatchObject({
      nome: "Vinil adesivo branco brilho",
      unidade: "m²",
      estoque: 0,
      estoque_maximo: 530,
      estoque_minimo: 79.5,
      fornecedor: "Avery",
      custo_unitario: 9.5,
      largura_bobina_m: 1.06,
      comprimento_bobina_m: 50,
    });
    expect(linha.caracteristicas).toContain("largura 1,06 m");
  });

  it("sem estoque cheio o máximo fica vazio e o mínimo zero", () => {
    const linha = materialDasRespostas(base({ tipo: tipo("peca"), nome: "Ilhós" }));
    expect(linha.estoque_maximo).toBeNull();
    expect(linha.estoque_minimo).toBe(0);
    expect(linha.largura_bobina_m).toBeNull();
  });

  it("nomes sugeridos conhecidos batem com os do estoque e do assistente de produto", () => {
    const nomes = TIPOS_DE_INSUMO.flatMap((t) => t.variantes.map((v) => v.nome));
    for (const n of [
      "Lona 280g brilho",
      "Lona 440g reforçada",
      "Vinil adesivo branco brilho",
      "Ilhós metálico",
    ]) {
      expect(nomes).toContain(n);
    }
  });
});

describe("a tela", () => {
  const tela = readFileSync("src/components/materiais/novo-insumo-em-passos.tsx", "utf8");
  const pagina = readFileSync("src/routes/_authenticated/materiais.tsx", "utf8");

  it("'Novo material' abre o assistente e o cadastro completo continua num botão", () => {
    expect(pagina).toContain("<NovoInsumoEmPassos");
    expect(pagina).toContain("onClick={() => setPassosAberto(true)}");
    expect(pagina).toContain("Cadastro completo");
  });

  it("o saldo entra pela RPC, não por escrita direta, e a falha da entrada não esconde o material", () => {
    expect(tela).toContain('rpc("registrar_entrada_material"');
    expect(tela).toContain("O material foi criado, mas a entrada no estoque não entrou");
  });

  it("lê os materiais existentes pela view financeira e avisa duplicidade", () => {
    expect(tela).toContain('fromFinancialView("materiais"');
    expect(tela).toContain("materiaisParecidos");
  });
});
