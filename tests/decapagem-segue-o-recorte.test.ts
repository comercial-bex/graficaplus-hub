import { describe, expect, it } from "vitest";
import {
  escolherFuncaoDecapagem,
  sincronizarDecapagem,
  type LinhaMOSync,
  type ProcessoRecorte,
} from "../src/components/orcamento/decapagem-segue-o-recorte";

/**
 * A decapagem do recorte é mão de obra e tem que ENTRAR no preço, não só
 * aparecer na memória de cálculo. Estes testes fixam como a linha de mão de
 * obra segue a linha de máquina — e o que ela nunca faz: sobrescrever hora
 * ajustada à mão e escolher uma função arbitrária.
 */

let n = 0;
const key = () => `k${++n}`;
const recorte = (extra: Partial<ProcessoRecorte> = {}): ProcessoRecorte => ({
  key: "p1", descricao: "Plotter de recorte", base: "metro_linear", maoDeObraMin: "10", ...extra,
});
const ACABAMENTO = { id: "f1", funcao: "Acabamento", custo_hora: 25, encargos_pct: 0.4 };
const DESIGNER = { id: "f2", funcao: "Designer", custo_hora: 40, encargos_pct: 0 };

describe("a decapagem segue o recorte", () => {
  it("linha de recorte cria a sua linha de mão de obra com as horas da decapagem", () => {
    const r = sincronizarDecapagem([recorte()], [], [ACABAMENTO], key);
    expect(r).toHaveLength(1);
    expect(r[0].segueProcesso).toBe("p1");
    expect(r[0].horas).toBe((10 / 60).toFixed(3));
    expect(r[0].funcao_id).toBe("f1");
    expect(r[0].custoHora).toBe("25");
    expect(r[0].encargosPct).toBe("40");
  });

  it("é idempotente: sincronizar de novo não duplica nem troca a chave", () => {
    const uma = sincronizarDecapagem([recorte()], [], [ACABAMENTO], key);
    const duas = sincronizarDecapagem([recorte()], uma, [ACABAMENTO], key);
    expect(duas).toBe(uma);
  });

  it("recalcula quando a decapagem muda", () => {
    const antes = sincronizarDecapagem([recorte()], [], [ACABAMENTO], key);
    const depois = sincronizarDecapagem([recorte({ maoDeObraMin: "20" })], antes, [ACABAMENTO], key);
    expect(depois[0].horas).toBe((20 / 60).toFixed(3));
    expect(depois[0].key).toBe(antes[0].key);
  });

  it("hora ajustada à mão não é sobrescrita", () => {
    const antes = sincronizarDecapagem([recorte()], [], [ACABAMENTO], key).map((l) => ({ ...l, horas: "1", ajustada: true }));
    const depois = sincronizarDecapagem([recorte({ maoDeObraMin: "20" })], antes, [ACABAMENTO], key);
    expect(depois[0].horas).toBe("1");
  });

  it("processo some: a automática some, a ajustada fica como linha comum", () => {
    const auto = sincronizarDecapagem([recorte()], [], [ACABAMENTO], key);
    expect(sincronizarDecapagem([], auto, [ACABAMENTO], key)).toHaveLength(0);

    const ajustada = auto.map((l) => ({ ...l, ajustada: true }));
    const r = sincronizarDecapagem([], ajustada, [ACABAMENTO], key);
    expect(r).toHaveLength(1);
    expect(r[0].segueProcesso).toBeUndefined();
  });

  it("máquina que não é de recorte, ou recorte sem área, não cria nada", () => {
    expect(sincronizarDecapagem([recorte({ base: "tempo" })], [], [ACABAMENTO], key)).toHaveLength(0);
    expect(sincronizarDecapagem([recorte({ maoDeObraMin: "0" })], [], [ACABAMENTO], key)).toHaveLength(0);
  });

  it("linhas digitadas à mão ficam em paz", () => {
    const manual: LinhaMOSync = { key: "m", funcao_id: null, descricao: "Arte", horas: "2", custoHora: "30", encargosPct: "0" };
    const r = sincronizarDecapagem([recorte()], [manual], [ACABAMENTO], key);
    expect(r).toHaveLength(2);
    expect(r[0]).toBe(manual);
  });

  it("dois recortes, duas linhas — cada uma segue o seu", () => {
    const r = sincronizarDecapagem([recorte(), recorte({ key: "p2", maoDeObraMin: "30" })], [], [ACABAMENTO], key);
    expect(r.map((l) => l.segueProcesso)).toEqual(["p1", "p2"]);
    expect(r[1].horas).toBe("0.500");
  });
});

describe("quem decapa", () => {
  it("uma função inequívoca é escolhida sozinha", () => {
    expect(escolherFuncaoDecapagem([ACABAMENTO, DESIGNER])?.id).toBe("f1");
  });

  it("duas candidatas: nenhuma — a linha nasce a R$ 0 e a tela avisa, em vez de escolher arbitrário", () => {
    const APLICADOR = { id: "f3", funcao: "Aplicador", custo_hora: 20, encargos_pct: 0 };
    const r = sincronizarDecapagem([recorte()], [], [ACABAMENTO, APLICADOR], key);
    expect(r[0].funcao_id).toBeNull();
    expect(r[0].custoHora).toBe("0");
    expect(r[0].descricao).toContain("Decapagem");
  });

  it("nenhuma candidata: nenhuma", () => {
    expect(escolherFuncaoDecapagem([DESIGNER])).toBeNull();
  });
});
