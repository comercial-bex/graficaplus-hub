import { describe, expect, it } from "vitest";
import {
  decidirDoAgente,
  decisaoParaRegistrar,
  type DecisaoDoAgente,
} from "../../src/domain/agente";
import { compilarTermosDoBanco } from "../../src/domain/whatsapp/triagem";
import {
  basePadrao,
  contexto,
  QUADRO,
  resposta,
  TEXTO_DA_EQUIPE,
  TEXTO_DO_HORARIO,
  TEXTO_DO_VALOR,
} from "./montar";

const decidir = (texto: string | null, p: Parameters<typeof contexto>[0] = {}, extras = []) =>
  decidirDoAgente(contexto({ texto, ...p }), QUADRO, extras);

describe("o agente escolhe um código da base, e só", () => {
  it("pergunta que a base conhece: escolhe a resposta aprovada, com o texto aprovado palavra por palavra", () => {
    const d = decidir("Qual o horário de vocês?");
    expect(d).toMatchObject({
      acao: "escolher",
      respostaId: "horario",
      versao: 3,
      tema: "horario_de_atendimento",
      ehPreco: false,
    });
    expect((d as Extract<DecisaoDoAgente, { acao: "escolher" }>).texto).toBe(TEXTO_DO_HORARIO);
  });

  it("o atraso de digitação fica dentro do que o Z-API aceita e é o mesmo para a mesma conversa", () => {
    const a = decidir("qual o horario") as Extract<DecisaoDoAgente, { acao: "escolher" }>;
    const b = decidir("que horas abre") as Extract<DecisaoDoAgente, { acao: "escolher" }>;
    expect(a.atrasoS).toBeGreaterThanOrEqual(1);
    expect(a.atrasoS).toBeLessThanOrEqual(15);
    expect(a.atrasoS).toBe(b.atrasoS);
  });

  it("pergunta que a base não conhece: entrega à equipe com o motivo sem_resposta, sem guardar a frase", () => {
    const d = decidir("voces trabalham com letreiro de neon sob encomenda?");
    expect(d).toEqual({ acao: "entregar", motivo: "sem_resposta", ehPreco: false, regras: [] });
    // o que vai ao banco é só o código: a frase do contato não está em nenhum campo
    const payload = decisaoParaRegistrar(d)!;
    expect(JSON.stringify(payload)).not.toMatch(/neon|letreiro|encomenda/);
    expect(Object.keys(payload).sort()).toEqual(["acao", "motivo", "regras", "sensivel"]);
  });

  it("a base vazia entrega tudo à equipe", () => {
    expect(decidir("qual o horario", { base: [] })).toMatchObject({
      acao: "entregar",
      motivo: "sem_resposta",
    });
  });

  it("rascunho e arquivada não existem para o agente, mesmo que cheguem ao contexto", () => {
    const base = basePadrao().map((r) => ({ ...r, status: "rascunho" as const }));
    expect(decidir("qual o horario", { base })).toMatchObject({
      acao: "entregar",
      motivo: "sem_resposta",
    });
  });

  it("o ramo vem da triagem: o contato do ramo parceiro só recebe resposta que vale para parceiro", () => {
    const d = decidir("qual o horario", { triagem: { id: "t", ramo: "parceiro", liberou: true } });
    expect(d).toMatchObject({ acao: "entregar", motivo: "sem_resposta" });
    const base = [
      ...basePadrao(),
      resposta({
        id: "hp",
        tema: "horario_parceiro",
        frases_gatilho: ["horario"],
        ramos: ["parceiro"],
      }),
    ];
    expect(
      decidir("qual o horario", { triagem: { id: "t", ramo: "parceiro", liberou: true }, base }),
    ).toMatchObject({ acao: "escolher", respostaId: "hp" });
  });

  it("nunca pergunta o tipo do contato: nenhuma saída pede cliente ou parceiro", () => {
    for (const t of ["oi", "qual o horario", "preciso de ajuda", "quanto custa"]) {
      const d = decidir(t);
      if (d.acao === "escolher") expect(d.texto).not.toMatch(/cliente final|parceiro|revend/i);
    }
  });
});

