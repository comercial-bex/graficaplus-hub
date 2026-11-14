import { describe, expect, it } from "vitest";
import {
  casamentosDaPergunta,
  fraseCasa,
  normalizarPerguntaDaBase,
  respostaQueServiria,
  separarOsOutros,
} from "../../src/domain/agente-base/casar";
import {
  contadorDeAprovadas,
  contarPorStatus,
  filtrarPorStatus,
  frasesGatilhoDoTexto,
  ordenarPorFrequencia,
  produtosParaEscolher,
  proximaDaFila,
  ramosEmTexto,
  rotuloDaOpcaoDeProduto,
  rotuloDoProduto,
  salvarDepoisAprovar,
  SalvouMasNaoAprovou,
} from "../../src/domain/agente-base/fila";
import type { ProdutoDaBase, RespostaDaBase } from "../../src/domain/agente-base/tipos";

let n = 0;
function r(p: Partial<RespostaDaBase>): RespostaDaBase {
  n += 1;
  return {
    id: `id-${n}`,
    tema: `tema_${n}`,
    pergunta: `Pergunta ${n}`,
    frases_gatilho: [],
    ramos: ["cliente"],
    produto_id: null,
    familia: null,
    resposta: "Isso a equipe confirma.",
    status: "aprovada",
    texto_aprovado: null,
    versao: 1,
    aprovada_por: null,
    aprovada_em: null,
    origem: "semente",
    contagem_ocorrencias: 0,
    atualizado_em: "2026-11-14T12:00:00Z",
    ...p,
  };
}
const CLIENTE = { ramo: "cliente" } as const;

describe("a normalização é a do banco", () => {
  it("minúsculas, sem acento, sem pontuação, letras repetidas viram uma, espaço único", () => {
    expect(normalizarPerguntaDaBase("Quanto É o Frete?")).toBe("quanto e o frete");
    expect(normalizarPerguntaDaBase("  Horáááário,   de atendimento!! ")).toBe("horario de atendimento");
    expect(normalizarPerguntaDaBase("Cartão 4x4")).toBe("cartao 4x4");
    expect(normalizarPerguntaDaBase("")).toBe("");
    expect(normalizarPerguntaDaBase(null)).toBe("");
  });

  it("não reduz dígitos repetidos", () => {
    expect(normalizarPerguntaDaBase("CEP 00000-000")).toBe("cep 00000 000");
  });
});

describe("a frase casa por palavras inteiras", () => {
  it("achada no meio, no começo e no fim", () => {
    expect(fraseCasa("oi qual o prazo de entrega", "prazo")).toBe(true);
    expect(fraseCasa("prazo", "prazo")).toBe(true);
    expect(fraseCasa("qual o prazo", "qual o prazo")).toBe(true);
  });

  it("não casa por dentro de outra palavra nem fora de ordem", () => {
    expect(fraseCasa("fretes grandes demais", "frete")).toBe(false);
    expect(fraseCasa("o prazo de entrega", "entrega de prazo")).toBe(false);
    expect(fraseCasa("preciso do prazo", "")).toBe(false);
    expect(fraseCasa("", "prazo")).toBe(false);
  });
});

