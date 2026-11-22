import { describe, expect, it } from "vitest";
import { calcularTrofeu } from "@/domain/trofeus/conta";
import { montarFicha, ROTULO_DA_DECORACAO, ROTULO_DO_TIPO_DE_ARTE, tempoEmTexto, type EntradaDaFicha } from "@/domain/trofeus/ficha";
import { ECONOMICO, MATERIAL, MODELOS, PADRAO, PREMIUM, REGRAS, TAXAS } from "./apoio/trofeus";
import type { ModeloDeTrofeu } from "@/domain/trofeus/conta";

/**
 * 22/11/2026. A ficha de produção do troféu na OS: o que cortar, em que material, com que medida, quantas peças e
 * quanto tempo de laser. Sem preço nem custo. A conta de tempo é a MESMA da conta de preço, e isto prova.
 */
const NOMES: Record<string, string> = {
  [MATERIAL.cristal2]: "ACRILICO CRISTAL VIRGEM 2MM",
  [MATERIAL.cristal3]: "ACRILICO CRISTAL VIRGEM 3MM",
  [MATERIAL.cristal6]: "ACRILICO CRISTAL VIRGEM 6MM",
  [MATERIAL.preto3]: "ACRILICO PRETO VIRGEM 3MM",
  [MATERIAL.dourado2]: "Acrilico esp dourado 2mm",
};

const ficha = (modelo: ModeloDeTrofeu, quantidade = 1, extra: Partial<EntradaDaFicha> = {}) =>
  montarFicha({
    itemId: "item-1",
    descricao: modelo.nome,
    quantidade,
    alturaCm: modelo.alturaDeReferenciaM * 100,
    urgente: false,
    arte: null,
    modelo,
    nomesDosMateriais: NOMES,
    velocidadeDeCorteMPorMin: TAXAS.velocidadeDeCorteMPorMin,
    gravacaoMinPorM2: TAXAS.gravacaoMinPorM2,
    preparoDoLaserMin: TAXAS.preparoDoLaserMin,
    provisorio: true,
    ...extra,
  });

describe("as peças, na altura escolhida", () => {
  it("econômico a 18 cm: a placa de 20 × 16 cm e duas bases de 20 × 5 cm", () => {
    const f = ficha(ECONOMICO);
    expect(f.pecasPorTrofeu).toBe(3);
    expect(f.pecas.map((p) => [p.nome, p.larguraCm, p.alturaCm, p.quantidadePorTrofeu])).toEqual([
      ["Placa principal", 20, 16, 1],
      ["Base", 20, 5, 2],
    ]);
    expect(f.pecas[0]).toMatchObject({ material: "ACRILICO CRISTAL VIRGEM 2MM", espessuraMm: 2, decoracaoRotulo: "Vinil impresso e laminado" });
    expect(f.pecas[1]).toMatchObject({ material: "ACRILICO PRETO VIRGEM 3MM", espessuraMm: 3, decoracaoRotulo: "Sem impressão" });
  });

  it("outra altura escala as medidas na proporção (36 cm é o dobro de 18 cm)", () => {
    const f = ficha(ECONOMICO, 1, { alturaCm: 36 });
    expect(f.pecas.map((p) => [p.larguraCm, p.alturaCm])).toEqual([[40, 32], [40, 10]]);
  });

  it("a quantidade do pedido multiplica as peças: 5 troféus levam 5 placas e 10 bases", () => {
    const f = ficha(ECONOMICO, 5);
    expect(f.pecas.map((p) => p.quantidadeNoPedido)).toEqual([5, 10]);
    expect(f.pecasNoPedido).toBe(15);
    expect(f.pecasPorTrofeu).toBe(3);
  });

  it("o premium tem 11 peças por troféu, as camadas da base contadas uma a uma", () => {
    const f = ficha(PREMIUM);
    expect(f.pecasPorTrofeu).toBe(11);
    expect(f.pecas.find((p) => p.nome === "Base em camadas")?.quantidadePorTrofeu).toBe(3);
    expect(f.pecas.filter((p) => p.decoracao === "gravacao_laser")).toHaveLength(1);
  });

  it("material que sumiu do cadastro aparece como 'Material sem nome', sem derrubar a ficha", () => {
    const f = ficha(ECONOMICO, 1, { nomesDosMateriais: {} });
    expect(f.pecas.every((p) => p.material === "Material sem nome")).toBe(true);
  });

  it("carrega o modelo, a altura, a urgência e a arte do pedido", () => {
    const f = ficha(PADRAO, 20, { urgente: true, arte: { tipo: "criacao_exclusiva", alteracoesExtras: 2, nomesIndividuais: 20 } });
    expect(f.modelo).toEqual({ id: "padrao", nome: "Troféu padrão em duas camadas", linha: "padrao" });
    expect(f).toMatchObject({ quantidade: 20, alturaCm: 18, urgente: true });
    expect(f.arte).toEqual({ tipo: "criacao_exclusiva", tipoRotulo: "Criação exclusiva da arte", alteracoesExtras: 2, nomesIndividuais: 20 });
  });
});

