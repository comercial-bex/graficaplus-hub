import { describe, expect, it } from "vitest";
import {
  ehPaiDeAninhamento,
  medidaConfere,
  numeroNoNome,
  sugerirParaJob,
  tolerancia,
  type ItemCandidato,
} from "../src/domain/flexi/vinculo";

const item = (
  o: Partial<ItemCandidato> & Pick<ItemCandidato, "itemId" | "orcamentoNumero">,
): ItemCandidato => ({
  orcamentoId: `orc-${o.orcamentoNumero}`,
  orcamentoTitulo: "teste",
  orcamentoStatus: "aprovado",
  orcamentoCriadoEm: "2026-10-23T12:00:00-03:00",
  osId: null,
  descricao: "Lona",
  larguraM: 1,
  alturaM: 1,
  quantidade: 1,
  ...o,
});

const job = (o: Partial<Parameters<typeof sugerirParaJob>[0]> = {}) => ({
  nome: "arquivo.jpg",
  larguraCm: 100,
  alturaCm: 100,
  copias: 1,
  impressoEm: "2026-10-23T15:00:00-03:00",
  ...o,
});

describe("número no nome", () => {
  it("lê O115 como orçamento e OS108 como OS", () => {
    expect(numeroNoNome("O115 50und 11x7")).toEqual({ orcamento: 115, os: null });
    expect(numeroNoNome("banner O115.pdf")).toEqual({ orcamento: 115, os: null });
    expect(numeroNoNome("O-115 faixa")).toEqual({ orcamento: 115, os: null });
    expect(numeroNoNome("OS108 lona")).toEqual({ orcamento: null, os: 108 });
    expect(numeroNoNome("OS 108 lona")).toEqual({ orcamento: null, os: 108 });
  });

  it("não confunde medida, palavra ou nome comum com número de orçamento", () => {
    expect(numeroNoNome("BANNER 100X80.pdf")).toEqual({ orcamento: null, os: null });
    expect(numeroNoNome("banner O 80x120")).toEqual({ orcamento: null, os: null });
    expect(numeroNoNome("O80x120")).toEqual({ orcamento: null, os: null });
    expect(numeroNoNome("Otimizar Distribuição")).toEqual({ orcamento: null, os: null });
    expect(numeroNoNome("os banners novos")).toEqual({ orcamento: null, os: null });
    expect(numeroNoNome("WhatsApp Image 2026")).toEqual({ orcamento: null, os: null });
  });
});

describe("medida com sangria", () => {
  it("tolera 3 cm ou 2% do lado, o que for maior", () => {
    expect(tolerancia(50)).toBe(3);
    expect(tolerancia(500)).toBe(10);
  });

  it("a lona de 5 m × 1,3 m que saiu com 503,8 × 131 cm confere", () => {
    expect(
      medidaConfere(
        job({ larguraCm: 131, alturaCm: 503.782 }),
        item({ itemId: "a", orcamentoNumero: 108, larguraM: 5, alturaM: 1.3 }),
      ),
    ).toBe(true);
  });

  it("vale girada e recusa medida diferente", () => {
    const i = item({ itemId: "a", orcamentoNumero: 1, larguraM: 0.8, alturaM: 1.2 });
    expect(medidaConfere(job({ larguraCm: 119.998, alturaCm: 80.002 }), i)).toBe(true);
    expect(medidaConfere(job({ larguraCm: 100, alturaCm: 80 }), i)).toBe(false);
    expect(
      medidaConfere(
        job(),
        item({ itemId: "b", orcamentoNumero: 1, larguraM: null, alturaM: null }),
      ),
    ).toBe(false);
  });
});