describe("preço: a primeira pergunta recebe a resposta de que a equipe confirma, a segunda vai à equipe", () => {
  it("primeira pergunta de preço: a resposta aprovada do tema de preço, marcada como pergunta de preço", () => {
    const d = decidir("quanto custa um banner?");
    expect(d).toMatchObject({ acao: "escolher", tema: "valor_do_produto", ehPreco: true });
    expect((d as Extract<DecisaoDoAgente, { acao: "escolher" }>).texto).toBe(TEXTO_DO_VALOR);
  });

  it("segunda pergunta de preço da conversa: entrega à equipe, nunca repete a resposta", () => {
    expect(decidir("e o valor do cartao?", { perguntasDePreco: 1 })).toEqual({
      acao: "entregar",
      motivo: "preco_de_novo",
      ehPreco: true,
      regras: [],
    });
    expect(decidir("me passa o preco", { perguntasDePreco: 2 })).toMatchObject({
      acao: "entregar",
      motivo: "preco_de_novo",
    });
  });

  it("pergunta de preço misturada com outro assunto recebe a resposta de preço, não a do outro assunto", () => {
    const d = decidir("quanto custa e qual o horario");
    expect(d).toMatchObject({ acao: "escolher", tema: "valor_do_produto" });
  });

  it("sem resposta de preço aprovada, a pergunta de preço vai à equipe e nenhuma outra resposta sai no lugar", () => {
    const base = basePadrao().filter((r) => r.tema !== "valor_do_produto");
    expect(decidir("quanto custa o banner e qual o horario", { base })).toMatchObject({
      acao: "entregar",
      motivo: "sem_resposta",
      ehPreco: true,
    });
  });
});

describe("o que o agente nunca responde", () => {
  it("cortesia (obrigado, bom dia) fica em silêncio com evento, sem avisar a equipe", () => {
    expect(decidir("obrigado")).toEqual({ acao: "barrar", motivo: "cortesia" });
    expect(decidir("bom dia")).toEqual({ acao: "barrar", motivo: "cortesia" });
  });

  it("pedido de parar bloqueia e não responde", () => {
    expect(decidir("pare de me mandar mensagem")).toEqual({ acao: "parar", motivo: "parar" });
  });

  it('reclamação ("isso é um absurdo", "você é um robô") vai à equipe sem resposta do agente, mesmo com a base cheia', () => {
    for (const t of ["isso e um absurdo", "voce e um robo?", "nao quero falar com robo"]) {
      expect(decidir(t)).toEqual({
        acao: "entregar",
        motivo: "reclamou",
        ehPreco: false,
        regras: [],
      });
    }
  });

  it("pedido de gente: a resposta aprovada de falar com a equipe sai E a conversa é entregue", () => {
    const d = decidir("quero falar com uma pessoa");
    expect(d).toMatchObject({
      acao: "escolher",
      tema: "falar_com_a_equipe",
      passarParaEquipe: true,
    });
    expect((d as Extract<DecisaoDoAgente, { acao: "escolher" }>).texto).toBe(TEXTO_DA_EQUIPE);
  });

  it("pedido de gente sem resposta aprovada: entrega com o motivo pediu_equipe", () => {
    const base = basePadrao().filter((r) => r.tema !== "falar_com_a_equipe");
    expect(decidir("quero falar com uma pessoa", { base })).toMatchObject({
      acao: "entregar",
      motivo: "pediu_equipe",
    });
  });

  it("áudio, imagem, documento e vídeo vão à equipe; figurinha só barra; texto vazio só barra", () => {
    const m = contexto().mensagem!;
    for (const tipo of ["audio", "imagem", "documento", "video", "localizacao", "contato"]) {
      expect(decidirDoAgente(contexto({ mensagem: { ...m, tipo } }), QUADRO)).toMatchObject({
        acao: "entregar",
        motivo: "nao_e_texto",
      });
    }
    expect(decidirDoAgente(contexto({ mensagem: { ...m, tipo: "sticker" } }), QUADRO)).toEqual({
      acao: "barrar",
      motivo: "figurinha",
    });
    expect(decidir("   ")).toEqual({ acao: "barrar", motivo: "sem_texto" });
    expect(decidir(null)).toEqual({ acao: "barrar", motivo: "sem_texto" });
  });

  it("empate exato entre duas respostas vai à equipe", () => {
    const base = [
      resposta({ id: "a", tema: "entrega_do_pedido", frases_gatilho: ["entrega"] }),
      resposta({ id: "b", tema: "retirada_na_loja", frases_gatilho: ["retirar"] }),
    ];
    expect(decidir("entrega ou retirar na loja", { base })).toMatchObject({
      acao: "entregar",
      motivo: "empate",
    });
  });
});

