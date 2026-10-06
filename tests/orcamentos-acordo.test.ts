import { describe, expect, it } from "vitest";
import {
  brl,
  camposDoModo,
  dataBR,
  datasAoDefinirEntrega,
  enderecoDoCliente,
  isoLocal,
  modoDeEntrega,
  parcelasDoOrcamento,
  pendenciasParaEnviar,
  prazoSeparado,
  somarDias,
  textoDoEndereco,
  validadeAte,
} from "../src/domain/orcamentos/acordo";

/**
 * O combinado do orçamento. As parcelas têm de bater, centavo por centavo, com
 * o que `converter_orcamento_em_os` cria no a receber; a data de entrega tem de
 * levar junto o `prazo`, que é o que a OS herda. Roda em America/Belem e em
 * UTC no CI: data sem hora que passa por UTC volta um dia.
 */

describe("datas sem fuso", () => {
  it("soma dias e formata sem voltar um dia", () => {
    expect(somarDias("2026-08-07", 7)).toBe("2026-08-14");
    expect(somarDias("2026-12-28", 5)).toBe("2027-01-02");
    expect(dataBR("2026-08-07")).toBe("07/08/2026");
    expect(isoLocal(new Date(2026, 7, 7))).toBe("2026-08-07");
  });

  it("validade conta a partir do dia da criação", () => {
    expect(validadeAte("2026-08-04T15:00:00-03:00", 10)).toBe("2026-08-14");
    expect(validadeAte("2026-08-04", 7)).toBe("2026-08-11");
    expect(validadeAte(null, 10)).toBeNull();
  });
});

describe("a data de entrega leva o prazo junto", () => {
  it("prazo vazio ou igual à entrega acompanha", () => {
    expect(datasAoDefinirEntrega("2026-08-07", { prazo: null, data_entrega_prometida: null })).toEqual({
      data_entrega_prometida: "2026-08-07",
      prazo: "2026-08-07",
    });
    expect(
      datasAoDefinirEntrega("2026-08-10", { prazo: "2026-08-07", data_entrega_prometida: "2026-08-07" }),
    ).toEqual({ data_entrega_prometida: "2026-08-10", prazo: "2026-08-10" });
  });

  it("prazo separado de propósito fica", () => {
    const atual = { prazo: "2026-08-05", data_entrega_prometida: "2026-08-07" };
    expect(prazoSeparado(atual)).toBe(true);
    expect(datasAoDefinirEntrega("2026-08-09", atual)).toEqual({ data_entrega_prometida: "2026-08-09" });
  });

  it("limpar a entrega limpa o prazo que a acompanhava", () => {
    expect(
      datasAoDefinirEntrega(null, { prazo: "2026-08-07", data_entrega_prometida: "2026-08-07" }),
    ).toEqual({ data_entrega_prometida: null, prazo: null });
  });
});

describe("entrega", () => {
  it("os três modos viram os dois campos que a OS herda", () => {
    expect(camposDoModo("retira")).toEqual({ precisa_entrega: false, precisa_instalacao: false });
    expect(camposDoModo("entrega")).toEqual({ precisa_entrega: true, precisa_instalacao: false });
    expect(camposDoModo("instalacao")).toEqual({ precisa_entrega: true, precisa_instalacao: true });
    expect(modoDeEntrega(null, null)).toBe("retira");
    expect(modoDeEntrega(true, false)).toBe("entrega");
    expect(modoDeEntrega(true, true)).toBe("instalacao");
  });

  it("lê o endereço em qualquer forma e monta o do cliente", () => {
    expect(textoDoEndereco({ descricao: " Rua A, 10 " })).toBe("Rua A, 10");
    expect(textoDoEndereco({ logradouro: "Rua B", numero: "5", cidade: "Macapá" })).toBe("Rua B, 5, Macapá");
    expect(textoDoEndereco(null)).toBe("");
    expect(
      enderecoDoCliente({ endereco: "Av. FAB, 100", bairro: "Centro", cidade: "Macapá", estado: "AP", cep: "68900-000" }),
    ).toBe("Av. FAB, 100, Centro, Macapá - AP, CEP 68900-000");
  });
});

describe("parcelas iguais às da conversão em OS", () => {
  it("1x é o total", () => {
    expect(parcelasDoOrcamento(792.43, { parcelas: 1 })).toEqual([
      { numero: 1, valor: 792.43, vencimento: null },
    ]);
  });

  it("a última leva a sobra e a soma bate com o total", () => {
    const p = parcelasDoOrcamento(100, { parcelas: 3, intervalo_dias: 30, primeiro_vencimento: "2026-08-10" });
    expect(p.map((x) => x.valor)).toEqual([33.33, 33.33, 33.34]);
    expect(p.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(100, 2);
    expect(p.map((x) => x.vencimento)).toEqual(["2026-08-10", "2026-09-09", "2026-10-09"]);
  });

  it("valores tortos não quebram: parcela mínima 1 e intervalo padrão 30", () => {
    expect(parcelasDoOrcamento(50, { parcelas: 0 })).toHaveLength(1);
    const p = parcelasDoOrcamento(60, { parcelas: 2, primeiro_vencimento: "2026-01-31" });
    expect(p[1].vencimento).toBe("2026-03-02");
  });
});

describe("o que falta antes de mandar", () => {
  it("lista só o que falta, com o plural certo", () => {
    expect(
      pendenciasParaEnviar({
        temClienteOuContato: true,
        dataEntrega: "2026-08-07",
        verPreco: true,
        temCondicao: true,
        itens: [{ arquivo_id: "a" }],
      }),
    ).toEqual([]);
    expect(
      pendenciasParaEnviar({
        temClienteOuContato: false,
        dataEntrega: null,
        verPreco: true,
        temCondicao: false,
        itens: [{ arquivo_id: null }, { arquivo_id: null }],
      }),
    ).toEqual(["cliente ou contato", "data de entrega", "condição de pagamento", "layout em 2 itens"]);
    // quem não vê preço não é cobrado por condição de pagamento
    expect(
      pendenciasParaEnviar({
        temClienteOuContato: true,
        dataEntrega: "2026-08-07",
        verPreco: false,
        temCondicao: false,
        itens: [],
      }),
    ).toEqual(["itens"]);
  });
});

describe("dinheiro em pt-BR", () => {
  it("vírgula nos centavos, ponto no milhar", () => {
    expect(brl(0)).toMatch(/^R\$\s0,00$/);
    expect(brl(1234.5)).toMatch(/^R\$\s1\.234,50$/);
    expect(brl("abc")).toMatch(/^R\$\s0,00$/);
  });
});