describe("sugestão por medida (casos reais de 24/10/2026)", () => {
  it("os 54 cópias de 11x7 casam com o item de 50 do orçamento 115, mesmo ainda 'enviado'", () => {
    const itens = [
      item({
        itemId: "i1",
        orcamentoNumero: 115,
        orcamentoStatus: "enviado",
        larguraM: 0.11,
        alturaM: 0.07,
        quantidade: 50,
      }),
      item({
        itemId: "i2",
        orcamentoNumero: 115,
        orcamentoStatus: "enviado",
        larguraM: 0.15,
        alturaM: 0.08,
        quantidade: 60,
      }),
      item({
        itemId: "i3",
        orcamentoNumero: 115,
        orcamentoStatus: "enviado",
        larguraM: 0.2,
        alturaM: 0.15,
        quantidade: 50,
      }),
    ];
    const s = sugerirParaJob(
      job({
        nome: "50 und 11x7.png",
        larguraCm: 11.024,
        alturaCm: 7.027,
        copias: 54,
        impressoEm: "2026-10-24T10:43:25-03:00",
      }),
      itens,
    );
    expect(s?.origem).toBe("medida");
    expect(s?.estado).toBe("sugerido");
    expect(s?.principal?.itemId).toBe("i1");
    expect(s?.principal?.motivos).toContain("4 cópia(s) a mais");
  });

  it("a lona da OS 108 casa com o orçamento convertido, com confiança alta", () => {
    const itens = [
      item({
        itemId: "a",
        orcamentoNumero: 108,
        orcamentoStatus: "convertido",
        larguraM: 2.5,
        alturaM: 1.3,
        quantidade: 1,
        osId: "os-1",
        orcamentoCriadoEm: "2026-10-22T10:00:00-03:00",
      }),
      item({
        itemId: "b",
        orcamentoNumero: 108,
        orcamentoStatus: "convertido",
        larguraM: 5,
        alturaM: 1.3,
        quantidade: 1,
        osId: "os-1",
        orcamentoCriadoEm: "2026-10-22T10:00:00-03:00",
      }),
    ];
    const s = sugerirParaJob(
      job({
        nome: "250x130.jpg",
        larguraCm: 131,
        alturaCm: 251.899,
        impressoEm: "2026-10-22T18:03:44-03:00",
      }),
      itens,
    );
    expect(s?.estado).toBe("sugerido");
    expect(s?.principal?.itemId).toBe("a");
    expect(s?.principal?.confianca).toBe(1);
  });

  it("job impresso UM DIA ANTES de o orçamento existir ainda casa (lona 80×120, orçamento 107)", () => {
    const s = sugerirParaJob(
      job({
        nome: "Lona 280 p Banner",
        larguraCm: 119.998,
        alturaCm: 80.002,
        impressoEm: "2026-10-21T19:57:10-03:00",
      }),
      [
        item({
          itemId: "x",
          orcamentoNumero: 107,
          orcamentoStatus: "enviado",
          larguraM: 0.8,
          alturaM: 1.2,
          orcamentoCriadoEm: "2026-10-22T09:00:00-03:00",
        }),
      ],
    );
    expect(s?.principal?.itemId).toBe("x");
  });

  it("dois orçamentos com a mesma medida e data viram 'revisar', sem principal", () => {
    const itens = [
      item({ itemId: "a", orcamentoNumero: 70, larguraM: 0.6, alturaM: 0.9 }),
      item({ itemId: "b", orcamentoNumero: 71, larguraM: 0.6, alturaM: 0.9 }),
    ];
    const s = sugerirParaJob(job({ larguraCm: 90, alturaCm: 60 }), itens);
    expect(s?.estado).toBe("revisar");
    expect(s?.principal).toBeNull();
    expect(s?.candidatos.map((c) => c.itemId).sort()).toEqual(["a", "b"]);
  });

  it("uma cópia de 50, dias antes do pedido, é prova: pede conferência em vez de sugerir", () => {
    const s = sugerirParaJob(
      job({
        nome: "155x202",
        larguraCm: 20.252,
        alturaCm: 15.519,
        copias: 1,
        impressoEm: "2026-10-21T15:35:00-03:00",
      }),
      [
        item({
          itemId: "p",
          orcamentoNumero: 115,
          orcamentoStatus: "enviado",
          larguraM: 0.2,
          alturaM: 0.15,
          quantidade: 50,
          orcamentoCriadoEm: "2026-10-23T12:59:00-03:00",
        }),
      ],
    );
    expect(s?.estado).toBe("revisar");
    expect(s?.principal).toBeNull();
    expect(s?.candidatos[0].motivos.join(" ")).toContain("pode ser prova");
  });

  it("o pedido em dois jobs (1 + 2 banners) soma como parte da quantidade e o orçamento do dia ganha do de 6 dias antes", () => {
    const itens = [
      item({
        itemId: "antigo",
        orcamentoNumero: 36,
        larguraM: 0.5,
        alturaM: 0.6,
        quantidade: 1,
        orcamentoCriadoEm: "2026-09-22T10:00:00-03:00",
      }),
      item({
        itemId: "do-dia",
        orcamentoNumero: 56,
        larguraM: 0.5,
        alturaM: 0.6,
        quantidade: 3,
        orcamentoCriadoEm: "2026-09-28T14:01:00-03:00",
      }),
    ];
    const s = sugerirParaJob(
      job({
        nome: "BANNER 50X60 VEN",
        larguraCm: 60.014,
        alturaCm: 50.003,
        copias: 2,
        impressoEm: "2026-09-28T15:36:00-03:00",
      }),
      itens,
    );
    expect(s?.candidatos[0].itemId).toBe("do-dia");
    expect(s?.candidatos[0].motivos).toContain("parte da quantidade (2 de 3)");
  });

  it("fora da janela de 7 dias não casa", () => {
    const s = sugerirParaJob(job({ impressoEm: "2026-10-23T15:00:00-03:00" }), [
      item({ itemId: "a", orcamentoNumero: 1, orcamentoCriadoEm: "2026-10-01T09:00:00-03:00" }),
    ]);
    expect(s).toBeNull();
  });

  it("orçamento rejeitado perde força e não vira sugestão automática", () => {
    const s = sugerirParaJob(job(), [
      item({ itemId: "a", orcamentoNumero: 39, orcamentoStatus: "rejeitado" }),
    ]);
    expect(s?.estado).not.toBe("sugerido");
    expect(s?.principal).toBeNull();
  });

  it("sem item com a medida, não sugere nada", () => {
    expect(
      sugerirParaJob(job({ larguraCm: 30, alturaCm: 10 }), [
        item({ itemId: "a", orcamentoNumero: 1 }),
      ]),
    ).toBeNull();
  });

  it("o pai do aninhamento não recebe sugestão", () => {
    expect(ehPaiDeAninhamento("Otimizar Distribuição")).toBe(true);
    expect(ehPaiDeAninhamento("Banner lona")).toBe(false);
    expect(
      sugerirParaJob(job({ nome: "Otimizar Distribuição" }), [
        item({ itemId: "a", orcamentoNumero: 1 }),
      ]),
    ).toBeNull();
  });
});