describe("o tempo de laser é a MESMA conta do preço", () => {
  it("minutos de laser, metros de corte e área batem com a conta de preço, modelo a modelo e quantidade a quantidade", () => {
    for (const modelo of MODELOS) {
      for (const quantidade of [1, 5, 20, 50]) {
        const conta = calcularTrofeu({ modelo, alturaM: modelo.alturaDeReferenciaM, quantidade }, TAXAS, REGRAS);
        const f = ficha(modelo, quantidade);
        // a conta de preço dá os minutos POR troféu (com o preparo repartido); a ficha dá os do pedido todo
        expect(f.minutosDeLaser, `${modelo.nome} x ${quantidade}`).toBeCloseTo(conta.minutosDeLaser * quantidade, 0);
        expect(f.corteM).toBeCloseTo(conta.corteM * quantidade, 1);
        expect(f.areaM2).toBeCloseTo(conta.areaUtilM2 * quantidade, 2);
        expect(f.pecasPorTrofeu).toBe(conta.pecas);
      }
    }
  });

  it("vale também em outra altura", () => {
    const conta = calcularTrofeu({ modelo: PREMIUM, alturaM: 0.35, quantidade: 3 }, TAXAS, REGRAS);
    const f = ficha(PREMIUM, 3, { alturaCm: 35 });
    expect(f.minutosDeLaser).toBeCloseTo(conta.minutosDeLaser * 3, 0);
  });

  it("o preparo do laser entra UMA vez por pedido, não por troféu", () => {
    const sem = ficha(ECONOMICO, 10, { preparoDoLaserMin: 0 }).minutosDeLaser!;
    const com = ficha(ECONOMICO, 10, { preparoDoLaserMin: 5 }).minutosDeLaser!;
    expect(com - sem).toBeCloseTo(5, 1);
  });

  it("a gravação soma tempo só nas peças gravadas", () => {
    const sem = ficha(PREMIUM, 1, { gravacaoMinPorM2: 0 }).minutosDeLaser!;
    const com = ficha(PREMIUM, 1).minutosDeLaser!;
    // a silhueta gravada: 0,16 × 0,10 m a 520 min/m² = 8,3 min
    expect(com - sem).toBeCloseTo(0.16 * 0.1 * TAXAS.gravacaoMinPorM2, 1);
    expect(ficha(ECONOMICO, 1, { gravacaoMinPorM2: 0 }).minutosDeLaser).toBe(ficha(ECONOMICO).minutosDeLaser);
  });

  it("sem velocidade de corte de uma espessura: o tempo fica nulo e a ficha diz qual espessura falta", () => {
    const f = ficha(PREMIUM, 1, { velocidadeDeCorteMPorMin: { "2": 1.9, "3": 1.15 } });
    expect(f.minutosDeLaser).toBeNull();
    expect(f.semVelocidade).toEqual([6]);
    // o resto da ficha segue inteiro
    expect(f.pecas).toHaveLength(9);
  });
});

describe("a ficha não leva preço nem custo", () => {
  it("só tem os campos de produção", () => {
    const f = ficha(PREMIUM, 5, { arte: { tipo: "adaptar_modelo", alteracoesExtras: 0, nomesIndividuais: 5 } });
    expect(Object.keys(f).sort()).toEqual([
      "alturaCm", "areaM2", "arte", "corteM", "descricao", "itemId", "minutosDeLaser", "modelo", "pecas",
      "pecasNoPedido", "pecasPorTrofeu", "provisorio", "quantidade", "semVelocidade", "urgente",
    ]);
    const texto = JSON.stringify(f).toLowerCase();
    for (const proibido of ["preco", "preço", "custo", "multiplicador", "margem", "valor"]) expect(texto, proibido).not.toContain(proibido);
  });
});

describe("rótulos", () => {
  it("decoração e tipo de arte, na língua da oficina", () => {
    expect(ROTULO_DA_DECORACAO).toEqual({ nenhuma: "Sem impressão", vinil_laminado: "Vinil impresso e laminado", gravacao_laser: "Gravação a laser" });
    expect(ROTULO_DO_TIPO_DE_ARTE.cliente_manda).toBe("O cliente manda a arte pronta");
  });
  it("tempo em texto: minutos, horas e o traço quando não deu para estimar", () => {
    expect(tempoEmTexto(6.4)).toBe("6 min");
    expect(tempoEmTexto(60)).toBe("1 h");
    expect(tempoEmTexto(85)).toBe("1 h 25 min");
    expect(tempoEmTexto(null)).toBe("—");
    expect(tempoEmTexto(Number.NaN)).toBe("—");
  });
});
