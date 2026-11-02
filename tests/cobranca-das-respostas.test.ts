import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cobrancasDasRespostas,
  descricaoDaLinha,
  planoDasLinhas,
  rotuloDaQuantidade,
  totalDasCobrancas,
  type ProcessoDaResposta,
} from "../src/domain/orcamentos/cobranca-das-respostas";
import type { PerguntaDoProduto, RespostaDoItem } from "../src/domain/orcamentos/perguntas-do-item";

const ler = (c: string) => readFileSync(c, "utf8");

const pergunta = (id: string, acoes: { resposta: string; processo_id: string }[]): PerguntaDoProduto => ({
  id, pergunta: id, descricao: null, obrigatoria: false, tipo_resposta: "unica", respostas: ["Sim", "Não"], acoes, ordem: 0,
});
const LAMINAR = pergunta("laminar", [{ resposta: "Sim", processo_id: "lam" }]);
const INSTALAR = pergunta("instalar", [
  { resposta: "Sim", processo_id: "ins" },
  { resposta: "Sim", processo_id: "des" },
]);
const EMBALAR = pergunta("embalar", [{ resposta: "Sim", processo_id: "emb" }]);
const sim = (id: string): RespostaDoItem => ({ pergunta_id: id, pergunta: id, resposta: "Sim" });

const processos: ProcessoDaResposta[] = [
  { id: "lam", nome: "Laminação", medida_cobrada: "area", produto_servico_id: "s-lam" },
  { id: "ins", nome: "Instalação", medida_cobrada: "informar", produto_servico_id: "s-ins" },
  { id: "des", nome: "Deslocamento", medida_cobrada: "informar", produto_servico_id: "s-des" },
  { id: "emb", nome: "Embalagem", medida_cobrada: null, produto_servico_id: null },
];
const servicos = [
  { id: "s-lam", nome: "Laminação de adesivo", unidade: "m2", preco_base: 28 },
  { id: "s-ins", nome: "Instalação em campo", unidade: "h", preco_base: 130 },
  { id: "s-des", nome: "Deslocamento", unidade: "km", preco_base: "4.50" },
];
const conta = (over: Partial<Parameters<typeof cobrancasDasRespostas>[0]> = {}) =>
  cobrancasDasRespostas({
    perguntas: [LAMINAR, INSTALAR, EMBALAR],
    respostas: [],
    processos,
    servicos,
    peca: { largura: 2, altura: 1, quantidade: 3 },
    informadas: {},
    linhasDoOrcamento: [],
    itemAtualId: null,
    ...over,
  });

describe("o que a resposta cobra (02/11/2026)", () => {
  it("sem resposta não cobra nada, e 'Não' também não", () => {
    expect(conta()).toEqual([]);
    expect(conta({ respostas: [{ pergunta_id: "laminar", pergunta: "laminar", resposta: "Não" }] })).toEqual([]);
  });

  it("laminação sai sozinha, pela área de todas as peças", () => {
    const [l] = conta({ respostas: [sim("laminar")] });
    expect(l).toMatchObject({ estado: "cobra", quantidade: 6, preco: 28, total: 168 });
  });

  it("instalação espera as horas e deslocamento espera os km: nada de palpite", () => {
    const sem = conta({ respostas: [sim("instalar")] });
    expect(sem.map((c) => c.estado)).toEqual(["falta_quantidade", "falta_quantidade"]);
    expect(totalDasCobrancas(sem)).toBe(0);
    const com = conta({ respostas: [sim("instalar")], informadas: { ins: 2, des: 10 } });
    expect(com.map((c) => c.total)).toEqual([260, 45]);
    expect(totalDasCobrancas(com)).toBe(305);
  });

  it("processo sem serviço com preço é dito, e não soma", () => {
    const [e] = conta({ respostas: [sim("embalar")] });
    expect(e).toMatchObject({ estado: "sem_preco", total: 0 });
    const semPreco = conta({ respostas: [sim("laminar")], servicos: [{ ...servicos[0], preco_base: 0 }] });
    expect(semPreco[0].estado).toBe("sem_preco");
  });

  it("peça sem medida não cobra a área: pede a medida", () => {
    const [l] = conta({ respostas: [sim("laminar")], peca: { largura: 0, altura: 0, quantidade: 1 } });
    expect(l.estado).toBe("falta_medida");
  });

  it("a visita é uma só: a segunda peça não cobra instalação de novo", () => {
    const linhas = [{ id: "x", produto_id: "s-ins", gerado_por_item_id: "outro" }];
    const c = conta({ respostas: [sim("instalar")], informadas: { ins: 2, des: 10 }, linhasDoOrcamento: linhas });
    expect(c.map((x) => x.estado)).toEqual(["ja_no_orcamento", "cobra"]);
  });

  it("laminação é de cada peça: a de outro item não conta, a digitada à mão sim", () => {
    const deOutro = [{ id: "x", produto_id: "s-lam", gerado_por_item_id: "outro" }];
    expect(conta({ respostas: [sim("laminar")], linhasDoOrcamento: deOutro })[0].estado).toBe("cobra");
    const aMao = [{ id: "x", produto_id: "s-lam", gerado_por_item_id: null }];
    expect(conta({ respostas: [sim("laminar")], linhasDoOrcamento: aMao })[0].estado).toBe("ja_no_orcamento");
  });

  it("a linha do próprio item em edição não vira 'já no orçamento'", () => {
    const minhas = [{ id: "x", produto_id: "s-ins", gerado_por_item_id: "eu", quantidade: 2 }];
    const c = conta({ respostas: [sim("instalar")], informadas: { ins: 2, des: 1 }, linhasDoOrcamento: minhas, itemAtualId: "eu" });
    expect(c[0].estado).toBe("cobra");
  });
});

