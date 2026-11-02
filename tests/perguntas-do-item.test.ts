import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  acabamentoAjustado,
  normalizarRespostas,
  pendenciasDasRespostas,
  perguntaDaLinha,
  processosDasRespostas,
  responder,
  resumoDasRespostas,
  type PerguntaDoProduto,
} from "../src/domain/orcamentos/perguntas-do-item";

/**
 * Perguntas do produto no item do orçamento (02/11/2026): respondidas na hora
 * de orçar, gravadas no item, e a resposta que acrescenta processo entra no
 * acabamento. Não mexe no preço enquanto a produtividade dos processos estiver
 * vazia.
 */

const ler = (c: string) => readFileSync(c, "utf8");

const APLICACAO: PerguntaDoProduto = {
  id: "p1",
  pergunta: "O adesivo deverá ser aplicado por nós?",
  descricao: null,
  obrigatoria: true,
  tipo_resposta: "unica",
  respostas: ["Sim", "Não"],
  acoes: [{ resposta: "Sim", processo_id: "proc-aplicacao" }],
  ordem: 0,
};
const EMBALAGEM: PerguntaDoProduto = {
  id: "p2",
  pergunta: "Como embalar?",
  descricao: "Caixa ou bobina.",
  obrigatoria: false,
  tipo_resposta: "multipla",
  respostas: ["Caixa", "Bobina"],
  acoes: [
    { resposta: "Caixa", processo_id: "proc-caixa" },
    { resposta: "Bobina", processo_id: "proc-bobina" },
  ],
  ordem: 1,
};
const PESSOAS: PerguntaDoProduto = { id: "p3", pergunta: "Quantas pessoas?", descricao: null, obrigatoria: true, tipo_resposta: "numero", respostas: [], acoes: [], ordem: 2 };

describe("ler a pergunta do banco e as respostas do item", () => {
  it("limpa listas, aceita só os tipos conhecidos e descarta ação sem processo", () => {
    const p = perguntaDaLinha({
      id: "x", pergunta: " Suporte? ", descricao: "", obrigatoria: null, tipo_resposta: "esquisito",
      respostas: ["Sim", " ", 3, "Não"], acoes: [{ resposta: "Sim", processo_id: "a" }, { resposta: "Sim" }, "lixo"], ordem: "2",
    });
    expect(p.pergunta).toBe("Suporte?");
    expect(p.descricao).toBeNull();
    expect(p.obrigatoria).toBe(true);
    expect(p.tipo_resposta).toBe("unica");
    expect(p.respostas).toEqual(["Sim", "Não"]);
    expect(p.acoes).toEqual([{ resposta: "Sim", processo_id: "a" }]);
    expect(p.ordem).toBe(2);
  });

  it("respostas gravadas voltam limpas; lixo vira lista vazia", () => {
    expect(normalizarRespostas(null)).toEqual([]);
    expect(normalizarRespostas("x")).toEqual([]);
    expect(normalizarRespostas([{ pergunta_id: "p1", pergunta: "A?", resposta: " Sim " }, { pergunta: "sem id" }, { pergunta_id: "p3", pergunta: "N?", resposta: 2 }])).toEqual([
      { pergunta_id: "p1", pergunta: "A?", resposta: "Sim" },
      { pergunta_id: "p3", pergunta: "N?", resposta: "2" },
    ]);
  });
});

describe("responder, cobrar as obrigatórias e achar os processos", () => {
  it("responder troca a resposta; vazio tira a linha", () => {
    let r = responder([], APLICACAO, "Sim");
    expect(r).toEqual([{ pergunta_id: "p1", pergunta: APLICACAO.pergunta, resposta: "Sim" }]);
    r = responder(r, EMBALAGEM, ["Caixa"]);
    expect(r).toHaveLength(2);
    r = responder(r, APLICACAO, "");
    expect(r.map((x) => x.pergunta_id)).toEqual(["p2"]);
    expect(responder(r, EMBALAGEM, [])).toEqual([]);
  });

  it("só as obrigatórias sem resposta seguram o item", () => {
    const perguntas = [APLICACAO, EMBALAGEM, PESSOAS];
    expect(pendenciasDasRespostas(perguntas, []).map((p) => p.id)).toEqual(["p1", "p3"]);
    const r = responder(responder([], APLICACAO, "Não"), PESSOAS, "2");
    expect(pendenciasDasRespostas(perguntas, r)).toEqual([]);
  });

  it("os processos vêm das respostas dadas, sem repetir", () => {
    const perguntas = [APLICACAO, EMBALAGEM];
    expect(processosDasRespostas(perguntas, [])).toEqual([]);
    const r = responder(responder([], APLICACAO, "Sim"), EMBALAGEM, ["Caixa", "Bobina"]);
    expect(processosDasRespostas(perguntas, r)).toEqual(["proc-aplicacao", "proc-caixa", "proc-bobina"]);
    expect(processosDasRespostas(perguntas, responder([], APLICACAO, "Não"))).toEqual([]);
  });
});