describe("a resposta que serviria: só aprovada, só por frase gatilho", () => {
  const horario = r({ tema: "horario", frases_gatilho: ["horario", "que horas abre"], contagem_ocorrencias: 16 });
  const endereco = r({ tema: "endereco", frases_gatilho: ["endereco", "onde fica"], contagem_ocorrencias: 9 });

  it("acha pela frase, ignorando acento, maiúscula e pontuação", () => {
    const c = respostaQueServiria("Oi! QUE HORAS ABRE hoje??", [horario, endereco], CLIENTE);
    expect(c?.resposta.tema).toBe("horario");
    expect(c?.frase).toBe("que horas abre");
    expect(c?.serviria).toBe(true);
  });

  it("sem frase que case, não serve nada (não adivinha, não usa semelhança)", () => {
    expect(respostaQueServiria("quero um banner de 2 metros", [horario, endereco], CLIENTE)).toBeNull();
    expect(respostaQueServiria("horarioo", [horario], CLIENTE)).toBeNull();
    expect(respostaQueServiria("", [horario], CLIENTE)).toBeNull();
  });

  it("rascunho e arquivada nunca servem, mas aparecem como casamento que ainda não serve", () => {
    const rascunho = r({ tema: "prazo", status: "rascunho", frases_gatilho: ["prazo"] });
    const arquivada = r({ tema: "frete", status: "arquivada", frases_gatilho: ["frete"] });
    expect(respostaQueServiria("qual o prazo e o frete", [rascunho, arquivada], CLIENTE)).toBeNull();
    const todos = casamentosDaPergunta("qual o prazo e o frete", [rascunho, arquivada], CLIENTE);
    expect(todos.map((x) => [x.resposta.tema, x.serviria])).toEqual([
      ["prazo", false],
      ["frete", false],
    ]);
  });

  it("só serve a resposta do ramo da conversa", () => {
    const soParceiro = r({ tema: "so_parceiro", ramos: ["parceiro"], frases_gatilho: ["cadastro"] });
    const ambos = r({ tema: "ambos", ramos: ["cliente", "parceiro"], frases_gatilho: ["cadastro"] });
    expect(respostaQueServiria("como faço o cadastro", [soParceiro], CLIENTE)).toBeNull();
    expect(respostaQueServiria("como faço o cadastro", [soParceiro], { ramo: "parceiro" })?.resposta.tema).toBe("so_parceiro");
    expect(respostaQueServiria("como faço o cadastro", [ambos], CLIENTE)?.resposta.tema).toBe("ambos");
    expect(respostaQueServiria("como faço o cadastro", [ambos], { ramo: "parceiro" })?.resposta.tema).toBe("ambos");
  });

  it("produto vale mais que família, que vale mais que a geral", () => {
    const geral = r({ tema: "geral", frases_gatilho: ["medida"], contagem_ocorrencias: 99 });
    const daFamilia = r({ tema: "familia", familia: "Banners", frases_gatilho: ["medida"] });
    const doProduto = r({ tema: "produto", produto_id: "p1", familia: "Banners", frases_gatilho: ["medida"] });
    const todas = [geral, daFamilia, doProduto];
    expect(respostaQueServiria("qual medida", todas, { ramo: "cliente", produtoId: "p1", familia: "Banners" })?.resposta.tema).toBe("produto");
    expect(respostaQueServiria("qual medida", todas, { ramo: "cliente", produtoId: "p2", familia: "Banners" })?.resposta.tema).toBe("familia");
    expect(respostaQueServiria("qual medida", todas, { ramo: "cliente", produtoId: "p3", familia: "Lonas" })?.resposta.tema).toBe("geral");
    expect(respostaQueServiria("qual medida", todas, CLIENTE)?.resposta.tema).toBe("geral");
  });

  it("resposta de um produto não serve para outro produto nem sem produto conhecido", () => {
    const doProduto = r({ tema: "produto", produto_id: "p1", frases_gatilho: ["medida"] });
    expect(respostaQueServiria("qual medida", [doProduto], { ramo: "cliente", produtoId: "p2" })).toBeNull();
    expect(respostaQueServiria("qual medida", [doProduto], CLIENTE)).toBeNull();
  });

  it("a família da resposta só descreve o assunto quando a conversa não tem família", () => {
    const instalacao = r({ tema: "instalacao", familia: "Instalação e deslocamento", frases_gatilho: ["instalacao"] });
    expect(respostaQueServiria("vocês fazem instalação", [instalacao], CLIENTE)?.resposta.tema).toBe("instalacao");
    expect(respostaQueServiria("vocês fazem instalação", [instalacao], { ramo: "cliente", familia: "Lonas frontlight" })).toBeNull();
  });

  it("a frase com mais palavras vence, depois a mais longa, depois a mais frequente", () => {
    const curta = r({ tema: "curta", frases_gatilho: ["prazo"], contagem_ocorrencias: 99 });
    const longa = r({ tema: "longa", frases_gatilho: ["prazo de entrega"], contagem_ocorrencias: 1 });
    expect(respostaQueServiria("qual o prazo de entrega", [curta, longa], CLIENTE)?.resposta.tema).toBe("longa");
    const a = r({ tema: "aaa", frases_gatilho: ["valor"], contagem_ocorrencias: 5 });
    const b = r({ tema: "bbb", frases_gatilho: ["valor"], contagem_ocorrencias: 7 });
    expect(respostaQueServiria("qual o valor", [a, b], CLIENTE)?.resposta.tema).toBe("bbb");
  });

  it("devolve só o que casa, sem repetir a mesma resposta por duas frases", () => {
    const x = r({ tema: "x", frases_gatilho: ["prazo", "quanto tempo demora"] });
    expect(casamentosDaPergunta("prazo e quanto tempo demora", [x], CLIENTE)).toHaveLength(1);
  });

  it("não escreve nada: não recebe cliente de banco nem de rede", () => {
    // a função é pura: duas chamadas iguais dão o mesmo resultado e não mexem na lista
    const lista = [horario, endereco];
    const copia = JSON.stringify(lista);
    const a = respostaQueServiria("onde fica", lista, CLIENTE);
    const b = respostaQueServiria("onde fica", lista, CLIENTE);
    expect(a?.resposta.tema).toBe(b?.resposta.tema);
    expect(JSON.stringify(lista)).toBe(copia);
  });
});

