import { describe, expect, it } from "vitest";
import {
  dataBR,
  descreverEntrega,
  diaDoValor,
  dinheiro,
  metros,
  metrosQuadrados,
  parcelasDoAcordo,
  somarDias,
  unidadeNoDocumento,
  validadeAte,
} from "../src/lib/pdf/formato";
import { detectarFormato } from "../src/lib/pdf/imagens";

/**
 * O que o documento escreve: parcelas, datas, medidas, entrega e o formato da
 * arte. A suíte roda duas vezes no CI local — `TZ=UTC` e `TZ=America/Belem` —
 * e TODOS os testes de data têm de passar nas duas: o defeito clássico daqui é a
 * data que volta um dia quando o fuso muda.
 */

const soma = (valores: number[]) => Math.round(valores.reduce((a, b) => a + b, 0) * 100) / 100;

describe("parcelas: a mesma conta de converter_orcamento_em_os", () => {
  it("1x sem data é o total, sem vencimento", () => {
    expect(parcelasDoAcordo(792.43, { parcelas: 1 })).toEqual([
      { numero: 1, valor: 792.43, vencimento: null },
    ]);
  });

  it("todas round(total/n, 2) e a ÚLTIMA leva a sobra dos centavos", () => {
    const p = parcelasDoAcordo(1100, { parcelas: 3 });
    expect(p.map((x) => x.valor)).toEqual([366.67, 366.67, 366.66]);
    expect(soma(p.map((x) => x.valor))).toBe(1100);

    // 100,00 em 3x: 33,33 + 33,33 + 33,34 — a sobra é positiva também.
    expect(parcelasDoAcordo(100, { parcelas: 3 }).map((x) => x.valor)).toEqual([
      33.33, 33.33, 33.34,
    ]);
  });

  it("arredonda o meio para cima como o round() do Postgres, sem erro de ponto flutuante", () => {
    // Em float, 501,15 / 10 × 100 dá 5011,4999… e a conta errada daria 50,11.
    const p = parcelasDoAcordo(501.15, { parcelas: 10 });
    expect(p[0].valor).toBe(50.12);
    expect(p[9].valor).toBe(50.07);
    expect(soma(p.map((x) => x.valor))).toBe(501.15);
    // 0,29 em 2x: 0,145 → 0,15 + 0,14
    expect(parcelasDoAcordo(0.29, { parcelas: 2 }).map((x) => x.valor)).toEqual([0.15, 0.14]);
  });

  it("a soma bate com o total em qualquer combinação", () => {
    for (const total of [0.01, 9.99, 792.43, 1234.56, 20000]) {
      for (let n = 1; n <= 12; n++) {
        const p = parcelasDoAcordo(total, { parcelas: n });
        expect(p).toHaveLength(n);
        expect(soma(p.map((x) => x.valor))).toBe(total);
      }
    }
  });

  it("com primeiro vencimento, cada parcela vence intervalo_dias depois (padrão 30)", () => {
    expect(
      parcelasDoAcordo(300, { parcelas: 3, primeiro_vencimento: "2026-10-20" }).map(
        (x) => x.vencimento,
      ),
    ).toEqual(["2026-10-20", "2026-11-19", "2026-12-19"]);
    expect(
      parcelasDoAcordo(300, {
        parcelas: 2,
        primeiro_vencimento: "2026-12-31",
        intervalo_dias: 15,
      }).map((x) => x.vencimento),
    ).toEqual(["2026-12-31", "2027-01-15"]);
  });

  it("sem condição, parcelas zeradas ou lixo: 1x, como GREATEST(1, COALESCE(…, 1))", () => {
    expect(parcelasDoAcordo(50, null)).toHaveLength(1);
    expect(parcelasDoAcordo(50, { parcelas: 0 })).toHaveLength(1);
    expect(
      parcelasDoAcordo(50, { parcelas: 1, primeiro_vencimento: "amanhã" })[0].vencimento,
    ).toBeNull();
  });
});

