import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { casaComABusca } from "../src/domain/catalogo/busca-do-produto";
import { custoDasEtapasDeAcabamento, pendenciaDaPergunta } from "../src/domain/catalogo/pasta-do-produto";
import {
  comRespostasPadrao,
  pendenciasDasRespostas,
  perguntaDaLinha,
  responder,
  type PerguntaDoProduto,
} from "../src/domain/orcamentos/perguntas-do-item";
import { montarPerguntaDoOrcamento } from "../src/domain/orcamentos/orcamento-com-ia";

const ler = (c: string) => readFileSync(c, "utf8");

describe("o custo do acabamento na pasta (02/11/2026)", () => {
  const impressao = { nome: "Impressão", etapa: "producao", base_produtividade: "m2_h" as const, setup_min: 5, produtividade_m2_h: 14 };
  const refile = { nome: "Refile", etapa: "acabamento", base_produtividade: "m_h" as const, setup_min: 5, produtividade_m2_h: null, produtividade_m_h: 100 };
  const bastao = { nome: "Bastão", etapa: "acabamento", base_produtividade: "tempo_do_produto" as const, setup_min: 0, produtividade_m2_h: null };

  it("soma só o acabamento: a impressão já está no custo cheio", () => {
    const r = custoDasEtapasDeAcabamento([impressao, refile], { largura: 1, altura: 1 }, 24);
    expect(r.linhas).toEqual([{ nome: "Refile", minutos: 7.4, custo: 2.96 }]);
    expect(r.total).toBe(2.96);
  });

  it("etapa sem tempo próprio é dita, não vira o tempo inteiro do produto", () => {
    const r = custoDasEtapasDeAcabamento([bastao], { largura: 1, altura: 1 }, 24);
    expect(r.linhas).toEqual([]);
    expect(r.semNumero).toEqual(["Bastão"]);
    expect(r.total).toBe(0);
  });

  it("a aba Preço mostra a composição e só o nível financeiro a recebe", () => {
    const pasta = ler("src/routes/_authenticated/produtos_.$id.tsx");
    expect(pasta).toMatch(/nivelDeVisao === "financeiro" && \(\s*<CustoDaPeca/);
    expect(pasta).toContain('rotulo="Custo do cadastro"');
    expect(ler("src/components/produtos/custo-da-peca.tsx")).toContain('.from("produto_precificacao")');
  });
});

describe("a resposta que a casa já decidiu", () => {
  const embalar: PerguntaDoProduto = {
    id: "e", pergunta: "Embalar?", descricao: null, obrigatoria: true, tipo_resposta: "unica",
    respostas: ["Sim", "Não"], acoes: [], ordem: 0, resposta_padrao: "Não", nao_perguntar: true,
  };
  const suporte: PerguntaDoProduto = { ...embalar, id: "s", pergunta: "Suporte?", nao_perguntar: false, resposta_padrao: "Sim" };
  const cores: PerguntaDoProduto = { ...embalar, id: "c", pergunta: "Cores?", tipo_resposta: "multipla", resposta_padrao: "Azul", nao_perguntar: false };

  it("sem resposta dada, o padrão entra; a múltipla vira lista", () => {
    const r = comRespostasPadrao([embalar, cores], []);
    expect(r.map((x) => x.resposta)).toEqual(["Não", ["Azul"]]);
  });

  it("o que alguém respondeu fica, e sem nada a fazer a lista é a mesma", () => {
    const dada = responder([], suporte, "Não");
    const r = comRespostasPadrao([suporte], dada);
    expect(r).toBe(dada);
  });

  it("a pergunta que não se faz não segura o item", () => {
    expect(pendenciasDasRespostas([embalar], [])).toEqual([]);
    expect(pendenciasDasRespostas([suporte], [])).toEqual([suporte]);
  });

  it("não perguntar sem resposta é lixo do banco: volta a perguntar", () => {
    const p = perguntaDaLinha({ id: "x", pergunta: "Y?", nao_perguntar: true, resposta_padrao: " " });
    expect(p.nao_perguntar).toBe(false);
    expect(p.resposta_padrao).toBeNull();
  });

  it("o cadastro exige a resposta e a resposta da lista", () => {
    const base = { pergunta: "Embalar?", tipo_resposta: "unica" as const, respostas: ["Sim", "Não"], acoes: [] };
    expect(pendenciaDaPergunta({ ...base, nao_perguntar: true })).toBe("Sem perguntar, diga qual é a resposta.");
    expect(pendenciaDaPergunta({ ...base, resposta_padrao: "Talvez" })).toContain("não está na lista");
    expect(pendenciaDaPergunta({ ...base, resposta_padrao: "Não", nao_perguntar: true })).toBeNull();
  });

  it("a IA recebe o definido, os apelidos e os tamanhos, e nenhum preço", () => {
    const m = montarPerguntaDoOrcamento("uma faixa de rua", [
      {
        id: "p", nome: "Faixa em lona", unidade: "m2", tipo: "produto", personalidade: null, como_medir: null, perguntas: null,
        apelidos: ["faixa de rua"],
        tamanhos: [{ nome: "3 x 0,7", largura: 3, altura: 0.7, quando_usar: "Rua" }],
        ja_definido: [{ pergunta: "Embalar?", resposta: "Não" }],
      },
    ]);
    expect(m[1].content).toContain('"tambem_conhecido_como":["faixa de rua"]');
    expect(m[1].content).toContain('"ja_definido":[{"pergunta":"Embalar?","resposta":"Não"}]');
    expect(m[0].content).toContain("Nunca coloque em perguntas_que_faltam");
    expect(m[1].content).not.toMatch(/preco|custo/i);
  });
});

describe("a busca pelo nome que o cliente usa", () => {
  it("acha pelo apelido e sem acento", () => {
    expect(casaComABusca("Lona 280g", ["faixa de rua"], "Faixa de Rua")).toBe(true);
    expect(casaComABusca("Bainha + ilhós", [], "ilhos")).toBe(true);
    expect(casaComABusca("Lona 280g", ["faixa de rua"], "camiseta")).toBe(false);
    expect(casaComABusca("Lona 280g", [], "   ")).toBe(false);
  });
});

describe("o Banner e a migração (02/11/2026)", () => {
  const m = ler("supabase/migrations/20261102110000_etapas_apelidos_e_respostas_definidas.sql");
  it("a lona principal do Banner é a 280 g; a 440 g só com o aviso do preço", () => {
    expect(m).toContain("Lona 280g, bastão e corda inclusos. Sob pedido, em lona 440g, com outro preço.");
    expect(m).toContain("'Lona 280 g'\n  FROM public.produtos p");
    expect(m).toContain("('BAN-LON', 'Bastão, ponteira e corda', 2)");
  });
  it("nenhuma pergunta nasce sem ser feita: isso é decisão do dono", () => {
    expect(m).not.toMatch(/nao_perguntar\)\s*(VALUES|SELECT)/);
  });
  it("a tela e a IA leem as colunas novas", () => {
    expect(ler("src/components/orcamento/perguntas-do-item.tsx")).toContain("resposta_padrao, nao_perguntar");
    expect(ler("src/lib/api/orcamento-ia.functions.ts")).toContain("produto_id, apelidos, ia_personalidade");
    expect(ler("src/routes/_authenticated/orcamentos.$id.tsx")).toContain("padrao, quando_usar");
  });
});
