import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  interpretarLeitura,
  itemSemMedida,
  linhaDoItem,
  linhasDoAcabamento,
  montarPerguntaDoOrcamento,
  observacaoDoRascunho,
  precoDeTabela,
  type ProdutoParaIa,
} from "../src/domain/orcamentos/orcamento-com-ia";
import { roteirosDaConversa } from "../src/domain/whatsapp/assistente";
import { lerPedidoComIa } from "../src/lib/api/orcamento-ia.functions";

const lona: ProdutoParaIa = { id: "p1", nome: "Lona 280g impressa", unidade: "m2", tipo: "produto", personalidade: "lona", como_medir: "medida", perguntas: "externa?" };
const chaveiro: ProdutoParaIa = { id: "p2", nome: "CHAVEIRO ACRILICO", unidade: "un", tipo: "produto", personalidade: "c", como_medir: "q", perguntas: "formato?" };
const produtos = [lona, chaveiro];

describe("orçamento com IA (01/11/2026)", () => {
  it("a IA só escolhe da lista e nunca recebe preço", () => {
    const m = montarPerguntaDoOrcamento("2 banners", produtos);
    expect(m[0].content).toContain("SOMENTE da lista");
    expect(m[0].content).toContain("Nunca invente produto, preço");
    expect(m[1].content).not.toMatch(/preco|custo/i);
  });

  it("produto fora da lista não entra, e o que ficou de fora é dito", () => {
    const l = interpretarLeitura(
      {
        titulo: "Banners",
        itens: [
          { produto_id: "p1", quantidade: 2, largura_m: 1.2, altura_m: 0.8, observacao: "bastão" },
          { produto_id: "inventado", quantidade: 1, largura_m: null, altura_m: null, observacao: null },
        ],
        perguntas_que_faltam: ["Vai ficar em área externa?"],
        sem_produto: ["Camiseta"],
      },
      produtos,
    );
    expect(l?.itens.map((i) => i.produto_id)).toEqual(["p1"]);
    expect(l?.sem_produto).toEqual(["Camiseta", "Item que a IA não achou na lista: inventado"]);
  });

  it("resposta ilegível não vira orçamento", () => {
    expect(interpretarLeitura("isto não é json", produtos)).toBeNull();
    expect(interpretarLeitura({ titulo: "x" }, produtos)).toBeNull();
  });

  it("quantidade inválida vira 1 e medida inválida vira vazio", () => {
    const l = interpretarLeitura({ titulo: "x", itens: [{ produto_id: "p1", quantidade: -3, largura_m: 0, altura_m: "abc" }] }, produtos);
    expect(l?.itens[0]).toMatchObject({ quantidade: 1, largura_m: null, altura_m: null });
  });

  it("produto por m² sem medida fica sem preço, e o banco faz a conta do resto", () => {
    const semMedida = { produto_id: "p1", nome: "Lona", unidade: "m2", quantidade: 2, largura_m: null, altura_m: null, observacao: null, acabamentos: [] as string[] };
    expect(itemSemMedida(semMedida)).toBe(true);
    expect(linhaDoItem(semMedida, 40, 0)).toMatchObject({ preco_m2: null, valor_unitario: 0 });
    const comMedida = { ...semMedida, largura_m: 1.2, altura_m: 0.8 };
    expect(itemSemMedida(comMedida)).toBe(false);
    expect(linhaDoItem(comMedida, 40, 0)).toMatchObject({ preco_m2: 40, largura: 1.2, altura: 0.8, origem_calculo: "ia" });
    const unidade = { ...semMedida, produto_id: "p2", unidade: "un", quantidade: 200 };
    expect(itemSemMedida(unidade)).toBe(false);
    expect(linhaDoItem(unidade, 5, 1)).toMatchObject({ preco_m2: null, valor_unitario: 5, quantidade: 200, ordem: 1 });
  });

  it("o preço respeita a faixa de quantidade: 200 chaveiros não custam o preço de 1", () => {
    const faixas = [
      { id: "a", quantidade_minima: 50, preco_unitario: 5.5 },
      { id: "b", quantidade_minima: 100, preco_unitario: 4.9 },
      { id: "c", quantidade_minima: 500, preco_unitario: 4.45 },
    ];
    expect(precoDeTabela({ unidade: "un", quantidade: 200 }, 6.5, faixas)).toBe(4.9);
    expect(precoDeTabela({ unidade: "un", quantidade: 10 }, 6.5, faixas)).toBe(6.5);
    expect(precoDeTabela({ unidade: "un", quantidade: 200 }, 6.5, [])).toBe(6.5);
    expect(precoDeTabela({ unidade: "m2", quantidade: 200 }, 45, [{ id: "d", quantidade_minima: 100, preco_unitario: 1, preco_m2_referencia: 39 }])).toBe(39);
  });

  it("o acabamento pedido vira linha com o contorno certo; fora da lista do produto não entra", () => {
    const comAcab = { ...lona, acabamentos: ["Bainha + ilhós", "Bastão e corda"] };
    const l = interpretarLeitura(
      { titulo: "x", itens: [{ produto_id: "p1", quantidade: 2, largura_m: 3, altura_m: 0.7, acabamentos: ["Bainha + ilhós", "Laminação", "Bastão e corda"] }] },
      [comAcab],
    );
    expect(l?.itens[0].acabamentos).toEqual(["Bainha + ilhós", "Bastão e corda"]);
    const servicos = [
      { acabamento: "Bainha + ilhós", id: "s1", nome: "Acabamento de lona", unidade: "m", preco: 9 },
      { acabamento: "Bastão e corda", id: "s2", nome: "Bastão e corda", unidade: "un", preco: 12 },
    ];
    const r = linhasDoAcabamento(l!.itens[0], servicos);
    expect(r.pendentes).toEqual([]);
    expect(r.linhas).toEqual([
      expect.objectContaining({ produto_id: "s1", quantidade: 14.8, valor_unitario: 9 }),
      expect.objectContaining({ produto_id: "s2", quantidade: 2, valor_unitario: 12 }),
    ]);
  });

  it("acabamento sem medida vira pendência, e por peça não precisa de medida", () => {
    const item = { produto_id: "p1", nome: "Lona", unidade: "m2", quantidade: 2, largura_m: null, altura_m: null, observacao: null, acabamentos: ["Bainha + ilhós", "Bastão e corda"] };
    const servicos = [
      { acabamento: "Bainha + ilhós", id: "s1", nome: "A", unidade: "m", preco: 9 },
      { acabamento: "Bastão e corda", id: "s2", nome: "B", unidade: "un", preco: 12 },
    ];
    const r = linhasDoAcabamento(item, servicos);
    expect(r.pendentes[0]).toContain("falta a medida");
    expect(r.linhas.map((x) => x.produto_id)).toEqual(["s2"]);
  });

  it("o rascunho guarda o pedido e o que falta perguntar", () => {
    const o = observacaoDoRascunho({ titulo: "x", itens: [], perguntas_que_faltam: ["Área externa?"], sem_produto: ["Camiseta"] }, "2 banners");
    expect(o).toContain("2 banners");
    expect(o).toContain("- Área externa?");
    expect(o).toContain("- Camiseta");
  });

  it("sem chave diz que a IA não está ligada, sem chamar ninguém", async () => {
    const buscar = vi.fn();
    expect(await lerPedidoComIa("2 banners", produtos, null, buscar as any)).toEqual({ estado: "sem_ia" });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("nenhum roteiro liberado é dito, e saldo e limite não viram leitura vazia", async () => {
    const motor = { url: "u", chave: "c", modelo: "m" };
    expect(await lerPedidoComIa("2 banners", [], motor)).toEqual({ estado: "sem_roteiro" });
    const resposta = (status: number) => vi.fn(async () => new Response("{}", { status })) as any;
    expect(await lerPedidoComIa("x y z", produtos, motor, resposta(402))).toEqual({ estado: "sem_saldo" });
    expect(await lerPedidoComIa("x y z", produtos, motor, resposta(429))).toEqual({ estado: "limite" });
  });

  it("lê a ferramenta que a IA chamou", async () => {
    const corpo = { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ titulo: "T", itens: [{ produto_id: "p2", quantidade: 200 }], perguntas_que_faltam: [], sem_produto: [] }) } }] } }] };
    const buscar = vi.fn(async () => new Response(JSON.stringify(corpo), { status: 200 })) as any;
    const r = await lerPedidoComIa("200 chaveiros", produtos, { url: "u", chave: "c", modelo: "m" }, buscar);
    expect(r.estado).toBe("ok");
    if (r.estado === "ok") expect(r.leitura.itens[0]).toMatchObject({ produto_id: "p2", quantidade: 200 });
  });
});