describe("datas: nunca passam por UTC", () => {
  it("coluna date sai no mesmo dia em qualquer fuso", () => {
    // new Date("2026-08-07") em Macapá é 06/08 às 21h — era o defeito.
    expect(dataBR("2026-08-07")).toBe("07/08/2026");
    expect(dataBR("2026-01-01")).toBe("01/01/2026");
    expect(dataBR("2026-12-31")).toBe("31/12/2026");
  });

  it("timestamp é lido no fuso da gráfica, não no de quem imprime", () => {
    // 22h30 em Macapá do dia 04 = 01h30 UTC do dia 05.
    expect(dataBR("2026-08-05T01:30:00+00:00")).toBe("04/08/2026");
    expect(dataBR("2026-08-04T12:00:00-03:00")).toBe("04/08/2026");
    expect(diaDoValor("2026-10-05T22:16:53.69137+00:00")).toBe("2026-10-05");
  });

  it("vazio ou inválido é null, não 'Invalid Date'", () => {
    expect(dataBR(null)).toBeNull();
    expect(dataBR("")).toBeNull();
    expect(dataBR("não é data")).toBeNull();
  });

  it("validade = dia da criação na gráfica + validade_dias", () => {
    // Criado 04/08 às 22h30 em Macapá: vale até 14/08, não 15/08.
    expect(validadeAte("2026-08-05T01:30:00+00:00", 10)).toBe("2026-08-14");
    expect(dataBR(validadeAte("2026-08-04T15:00:00-03:00", 10))).toBe("14/08/2026");
    expect(validadeAte(null, 7)).toBeNull();
  });

  it("soma de dias atravessa mês e ano", () => {
    expect(somarDias("2026-01-31", 1)).toBe("2026-02-01");
    expect(somarDias("2026-12-25", 10)).toBe("2027-01-04");
    expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("medidas e dinheiro como no modelo", () => {
  it("3 casas com vírgula e R$ pt-BR", () => {
    expect(metros(3)).toBe("3,000m");
    expect(metros(2.45)).toBe("2,450m");
    expect(metrosQuadrados(22.05)).toBe("22,050m²");
    expect(dinheiro(792.43)).toBe("R$ 792,43");
    expect(dinheiro(1234.5)).toBe("R$ 1.234,50");
    expect(dinheiro(null)).toBe("R$ 0,00");
  });

  it("unidade em maiúsculas; área vira M² nas duas grafias do catálogo", () => {
    expect(unidadeNoDocumento("m2")).toBe("M²");
    expect(unidadeNoDocumento("m²")).toBe("M²");
    expect(unidadeNoDocumento("un")).toBe("UN");
    expect(unidadeNoDocumento("")).toBeNull();
  });
});

describe("caixa ENDEREÇO: ENTREGA", () => {
  it("retirada é o padrão (precisa_entrega nulo ou falso)", () => {
    expect(descreverEntrega({})).toBe("Cliente retira na empresa");
    expect(
      descreverEntrega({ precisa_entrega: false, endereco_entrega: { descricao: "Rua velha, 1" } }),
    ).toBe("Cliente retira na empresa");
  });

  it("entrega mostra o endereço; instalação acrescenta a linha", () => {
    expect(
      descreverEntrega({ precisa_entrega: true, endereco_entrega: { descricao: "Av. FAB, 1200" } }),
    ).toBe("Av. FAB, 1200");
    expect(
      descreverEntrega({
        precisa_entrega: true,
        precisa_instalacao: true,
        endereco_entrega: { descricao: "Av. FAB, 1200" },
      }),
    ).toBe("Av. FAB, 1200\nCom instalação");
  });

  it("entrega sem endereço não finge retirada", () => {
    expect(descreverEntrega({ precisa_entrega: true })).toBe("Endereço de entrega a combinar");
  });
});

describe("formato da arte pelos bytes", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  const texto = (t: string) => new TextEncoder().encode(t);

  it("reconhece pela assinatura, não pelo nome", () => {
    expect(detectarFormato(bytes(0xff, 0xd8, 0xff, 0xe0), "arte.png")).toBe("jpeg");
    expect(detectarFormato(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "x")).toBe("png");
    expect(detectarFormato(texto("RIFF\x00\x00\x00\x00WEBPVP8 "), "foto.png")).toBe("webp");
    expect(detectarFormato(texto("GIF89a"), null)).toBe("gif");
    expect(detectarFormato(texto("%PDF-1.7\n"), "arte.jpg")).toBe("pdf");
    expect(detectarFormato(texto("\x00\x00\x00\x18ftypheic"), null)).toBe("heic");
    expect(detectarFormato(texto("\x00\x00\x00\x1cftypavif"), null)).toBe("avif");
    expect(detectarFormato(texto('<?xml version="1.0"?>\n<svg xmlns="x">'), null)).toBe("svg");
  });

  it("sem assinatura conhecida, a extensão desempata (e a URL assinada não atrapalha)", () => {
    expect(detectarFormato(bytes(1, 2, 3), "orcamento/1/arte.webp?token=abc")).toBe("webp");
    expect(detectarFormato(bytes(1, 2, 3), "arte.cdr")).toBe("desconhecido");
  });
});