describe("a última porta: verificarTexto sobre o texto aprovado", () => {
  it("resposta aprovada com preço (o validador do banco foi contornado ou ficou mais frouxo): entrega à equipe com os CÓDIGOS das regras", () => {
    const base = [
      resposta({
        id: "ruim",
        tema: "horario_ruim",
        frases_gatilho: ["horario"],
        texto_aprovado: "O banner custa R$ 50 e fica pronto em 2 dias.",
      }),
    ];
    const d = decidir("qual o horario", { base });
    expect(d).toMatchObject({ acao: "entregar", motivo: "texto_reprovado" });
    if (d.acao === "entregar") {
      expect(d.regras).toEqual(expect.arrayContaining(["moeda", "prazo_em_numero"]));
      // só códigos, nunca o trecho
      expect(JSON.stringify(d)).not.toMatch(/R\$|banner/);
    }
  });

  it("os termos que o dono acrescentou no banco também valem", () => {
    const extras = compilarTermosDoBanco([
      { regra: "palavra_nova", termo: "horario", tipo: "trecho", sobre: "plano", ramo: "todos" },
    ]).regras;
    expect(decidir("qual o horario", {}, extras as never)).toMatchObject({
      acao: "entregar",
      motivo: "texto_reprovado",
      regras: ["palavra_nova"],
    });
  });

  it("travessão, seta, parênteses e variável sem preencher também reprovam a saída", () => {
    for (const ruim of [
      "A equipe atende de segunda a sexta — venha",
      "Fale com a equipe (ela responde)",
      "Veja → a equipe responde",
      "Olá {{primeiro_nome}}",
    ]) {
      const base = [
        resposta({ id: "x", tema: "horario_x", frases_gatilho: ["horario"], texto_aprovado: ruim }),
      ];
      expect(decidir("horario", { base })).toMatchObject({
        acao: "entregar",
        motivo: "texto_reprovado",
      });
    }
  });
});

describe("o que vai ao banco", () => {
  it("escolher manda só ids, versão, código e contagens: nenhum texto", () => {
    const d = decidir("qual o horario");
    const p = decisaoParaRegistrar(d)!;
    expect(Object.keys(p).sort()).toEqual([
      "acao",
      "atraso_s",
      "candidatas",
      "especificidade",
      "passar_para_equipe",
      "resposta_id",
      "sensivel",
      "tema",
      "versao",
    ]);
    expect(JSON.stringify(p)).not.toContain("equipe atende");
  });

  it("silêncio não vai ao banco", () => {
    expect(decisaoParaRegistrar({ acao: "nada", motivo: "desligada" })).toBeNull();
  });

  it("código de regra fora do formato é descartado antes de ir ao banco", () => {
    const p = decisaoParaRegistrar({
      acao: "entregar",
      motivo: "texto_reprovado",
      ehPreco: false,
      regras: ["moeda", "Valor R$ 50", "a b"],
    })!;
    expect(p.regras).toEqual(["moeda"]);
  });
});
