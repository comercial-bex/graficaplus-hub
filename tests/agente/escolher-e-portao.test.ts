import { describe, expect, it } from "vitest";
import {
  degrauCobre,
  ehNumeroDeTeste,
  escolherResposta,
  portaoDoAgente,
  respostaServe,
  TEMA_DE_PRECO,
} from "../../src/domain/agente";
import { basePadrao, contexto, QUADRO, resposta } from "./montar";

describe("escolher a resposta: só aprovada, por frase gatilho, com o motor da base", () => {
  const ctx = { ramo: "cliente" } as const;

  it("só serve resposta aprovada com texto aprovado igual à resposta", () => {
    const aprovada = resposta({ frases_gatilho: ["horario"] });
    expect(respostaServe(aprovada)).toBe(true);
    expect(respostaServe({ ...aprovada, status: "rascunho" })).toBe(false);
    expect(respostaServe({ ...aprovada, status: "arquivada" })).toBe(false);
    expect(respostaServe({ ...aprovada, texto_aprovado: null })).toBe(false);
    expect(respostaServe({ ...aprovada, texto_aprovado: "outro texto" })).toBe(false);
    expect(respostaServe({ ...aprovada, texto_aprovado: "  " })).toBe(false);
  });

  it("rascunho que casa NUNCA é escolhido", () => {
    const base = [{ ...resposta({ frases_gatilho: ["horario"] }), status: "rascunho" as const }];
    expect(escolherResposta("qual o horario", base, ctx, false).tipo).toBe("sem_resposta");
  });

  it("a frase vale como palavras inteiras e a pergunta é normalizada (acento, caixa, pontuação)", () => {
    const base = basePadrao();
    const e = escolherResposta("Qual o HORÁRIO, por favor?", base, ctx, false);
    expect(e.tipo).toBe("escolhida");
    if (e.tipo === "escolhida") expect(e.casamento.resposta.id).toBe("horario");
    expect(escolherResposta("horarios malucos", base, ctx, false).tipo).toBe("sem_resposta");
  });

  it("só serve resposta do ramo da conversa", () => {
    const base = [resposta({ frases_gatilho: ["horario"], ramos: ["parceiro"] })];
    expect(escolherResposta("horario", base, { ramo: "cliente" }, false).tipo).toBe("sem_resposta");
    expect(escolherResposta("horario", base, { ramo: "parceiro" }, false).tipo).toBe("escolhida");
  });

  it("a frase maior vence a menor, e resposta de produto vence a geral quando o produto é o da conversa", () => {
    const geral = resposta({ id: "g", frases_gatilho: ["entrega"] });
    const longa = resposta({ id: "l", frases_gatilho: ["entrega em casa"] });
    const e = escolherResposta("voces fazem entrega em casa", [geral, longa], ctx, false);
    expect(e.tipo === "escolhida" && e.casamento.resposta.id).toBe("l");
    const doProduto = resposta({ id: "p", frases_gatilho: ["prazo"], produto_id: "prod-1" });
    const dura = resposta({ id: "d", frases_gatilho: ["prazo"] });
    const comProduto = escolherResposta(
      "qual o prazo",
      [dura, doProduto],
      { ramo: "cliente", produtoId: "prod-1" },
      false,
    );
    expect(comProduto.tipo === "escolhida" && comProduto.casamento.resposta.id).toBe("p");
    const semProduto = escolherResposta("qual o prazo", [dura, doProduto], ctx, false);
    expect(semProduto.tipo === "escolhida" && semProduto.casamento.resposta.id).toBe("d");
  });

  it("EMPATE exato (mesma especificidade, mesmas palavras, mesmo tamanho) em respostas diferentes não se sorteia: vai à equipe", () => {
    const a = resposta({ id: "a", frases_gatilho: ["entrega"], contagem_ocorrencias: 50 });
    const b = resposta({ id: "b", frases_gatilho: ["retirar"], contagem_ocorrencias: 1 });
    const e = escolherResposta("entrega ou retirar", [a, b], ctx, false);
    expect(e.tipo).toBe("empate");
    // a mesma resposta com duas frases que casam não é empate
    const dupla = resposta({ id: "c", frases_gatilho: ["entrega", "frete"] });
    expect(escolherResposta("entrega com frete", [dupla], ctx, false).tipo).toBe("escolhida");
  });

  it("PERGUNTA DE PREÇO só recebe a resposta do tema de preço, mesmo que outra tenha frase maior", () => {
    const entrega = resposta({
      id: "ent",
      tema: "entrega_do_pedido",
      frases_gatilho: ["quanto custa a entrega"],
    });
    const base = [...basePadrao(), entrega];
    const e = escolherResposta("quanto custa a entrega", base, ctx, true);
    expect(e.tipo === "escolhida" && e.casamento.resposta.tema).toBe(TEMA_DE_PRECO);
    expect(e.ehPreco).toBe(true);
  });

  it("pergunta de preço pela intenção, sem a frase do tema casar, recebe a resposta geral de preço", () => {
    const e = escolherResposta("me passa o orcamento do banner", basePadrao(), ctx, true);
    expect(e.tipo === "escolhida" && e.casamento.resposta.tema).toBe(TEMA_DE_PRECO);
  });

  it("pergunta de preço sem resposta de preço aprovada: sem resposta, nunca outra resposta no lugar", () => {
    const base = basePadrao().filter((r) => r.tema !== TEMA_DE_PRECO);
    const e = escolherResposta("quanto custa", base, ctx, true);
    expect(e).toMatchObject({ tipo: "sem_resposta", ehPreco: true });
  });

  it("o tema de preço casado pela frase conta como pergunta de preço mesmo sem a intenção", () => {
    const e = escolherResposta("valor", basePadrao(), ctx, false);
    expect(e.ehPreco).toBe(true);
  });
});

