import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { casaComABusca } from "../src/domain/catalogo/busca-do-produto";
import { acabamentoFicaForaDoCusto, custoDasEtapasDeAcabamento, pendenciaDaPergunta } from "../src/domain/catalogo/pasta-do-produto";
import { tipoDoProduto } from "../src/domain/orcamentos/tipos-de-produto";
import { fichaDoProduto, servicoComCustoInteiro } from "../src/domain/precos/tabela-de-precos";
import { materiaisDoProduto } from "../src/domain/precificacao/simulador";
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

describe("a conta dupla do serviço (02/11/2026)", () => {
  const m = ler("supabase/migrations/20261102120500_servico_com_custo_digitado_nao_soma_tempo.sql");
  const plotter = { base_cobranca: "area", velocidade_m2_h: 14 };

  it("o digitado do serviço é o custo inteiro; o do brinde, não", () => {
    expect(servicoComCustoInteiro({ tipo: "servico", temReceita: false, custo: 0.24 })).toBe(true);
    expect(servicoComCustoInteiro({ tipo: "produto", temReceita: false, custo: 30 })).toBe(false);
    expect(servicoComCustoInteiro({ tipo: "servico", temReceita: true, custo: 4 })).toBe(false);
    expect(servicoComCustoInteiro({ tipo: "servico", temReceita: false, custo: 0 })).toBe(false);
  });

  it("a ficha não acusa falta de mão de obra no serviço inteiro", () => {
    const f = fichaDoProduto({ tipo: "servico", categoria: "acabamento", temReceita: false, minutos: 1, temMaquina: false, composicao: { material: 0.24, maquina: 0, maoDeObra: 0, indireto: 0 } });
    expect(f).toEqual({ nivel: "completa", faltas: [] });
  });

  it("o cartão só soma o acabamento quando o custo conta pela velocidade da máquina", () => {
    expect(acabamentoFicaForaDoCusto({ tipo: "produto", unidade: "m2", maquina: plotter })).toBe(true);
    expect(acabamentoFicaForaDoCusto({ tipo: "produto", unidade: "m²", maquina: plotter })).toBe(true);
    expect(acabamentoFicaForaDoCusto({ tipo: "servico", unidade: "m2", maquina: plotter })).toBe(false);
    expect(acabamentoFicaForaDoCusto({ tipo: "produto", unidade: "m2", maquina: { base_cobranca: "tempo", velocidade_m2_h: null } })).toBe(false);
    expect(acabamentoFicaForaDoCusto({ tipo: "produto", unidade: "un", maquina: plotter })).toBe(false);
    expect(acabamentoFicaForaDoCusto({ tipo: "produto", unidade: "m2", maquina: null })).toBe(false);
  });

  it("o simulador diz que a linha do serviço já traz o tempo", () => {
    const r = materiaisDoProduto({ unidade: "m", custo_medio: "0.24", tipo: "servico" }, [], [], () => "c");
    expect(r.linhas[0].nome).toContain("já com tempo e rateio");
    expect(ler("src/routes/_authenticated/precificacao.tsx")).toContain('r.origem === "custo_do_produto" && produto.tipo === "servico"');
  });

  it("a função zera as somas só do serviço inteiro, e as horas ficam", () => {
    expect(m).toContain("v_servico_inteiro := p.tipo = 'servico';");
    expect(m).toContain("v_maquina := 0; v_mao := 0; v_indireto := 0;");
    expect(m).toContain("'horas_mao_obra', round(v_h_mo, 4)");
    expect(m).toContain("SELECT public.sincronizar_precificacao_do_produto(p.id)");
  });

  it("a view continua com o digitado no material e não acusa o serviço inteiro", () => {
    expect(m).toContain("COALESCE(NULLIF(pp.custo_material, (0)::numeric), pr.custo_medio, (0)::numeric) AS custo_material");
    expect(m).toContain("AND NOT inteiro.servico) AS sem_mao_de_obra");
  });
});

describe("o Banner em lona 440g (02/11/2026)", () => {
  const m = ler("supabase/migrations/20261102130000_banner_em_lona_440g.sql");
  it("é produto próprio a R$ 89,90, com a lona certa", () => {
    expect(m).toContain("21.23, 89.90");
    expect(m).toContain("('Lona 440g reforçada', 1.0, false)");
    expect(m).toContain("AND q.pergunta = 'Em qual lona?'");
  });
  it("não se oferece a todo cliente", () => {
    expect(m).toContain("Ofereça só quando o cliente pedir mais resistência");
    const aposDelete = m.slice(m.indexOf("-- O Banner 280 g aponta"));
    expect(aposDelete).not.toContain("Quer a lona comum");
  });
  it("cai no tipo Lona e banner, como o de 280 g", () => {
    const base = { categoria: "comunicacao_visual", familia: "Banners", unidade: "m2" };
    const novo = tipoDoProduto({ ...base, nome: "Banner com bastão e corda (lona 440g)" } as Parameters<typeof tipoDoProduto>[0]);
    const atual = tipoDoProduto({ ...base, nome: "Banner com bastão e corda" } as Parameters<typeof tipoDoProduto>[0]);
    expect(novo.chave).toBe(atual.chave);
  });
});