describe("a fila de aprovação", () => {
  const a = r({ tema: "a", status: "rascunho", contagem_ocorrencias: 10 });
  const b = r({ tema: "b", status: "rascunho", contagem_ocorrencias: 49 });
  const c = r({ tema: "c", status: "aprovada", contagem_ocorrencias: 20 });
  const d = r({ tema: "d", status: "arquivada", contagem_ocorrencias: 99 });
  const e = r({ tema: "e", status: "rascunho", contagem_ocorrencias: 10 });

  it("ordena pela frequência, e o empate pelo tema, para a ordem nunca mudar sozinha", () => {
    expect(ordenarPorFrequencia([a, b, c, d, e]).map((x) => x.tema)).toEqual(["d", "b", "c", "a", "e"]);
  });

  it("filtra por status e conta cada um", () => {
    expect(filtrarPorStatus([a, b, c, d, e], "rascunho").map((x) => x.tema)).toEqual(["b", "a", "e"]);
    expect(filtrarPorStatus([a, b, c, d, e], "todas")).toHaveLength(5);
    expect(contarPorStatus([a, b, c, d, e])).toEqual({ rascunho: 3, aprovada: 1, arquivada: 1, todas: 5 });
  });

  it("o contador diz N de total, sem contar as arquivadas", () => {
    expect(contadorDeAprovadas([a, b, c, d, e])).toEqual({ aprovadas: 1, total: 4, texto: "1 de 4 aprovadas" });
    expect(contadorDeAprovadas([]).texto).toBe("0 de 0 aprovadas");
    const quinze = Array.from({ length: 15 }, (_, i) => r({ tema: `t${i}`, status: i < 3 ? "aprovada" : "rascunho" }));
    expect(contadorDeAprovadas(quinze).texto).toBe("3 de 15 aprovadas");
  });

  it("a próxima é o rascunho seguinte da fila, e dá a volta no fim", () => {
    expect(proximaDaFila([a, b, c, d, e], null)?.tema).toBe("b");
    expect(proximaDaFila([a, b, c, d, e], b.id)?.tema).toBe("a");
    expect(proximaDaFila([a, b, c, d, e], e.id)?.tema).toBe("b");
    expect(proximaDaFila([c, d], null)).toBeNull();
    expect(proximaDaFila([a, b], "id-que-sumiu")?.tema).toBe("b");
  });

  it("escreve o ramo em português", () => {
    expect(ramosEmTexto(["cliente"])).toBe("Cliente final");
    expect(ramosEmTexto(["parceiro"])).toBe("Parceiro");
    expect(ramosEmTexto(["cliente", "parceiro"])).toBe("Cliente final e parceiro");
  });
});

describe("o ensaio separa a aprovada que perdeu no desempate do que ainda não serve", () => {
  const vence = r({ tema: "vence", frases_gatilho: ["prazo de entrega"], status: "aprovada" });
  const perde = r({ tema: "perde", frases_gatilho: ["prazo"], status: "aprovada" });
  const rascunho = r({ tema: "rascunho", frases_gatilho: ["prazo"], status: "rascunho" });
  const arquivada = r({ tema: "arquivada", frases_gatilho: ["entrega"], status: "arquivada" });

  it("a aprovada que perdeu NÃO vai para a lista dos que esperam aprovação", () => {
    const g = separarOsOutros(casamentosDaPergunta("qual o prazo de entrega", [vence, perde, rascunho, arquivada], CLIENTE));
    expect(g.serve?.resposta.tema).toBe("vence");
    expect(g.perderamNoDesempate.map((x) => x.resposta.tema)).toEqual(["perde"]);
    expect(g.aindaNaoServem.map((x) => x.resposta.tema).sort()).toEqual(["arquivada", "rascunho"]);
    // nenhuma aprovada na lista dos que "não servem até ser aprovada"
    expect(g.aindaNaoServem.every((x) => x.resposta.status !== "aprovada")).toBe(true);
  });

  it("sem aprovada, tudo o que casa está esperando aprovação e nada perdeu no desempate", () => {
    const g = separarOsOutros(casamentosDaPergunta("qual o prazo", [rascunho, arquivada], CLIENTE));
    expect(g.serve).toBeNull();
    expect(g.perderamNoDesempate).toEqual([]);
    expect(g.aindaNaoServem).toHaveLength(1);
  });

  it("sem casamento, os três vêm vazios", () => {
    expect(separarOsOutros([])).toEqual({ serve: null, perderamNoDesempate: [], aindaNaoServem: [] });
  });
});