describe("o portão do agente, na ordem", () => {
  it("o caso feliz abre, em envio real", () => {
    expect(portaoDoAgente(contexto(), QUADRO)).toEqual({ acao: "abre", modo: "real" });
  });

  it("desligada: silêncio, sem olhar mais nada", () => {
    const c = contexto({
      config: { ...contexto().config, estado: "desligada" },
      humanoNaConversa: true,
    });
    expect(portaoDoAgente(c, QUADRO)).toEqual({ acao: "nada", motivo: "desligada" });
  });

  it("silêncios sem evento: triagem sem terminar, mensagem da própria triagem, não é pessoa, já decidida, grupo", () => {
    expect(portaoDoAgente(contexto({ triagem: null }), QUADRO)).toEqual({
      acao: "nada",
      motivo: "sem_triagem_liberada",
    });
    expect(
      portaoDoAgente(contexto({ triagem: { id: "t", ramo: "cliente", liberou: false } }), QUADRO),
    ).toEqual({ acao: "nada", motivo: "sem_triagem_liberada" });
    const base = contexto();
    expect(
      portaoDoAgente(
        contexto({ mensagem: { ...base.mensagem!, posteriorATriagem: false } }),
        QUADRO,
      ),
    ).toEqual({ acao: "nada", motivo: "mensagem_da_triagem" });
    expect(
      portaoDoAgente(contexto({ mensagem: { ...base.mensagem!, origem: "automacao" } }), QUADRO),
    ).toEqual({ acao: "nada", motivo: "nao_e_pessoa" });
    expect(portaoDoAgente(contexto({ mensagem: null }), QUADRO)).toEqual({
      acao: "nada",
      motivo: "mensagem_inexistente",
    });
    expect(portaoDoAgente(contexto({ jaDecidida: true }), QUADRO)).toEqual({
      acao: "nada",
      motivo: "ja_decidida",
    });
    expect(portaoDoAgente(contexto({ ehDeGrupo: true }), QUADRO)).toEqual({
      acao: "nada",
      motivo: "grupo",
    });
  });

  it("o degrau: teste só deixa número de teste; parcial deixa teste ou sorteio; ligada deixa todos; ensaio cobre todos e só anota", () => {
    const cfg = contexto().config;
    const fora = contexto({ config: { ...cfg, estado: "teste", numerosDeTeste: ["96999990009"] } });
    expect(portaoDoAgente(fora, QUADRO)).toEqual({ acao: "nada", motivo: "fora_do_degrau" });
    const dentro = contexto({
      config: { ...cfg, estado: "teste", numerosDeTeste: ["96999990001"] },
    });
    expect(portaoDoAgente(dentro, QUADRO)).toEqual({ acao: "abre", modo: "real" });
    // o número de teste vale com ou sem o 55 na lista
    expect(ehNumeroDeTeste("96999990001", ["5596999990001"])).toBe(false);
    expect(ehNumeroDeTeste("96999990001", ["96-99999-0001"])).toBe(true);
    expect(portaoDoAgente(contexto({ config: { ...cfg, estado: "ensaio" } }), QUADRO)).toEqual({
      acao: "abre",
      modo: "ensaio",
    });
    // parcial: 0% só número de teste, 100% todos
    const id = "11111111-2222-4333-8444-555555555555";
    expect(
      degrauCobre({ estado: "parcial", percentual: 0, numerosDeTeste: [] }, id, "96999990001"),
    ).toBe(false);
    expect(
      degrauCobre({ estado: "parcial", percentual: 100, numerosDeTeste: [] }, id, "96999990001"),
    ).toBe(true);
    expect(
      degrauCobre(
        { estado: "parcial", percentual: 0, numerosDeTeste: ["96999990001"] },
        id,
        "96999990001",
      ),
    ).toBe(true);
    expect(
      degrauCobre({ estado: "desligada", percentual: 100, numerosDeTeste: [] }, id, null),
    ).toBe(false);
  });

  it("no envio real o dono precisa ser o agente; no ensaio não precisa", () => {
    expect(portaoDoAgente(contexto({ dono: "assistente" }), QUADRO)).toEqual({
      acao: "nada",
      motivo: "dono_nao_e_o_agente",
    });
    expect(
      portaoDoAgente(
        contexto({ dono: "ninguem", config: { ...contexto().config, estado: "ensaio" } }),
        QUADRO,
      ),
    ).toEqual({ acao: "abre", modo: "ensaio" });
  });

  it("gente na conversa ou contato bloqueado, fora do dono: silêncio SEM evento no envio real; no ensaio vira barrado", () => {
    // no envio real o dono já é outro (a equipe entrou ou o contato foi bloqueado): o agente nem chama o banco
    expect(portaoDoAgente(contexto({ humanoNaConversa: true, dono: "ninguem" }), QUADRO)).toEqual({
      acao: "nada",
      motivo: "dono_nao_e_o_agente",
    });
    expect(portaoDoAgente(contexto({ bloqueado: true, dono: "ninguem" }), QUADRO)).toEqual({
      acao: "nada",
      motivo: "dono_nao_e_o_agente",
    });
    // no ensaio ninguém é dono, e é o evento barrado que o ensaio mede
    const ensaio = { ...contexto().config, estado: "ensaio" as const };
    expect(
      portaoDoAgente(contexto({ humanoNaConversa: true, dono: "ninguem", config: ensaio }), QUADRO),
    ).toEqual({ acao: "barrar", motivo: "humano_na_conversa" });
    expect(
      portaoDoAgente(contexto({ bloqueado: true, dono: "ninguem", config: ensaio }), QUADRO),
    ).toEqual({ acao: "barrar", motivo: "bloqueado" });
  });

  it("recusas COM evento: número que o robô não alcança", () => {
    // lid e número de fora nunca recebem mensagem
    expect(portaoDoAgente(contexto({ telefone: "99999999990001@lid" }), QUADRO)).toEqual({
      acao: "barrar",
      motivo: "sem_numero_alcancavel",
    });
    expect(portaoDoAgente(contexto({ telefone: "351912345678" }), QUADRO)).toEqual({
      acao: "barrar",
      motivo: "sem_numero_alcancavel",
    });
    expect(portaoDoAgente(contexto({ telefone: null }), QUADRO)).toEqual({
      acao: "barrar",
      motivo: "sem_numero_alcancavel",
    });
  });

  it("robô de empresa: texto de menu, origem automação e a resposta rápida demais ficam em silêncio com evento", () => {
    const base = contexto();
    expect(
      portaoDoAgente(contexto({ texto: "Responda SIM para confirmar o seu pedido agora" }), QUADRO),
    ).toEqual({ acao: "barrar", motivo: "robo" });
    expect(
      portaoDoAgente(
        contexto({
          texto: "digite 1 para falar com o financeiro",
          mensagem: { ...base.mensagem!, texto: "digite 1 para falar com o financeiro" },
        }),
        QUADRO,
      ),
    ).toEqual({ acao: "barrar", motivo: "robo" });
    expect(
      portaoDoAgente(
        contexto({ texto: "qual o horario de atendimento de voces", msDesdeUltimaAutomatica: 800 }),
        QUADRO,
      ),
    ).toEqual({ acao: "barrar", motivo: "robo" });
  });

  it("texto muito longo ou com link é de pessoa que quer ser lida: vai à equipe, não ao silêncio", () => {
    const longo = "preciso de um orçamento ".repeat(20);
    expect(portaoDoAgente(contexto({ texto: longo }), QUADRO)).toMatchObject({
      acao: "entregar",
      motivo: "texto_longo",
    });
    expect(
      portaoDoAgente(contexto({ texto: "olha essa referencia https://exemplo.com/foto" }), QUADRO),
    ).toMatchObject({ acao: "entregar", motivo: "link" });
  });

  it("o teto de mensagens e o freio de volume entregam à equipe: nenhum dos dois é silêncio", () => {
    const cfg = contexto().config;
    expect(portaoDoAgente(contexto({ enviadas: cfg.maxMensagens }), QUADRO)).toMatchObject({
      acao: "entregar",
      motivo: "teto_de_mensagens",
    });
    expect(portaoDoAgente(contexto({ enviadas: cfg.maxMensagens - 1 }), QUADRO)).toEqual({
      acao: "abre",
      modo: "real",
    });
    expect(portaoDoAgente(contexto({ enviadasNaHora: cfg.maxPorHora }), QUADRO)).toMatchObject({
      acao: "entregar",
      motivo: "freio_de_volume",
    });
    expect(portaoDoAgente(contexto({ enviadasNoDia: cfg.maxPorDia }), QUADRO)).toMatchObject({
      acao: "entregar",
      motivo: "freio_de_volume",
    });
  });

  it("resposta do agente ainda na fila: a pergunta nova vai à equipe como rajada, não fica sem dono nem responde por cima", () => {
    expect(portaoDoAgente(contexto({ envioPendente: true }), QUADRO)).toMatchObject({
      acao: "entregar",
      motivo: "rajada",
    });
  });

  it("o pedido de parar vem ANTES de teto, freio de volume, resposta em andamento e robô", () => {
    const cfg = contexto().config;
    const parar = { acao: "parar", motivo: "parar" };
    for (const sobre of [
      { enviadas: cfg.maxMensagens },
      { enviadasNaHora: cfg.maxPorHora },
      { enviadasNoDia: cfg.maxPorDia },
      { envioPendente: true },
      { msDesdeUltimaAutomatica: 800 },
    ]) {
      expect(
        portaoDoAgente(contexto({ texto: "pare de me mandar mensagem", ...sobre }), QUADRO),
        JSON.stringify(sobre),
      ).toEqual(parar);
    }
    // sem pedido de parar, os mesmos contextos seguem o caminho de antes
    expect(portaoDoAgente(contexto({ envioPendente: true }), QUADRO)).toMatchObject({
      motivo: "rajada",
    });
  });
});