describe("as linhas presas ao item", () => {
  const cobrando = conta({ respostas: [sim("laminar")] });

  it("item novo insere", () => {
    expect(planoDasLinhas(cobrando, []).inserir.map((c) => c.processo_id)).toEqual(["lam"]);
  });

  it("medida mudou: atualiza; igual: não mexe", () => {
    expect(planoDasLinhas(cobrando, [{ id: "a", produto_id: "s-lam", quantidade: 2 }]).atualizar).toEqual([{ id: "a", quantidade: 6 }]);
    expect(planoDasLinhas(cobrando, [{ id: "a", produto_id: "s-lam", quantidade: "6" }])).toEqual({ inserir: [], atualizar: [], apagar: [] });
  });

  it("resposta virou 'Não': a cobrança sai", () => {
    expect(planoDasLinhas([], [{ id: "a", produto_id: "s-lam", quantidade: 6 }]).apagar).toEqual(["a"]);
  });

  it("apagar as horas tira a instalação", () => {
    const semHoras = conta({ respostas: [sim("instalar")], informadas: { des: 10 } });
    const plano = planoDasLinhas(semHoras, [{ id: "a", produto_id: "s-ins", quantidade: 2 }]);
    expect(plano.apagar).toEqual(["a"]);
    expect(plano.inserir.map((c) => c.processo_id)).toEqual(["des"]);
  });

  it("o texto diz de qual peça é a laminação; a visita vale para o serviço todo", () => {
    expect(descricaoDaLinha(cobrando[0], " Adesivo vinil ")).toBe("Laminação de adesivo: Adesivo vinil");
    const ins = conta({ respostas: [sim("instalar")], informadas: { ins: 1 } })[0];
    expect(descricaoDaLinha(ins, "Adesivo vinil")).toBe("Instalação em campo");
    expect(rotuloDaQuantidade("h")).toBe("Horas");
    expect(rotuloDaQuantidade("km")).toBe("Km");
  });
});

describe("o contrato com o banco e a tela", () => {
  const m = ler("supabase/migrations/20261102140000_resposta_que_cobra.sql");
  const rota = ler("src/routes/_authenticated/orcamentos.$id.tsx");
  const tela = ler("src/components/orcamento/cobranca-das-respostas.tsx");

  it("a coluna nova chega às três views, com leitura liberada", () => {
    expect(m).toContain("GRANT SELECT (gerado_por_item_id) ON public.orcamento_itens TO authenticated;");
    expect(m.match(/gerado_por_item_id\n/g)?.length).toBe(3);
    expect(m).toContain("ON DELETE CASCADE");
  });

  it("salvar o item grava a cobrança, e a falha é dita", () => {
    expect(rota).toContain("await gravarLinhasDasRespostas({");
    expect(rota).toContain("a cobrança das respostas não entrou");
    expect(rota).toContain("ficou de fora do orçamento");
    expect(tela).toContain('throw new Error(`${c.nome} não entrou no orçamento.`)');
  });

  it("copiar o item leva a cobrança junto", () => {
    expect(rota).toContain("gerado_por_item_id: novo.id");
  });

  it("segue as regras da tela", () => {
    expect(/\stitle=/.test(tela)).toBe(false);
    expect(/(?<![-\w])text-primary(?![-\w])/.test(tela)).toBe(false);
  });
});