describe("sugestão pelo número no nome", () => {
  const itens = [
    item({ itemId: "a", orcamentoNumero: 115, larguraM: 0.11, alturaM: 0.07, quantidade: 50 }),
    item({ itemId: "b", orcamentoNumero: 115, larguraM: 0.2, alturaM: 0.15, quantidade: 50 }),
    item({ itemId: "z", orcamentoNumero: 9, larguraM: 0.11, alturaM: 0.07, quantidade: 50 }),
  ];

  it("o número manda: escolhe o item do orçamento 115 cuja medida confere, ignorando o do 9", () => {
    const s = sugerirParaJob(
      job({ nome: "O115 50und 11x7", larguraCm: 11.024, alturaCm: 7.027, copias: 54 }),
      itens,
    );
    expect(s?.origem).toBe("numero_no_nome");
    expect(s?.estado).toBe("sugerido");
    expect(s?.principal?.itemId).toBe("a");
  });

  it("número certo e medida que não confere em nenhum item: pede conferência com todos os itens", () => {
    const s = sugerirParaJob(job({ nome: "O115 teste", larguraCm: 77, alturaCm: 33 }), itens);
    expect(s?.estado).toBe("revisar");
    expect(s?.candidatos.map((c) => c.itemId).sort()).toEqual(["a", "b"]);
  });

  it("número que não existe entre os orçamentos candidatos cai para a medida", () => {
    const s = sugerirParaJob(
      job({ nome: "O999 x", larguraCm: 11.024, alturaCm: 7.027, copias: 50 }),
      itens,
    );
    expect(s?.origem).toBe("medida");
  });
});