describe("as frases gatilho do campo de edição contam como o banco", () => {
  it("uma linha só com pontuação ou emoji não é frase: zero frases", () => {
    expect(frasesGatilhoDoTexto("?").normalizadas).toEqual([]);
    expect(frasesGatilhoDoTexto("?\n!!!\n  \n...").normalizadas).toEqual([]);
    expect(frasesGatilhoDoTexto("?").cruas).toEqual(["?"]);
  });

  it("normaliza, tira o vazio e não repete", () => {
    expect(frasesGatilhoDoTexto("Quanto É o Frete?\nquanto e o frete\n\nPrazo!").normalizadas).toEqual([
      "quanto e o frete",
      "prazo",
    ]);
  });
});

describe("produto desativado continua visível", () => {
  const ativo: ProdutoDaBase = { id: "p1", nome: "Banner 440g", familia: "Banners", ativo: true };
  const velho: ProdutoDaBase = { id: "p2", nome: "Lona antiga", familia: "Lonas", ativo: false };
  const lista = [ativo, velho];

  it("o cartão diz Produto desativado e o nome", () => {
    expect(rotuloDoProduto("p2", lista)).toBe("Produto desativado: Lona antiga");
    expect(rotuloDoProduto("p1", lista)).toBe("Banner 440g");
    expect(rotuloDoProduto(null, lista)).toBe("Qualquer produto");
    expect(rotuloDoProduto("p9", lista)).toBe("Produto que não está mais no cadastro");
  });

  it("a lista de edição traz os ativos e o produto atual, mesmo desativado", () => {
    expect(produtosParaEscolher(lista, "p2").map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(produtosParaEscolher(lista, null).map((p) => p.id)).toEqual(["p1"]);
    expect(produtosParaEscolher(lista, "p2", "p1").map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(rotuloDaOpcaoDeProduto(velho)).toBe("Produto desativado: Lona antiga");
    expect(rotuloDaOpcaoDeProduto(ativo)).toBe("Banner 440g");
  });
});

describe("Editar e aprovar: salvar passa e aprovar falha", () => {
  it("o erro sai marcado, com a causa, para a tela recarregar e dizer a verdade", async () => {
    const causa = new Error("Esta resposta mudou enquanto você lia. Leia de novo antes de aprovar.");
    let aprovou = 0;
    const falha = await salvarDepoisAprovar(
      async () => ({ versao: 4 }),
      async (v) => {
        aprovou += v;
        throw causa;
      },
    ).catch((e) => e);
    expect(falha).toBeInstanceOf(SalvouMasNaoAprovou);
    expect(falha.causa).toBe(causa);
    expect(falha.message).toBe(causa.message);
    expect(aprovou).toBe(4);
  });

  it("se o salvar falha, nada é aprovado e o erro sai como veio", async () => {
    const causa = new Error("falhou ao salvar");
    let chamou = false;
    const falha = await salvarDepoisAprovar(
      async () => {
        throw causa;
      },
      async () => {
        chamou = true;
        return 1;
      },
    ).catch((e) => e);
    expect(falha).toBe(causa);
    expect(falha).not.toBeInstanceOf(SalvouMasNaoAprovou);
    expect(chamou).toBe(false);
  });

  it("aprova a versão que o salvar devolveu, não a que o dono viu", async () => {
    const visto: number[] = [];
    const r2 = await salvarDepoisAprovar(
      async () => ({ versao: 7 }),
      async (v) => {
        visto.push(v);
        return "ok";
      },
    );
    expect(r2).toBe("ok");
    expect(visto).toEqual([7]);
  });

  it("sem versão devolvida, não tenta aprovar", async () => {
    let chamou = false;
    await expect(
      salvarDepoisAprovar(
        async () => ({ versao: null }),
        async () => {
          chamou = true;
          return 1;
        },
      ),
    ).rejects.toThrow(/versão salva/);
    expect(chamou).toBe(false);
  });
});