describe("o roteiro chega à assistente do WhatsApp só do produto falado", () => {
  const roteiros = [
    { nome: "Lona 280g impressa", produto: "Lona 280g impressa", como_medir: "m", perguntas: "p" },
    { nome: "Adesivo perfurado (one way)", produto: "Adesivo perfurado (one way)", como_medir: "m", perguntas: "p" },
    { nome: "CHAVEIRO ACRILICO", produto: "CHAVEIRO ACRILICO", como_medir: "m", perguntas: "p" },
  ];
  it("acha pelo nome, sem ligar para acento e caixa", () => {
    expect(roteirosDaConversa("Quero um chaveiro de acrílico", roteiros).map((r) => r.produto)).toEqual(["CHAVEIRO ACRILICO"]);
  });
  it("conversa sem produto não manda roteiro nenhum", () => {
    expect(roteirosDaConversa("Bom dia, tudo bem?", roteiros)).toEqual([]);
  });
  it("respeita o limite", () => {
    expect(roteirosDaConversa("lona adesivo chaveiro", roteiros, 2)).toHaveLength(2);
  });
});

describe("o contrato da cobrança", () => {
  const painel = readFileSync("src/routes/_authenticated/preencher-pastas.tsx", "utf8");
  const assistente = readFileSync("src/lib/api/whatsapp-assistente.server.ts", "utf8");
  const lista = readFileSync("src/routes/_authenticated/orcamentos.index.tsx", "utf8");
  it("cada área tem a sua parte, e a gravação é conferida", () => {
    for (const parte of ["ParteDaProducao", "ParteDoAtendimento", "ParteDoFinanceiro"]) expect(painel).toContain(parte);
    expect(painel).toContain("Nada foi gravado");
  });
  it("o botão está na lista de orçamentos e a assistente segue por ia_ativa", () => {
    expect(lista).toContain("<OrcamentoComIa />");
    expect(assistente).toContain("roteirosDaConversa");
    expect(assistente).toContain('if (!config.ia_ativa) return { acao: "nada", motivo: "ia_desligada" }');
  });
});
