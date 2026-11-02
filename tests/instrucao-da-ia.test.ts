import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  interpretarLeitura,
  linhaDoItem,
  montarPerguntaDoOrcamento,
  respostasDaIa,
  type ProdutoParaIa,
} from "../src/domain/orcamentos/orcamento-com-ia";
import {
  perguntaDaLinha,
  respostaDefinidaParaIa,
  type PerguntaDoProduto,
} from "../src/domain/orcamentos/perguntas-do-item";

const ler = (c: string) => readFileSync(c, "utf8");
const pergunta = (id: string, over: Partial<PerguntaDoProduto> = {}): PerguntaDoProduto => ({
  id, pergunta: id, descricao: null, obrigatoria: false, tipo_resposta: "unica", respostas: ["Sim", "Não"], acoes: [], ordem: 0, ia_modo: "perguntar", ...over,
});
const APLICAR = pergunta("aplicar", { ia_instrucao: "Pergunte sempre." });
const EMBALAR = pergunta("embalar", { ia_modo: "definir", ia_resposta: "Não" });
const GRAVAR = pergunta("gravar", { ia_modo: "seguir_cliente" });
const produto: ProdutoParaIa = {
  id: "p", nome: "Adesivo", unidade: "m2", tipo: "produto", personalidade: "o que é", como_medir: "medir", perguntas: "roteiro",
  checklist: [APLICAR, EMBALAR, GRAVAR],
};

describe("os três modos da IA (02/11/2026)", () => {
  it("o que a casa definiu entra sempre, sem a IA precisar dizer", () => {
    expect(respostasDaIa(produto, [])).toEqual([{ pergunta_id: "embalar", pergunta: "embalar", resposta: "Não" }]);
  });

  it("a casa manda: a IA não troca o que está definido", () => {
    const r = respostasDaIa(produto, [{ pergunta_id: "embalar", resposta: "Sim" }]);
    expect(r.find((x) => x.pergunta_id === "embalar")?.resposta).toBe("Não");
  });

  it("o que o cliente respondeu entra, se é uma das opções", () => {
    const r = respostasDaIa(produto, [{ pergunta_id: "aplicar", resposta: "Sim" }]);
    expect(r.find((x) => x.pergunta_id === "aplicar")?.resposta).toBe("Sim");
  });

  it("resposta inventada ou pergunta de fora não vira cobrança", () => {
    const r = respostasDaIa(produto, [
      { pergunta_id: "aplicar", resposta: "Talvez" },
      { pergunta_id: "outra", resposta: "Sim" },
    ]);
    expect(r.map((x) => x.pergunta_id)).toEqual(["embalar"]);
  });

  it("resposta que não é lista entra como veio", () => {
    const texto = pergunta("cor", { tipo_resposta: "texto", respostas: [] });
    expect(respostasDaIa({ ...produto, checklist: [texto] }, [{ pergunta_id: "cor", resposta: " Azul " }])[0].resposta).toBe("Azul");
  });

  it("a pergunta definida não chega à IA; as outras chegam com o modo e a instrução", () => {
    const m = montarPerguntaDoOrcamento("2 adesivos", [produto]);
    const lista = JSON.parse(m[1].content.split("\n")[1])[0];
    expect(lista.checklist.map((q: { id: string }) => q.id)).toEqual(["aplicar", "gravar"]);
    expect(lista.checklist[0]).toMatchObject({ como: "perguntar", instrucao: "Pergunte sempre.", opcoes: ["Sim", "Não"] });
    expect(m[1].content).not.toMatch(/preco|custo/i);
  });

  it("modo inválido do banco vira perguntar; definir sem resposta não define", () => {
    expect(perguntaDaLinha({ id: "x", pergunta: "y", ia_modo: "qualquer" }).ia_modo).toBe("perguntar");
    expect(respostaDefinidaParaIa(pergunta("x", { ia_modo: "definir", ia_resposta: null }))).toBeNull();
    expect(respostaDefinidaParaIa(pergunta("x", { nao_perguntar: true, resposta_padrao: "Sim" }))).toBe("Sim");
  });

  it("a leitura traz as respostas, e elas vão para a linha do item", () => {
    const l = interpretarLeitura(
      { titulo: "t", itens: [{ produto_id: "p", quantidade: 2, largura_m: 1, altura_m: 1, respostas: [{ pergunta_id: "aplicar", resposta: "Sim" }] }] },
      [produto],
    );
    expect(l?.itens[0].respostas?.map((r) => r.pergunta_id)).toEqual(["aplicar", "embalar"]);
    expect(linhaDoItem(l!.itens[0], 55, 0).respostas).toHaveLength(2);
  });
});

describe("o contrato", () => {
  const m = ler("supabase/migrations/20261102150000_instrucao_da_ia_e_parametros_das_maquinas.sql");
  const servidor = ler("src/lib/api/orcamento-ia.functions.ts");
  it("o banco barra definir sem resposta", () => {
    expect(m).toContain("CHECK (ia_modo <> 'definir' OR btrim(COALESCE(ia_resposta, '')) <> '')");
  });
  it("cada máquina tem o limite real no roteiro", () => {
    for (const fato of ["1,00 x 0,60 m", "20 x 20 cm por face", "25,6 x 25,6 x 25,6 cm", "1,20 m de boca", "lona de 1,60 m"]) expect(m).toContain(fato);
  });
  it("o rascunho confere as respostas contra o banco, grava a cobrança e avisa o que falta", () => {
    expect(servidor).toContain("ids.has(r.pergunta_id)");
    expect(servidor).toContain("gerado_por_item_id: linha[0].id");
    expect(servidor).toContain("informe a quantidade no item");
  });
  it("o que a resposta já cobrou não entra de novo como acabamento", () => {
    expect(servidor).toContain("dosAcabamentos.filter((d) => !cobrados.has(d.produto_id))");
  });
  it("o corte do acrílico não vira acabamento", () => {
    expect(ler("supabase/migrations/20261102160000_laser_nao_cobra_corte_de_novo.sql")).toContain("nunca marque Corte a laser como acabamento");
  });
  it("item sem preço de tabela é dito ao criar o rascunho", () => {
    expect(servidor).toContain("sem preço de tabela para");
  });
  it("os produtos de medida fixa têm o recorte na sequência e o limite no roteiro", () => {
    const f = ler("supabase/migrations/20261102180000_limites_dos_produtos_de_medida_fixa.sql");
    expect(f).toContain("pr.nome = 'Recorte eletrônico'");
    expect(f).toContain("ia_resposta = 'Veículo'");
    for (const sku of ["ADE-PRG07", "ADE-PRG10", "ADE-PGA15", "ADE-PGA30", "ADE-BOL33", "ADE-BLO48", "ADE-TES90", "ADE-P9033", "ADE-P9050", "FAC-LUM"]) expect(f).toContain(sku);
  });
  it("a tela da pasta edita a instrução, e a gravação é conferida", () => {
    const pasta = ler("src/routes/_authenticated/produtos_.$id.tsx");
    expect(pasta).toContain("<InstrucaoDaIa");
    expect(pasta).toContain("Instrução da IA salva.");
  });
});