describe("o acabamento acompanha as respostas sem apagar o que foi escrito", () => {
  it("põe o processo novo, tira o que deixou de valer e preserva o texto da pessoa", () => {
    const depois = acabamentoAjustado("bainha + ilhós", [], ["Aplicação"]);
    expect(depois).toContain("bainha + ilhós");
    expect(depois).toContain("Aplicação");
    const trocado = acabamentoAjustado(depois, ["Aplicação"], ["Embalagem em caixa"]);
    expect(trocado).toContain("bainha + ilhós");
    expect(trocado).not.toContain("Aplicação");
    expect(trocado).toContain("Embalagem em caixa");
    // Já estava escrito: não duplica.
    expect(acabamentoAjustado(trocado, [], ["Embalagem em caixa"])).toBe(trocado);
  });

  it("o resumo lê como gente fala", () => {
    const r = responder(responder([], APLICACAO, "Sim"), EMBALAGEM, ["Caixa", "Bobina"]);
    expect(resumoDasRespostas(r)).toBe("O adesivo deverá ser aplicado por nós?: Sim · Como embalar?: Caixa, Bobina");
  });
});

describe("a tela do item e o banco", () => {
  it("o item grava e recarrega `respostas`, mostra as perguntas e segura as obrigatórias", () => {
    const rota = ler("src/routes/_authenticated/orcamentos.$id.tsx");
    expect(rota.includes("<PerguntasDoItem")).toBe(true);
    expect(rota.includes("respostas: form.respostas,")).toBe(true);
    expect(rota.includes("respostas: normalizarRespostas(i.respostas),")).toBe(true);
    expect(rota.includes("pendenciasDasRespostas(perguntasDoItem.data ?? [], form.respostas)")).toBe(true);
    const tela = ler("src/components/orcamento/perguntas-do-item.tsx");
    expect(tela.includes('.from("produto_perguntas")')).toBe(true);
    expect(tela.includes("Responda antes de adicionar o item.")).toBe(true);
    expect(/\stitle=/.test(tela)).toBe(false);
    expect(/(?<![-\w])text-primary(?![-\w])/.test(tela)).toBe(false);
  });

  it("a coluna entra na tabela e nas três views de itens, com as opções de cada view", () => {
    const m = ler("supabase/migrations/20261102003000_respostas_do_item.sql");
    expect(m.includes("ALTER TABLE public.orcamento_itens ADD COLUMN IF NOT EXISTS respostas jsonb NOT NULL DEFAULT '[]'::jsonb")).toBe(true);
    for (const v of ["orcamento_itens_operacional", "orcamento_itens_comercial", "orcamento_itens_financeiro"]) {
      expect(m.includes(`CREATE OR REPLACE VIEW public.${v}\nWITH (`), v).toBe(true);
    }
    expect((m.match(/\n\s+(i\.|oi\.|o\.)?respostas\n/g) ?? []).length).toBe(3);
    const tipos = ler("src/integrations/supabase/types.ts");
    for (const v of ["orcamento_itens", "orcamento_itens_operacional", "orcamento_itens_comercial", "orcamento_itens_financeiro"]) {
      const inicio = tipos.indexOf(`      ${v}: {`);
      expect(inicio, v).toBeGreaterThan(0);
      expect(tipos.slice(inicio, inicio + 2600).includes("respostas: Json"), v).toBe(true);
    }
  });
});
