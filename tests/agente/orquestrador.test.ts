import { describe, expect, it } from "vitest";
import {
  baseDoBanco,
  configDoAgenteDoBanco,
  contextoDoAgenteDoBanco,
  linhaDoAgentePodeSair,
  rodarAgente,
} from "../../src/domain/agente";
import { assistentePodeResponder } from "../../src/domain/whatsapp/triagem/orquestrador";
import { TEXTO_DO_HORARIO, TEXTO_DO_VALOR } from "./montar";
import { CONVERSA, criarBanco, TRIAGEM } from "./porta-falsa";

describe("desligada: o agente só lê a configuração e não faz mais nada", () => {
  it("lê o estado e sai: nenhuma outra chamada", async () => {
    const b = criarBanco({ estado: "desligada" });
    const id = b.chega("qual o horario?");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toEqual({
      acao: "nada",
      motivo: "desligada",
    });
    expect(b.chamadas).toEqual(["estado"]);
  });

  it("sem linha de configuração também sai na primeira chamada", async () => {
    const b = criarBanco();
    b.estado = null;
    const id = b.chega("oi");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toEqual({
      acao: "nada",
      motivo: "sem_configuracao",
    });
    expect(b.chamadas).toEqual(["estado"]);
  });
});

describe("conversa que não é do agente: sai sem ler o quadro nem os termos", () => {
  it("triagem que não liberou", async () => {
    const b = criarBanco();
    b.triagem!.liberou = false;
    const id = b.chega("qual o horario?");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toEqual({
      acao: "nada",
      motivo: "sem_triagem_liberada",
    });
    expect(b.chamadas).toEqual(["estado", "contexto"]);
  });

  it("a mensagem que fechou a triagem é da triagem", async () => {
    const b = criarBanco();
    const id = b.chega("qual o horario?");
    b.mensagens.get(id)!.criada = b.triagem!.fim - 1000;
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toEqual({
      acao: "nada",
      motivo: "mensagem_da_triagem",
    });
  });

  it("fora do degrau de teste", async () => {
    const b = criarBanco({ estado: "teste", telefone: "5596999990002" });
    b.conversa.telefone_normalizado = "96999990002";
    const id = b.chega("qual o horario?");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toEqual({
      acao: "nada",
      motivo: "fora_do_degrau",
    });
    expect(b.chamadas).not.toContain("registrar");
  });
});

describe("envio real: o caminho inteiro, ida e volta", () => {
  it("escolhe a resposta, o banco lê o texto aprovado, enfileira e o servidor pede a rodada do despachante", async () => {
    const b = criarBanco();
    const id = b.chega("Qual o horário de atendimento?");
    const r = await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id });
    expect(r).toEqual({
      acao: "processada",
      decisao: "escolher",
      motivo: "horario_de_atendimento",
      enviou: true,
      ensaio: false,
    });
    expect(b.chamadas).toEqual([
      "estado",
      "contexto",
      "quadro",
      "termos",
      "registrar",
      "despachar",
    ]);
    expect(b.enviados).toHaveLength(1);
    expect(b.enviados[0].texto).toBe(TEXTO_DO_HORARIO);
    expect(b.enviados[0].chave).toBe(`triagem:${TRIAGEM}:agente:${id}`);
    expect(b.enviados[0].atraso_s).toBeGreaterThanOrEqual(1);
  });

  it("o que o servidor manda ao banco não leva texto: nem o da resposta, nem o do contato", async () => {
    const b = criarBanco();
    const id = b.chega("qual o horario? meu nome é Joao Silva, telefone 96 99999-0001");
    await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id });
    const json = JSON.stringify(b.registrosRecebidos);
    expect(json).not.toMatch(/Joao|Silva|99999|equipe atende|segunda a sexta/);
    expect(Object.keys(b.registrosRecebidos[0]).sort()).toEqual([
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
  });

  it("a mesma mensagem duas vezes (webhook repetido) não envia duas vezes", async () => {
    const b = criarBanco();
    const id = b.chega("qual o horario?");
    await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id });
    const segunda = await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id });
    expect(segunda).toEqual({ acao: "nada", motivo: "ja_decidida" });
    expect(b.enviados).toHaveLength(1);
  });

  it("a decisão que o banco não aceita vira silêncio com o motivo dele, sem despachar", async () => {
    const b = criarBanco();
    b.forcar.registrar = () => ({ registrado: false, motivo: "fora_do_degrau" });
    const id = b.chega("qual o horario?");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toEqual({
      acao: "nada",
      motivo: "fora_do_degrau",
    });
    expect(b.despachos).toBe(0);
  });

  it("falha ao despachar não é erro: a mensagem já está na fila", async () => {
    const b = criarBanco();
    b.forcar.despachar = async () => {
      throw new Error("zapi fora");
    };
    const id = b.chega("qual o horario?");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toMatchObject({
      acao: "processada",
      enviou: true,
    });
    expect(b.erros).toEqual([]);
  });

  it("entregar à equipe não envia nada ao contato nem pede o despachante", async () => {
    const b = criarBanco();
    const id = b.chega("voces fazem letreiro de neon sob encomenda?");
    const r = await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id });
    expect(r).toEqual({
      acao: "processada",
      decisao: "entregar",
      motivo: "sem_resposta",
      enviou: false,
      ensaio: false,
    });
    expect(b.enviados).toEqual([]);
    expect(b.despachos).toBe(0);
    expect(JSON.stringify(b.eventos)).not.toMatch(/neon|letreiro/);
  });

  it("preço: a primeira recebe a resposta de que a equipe confirma, a segunda é entregue, na MESMA conversa", async () => {
    const b = criarBanco();
    const a = b.chega("quanto custa um banner?");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: a })).toMatchObject({
      decisao: "escolher",
      motivo: "valor_do_produto",
      enviou: true,
    });
    expect(b.enviados[0].texto).toBe(TEXTO_DO_VALOR);
    b.enviados.length = 0;
    const c = b.chega("e o valor do cartao de visita?");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: c })).toMatchObject({
      decisao: "entregar",
      motivo: "preco_de_novo",
      enviou: false,
    });
    expect(b.enviados).toEqual([]);
  });

  it("teto de mensagens: depois do teto a conversa vai à equipe", async () => {
    const b = criarBanco();
    for (const t of ["qual o horario", "qual medida", "e o horario de novo"]) {
      const id = b.chega(t);
      await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id });
    }
    expect(b.enviados).toHaveLength(2);
    expect(b.eventos.at(-1)).toMatchObject({ tipo: "entregou", motivo: "teto_de_mensagens" });
  });

  it("gente na conversa: silêncio sem chamar o banco para registrar e sem evento; nada é enviado", async () => {
    const b = criarBanco();
    b.humano = true;
    b.dono = "ninguem";
    const id = b.chega("qual o horario?");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toEqual({
      acao: "nada",
      motivo: "dono_nao_e_o_agente",
    });
    expect(b.registrosRecebidos).toEqual([]);
    expect(b.eventos).toEqual([]);
    expect(b.enviados).toEqual([]);
  });

  it("contato bloqueado: o mesmo silêncio, sem registrar e sem evento", async () => {
    const b = criarBanco();
    b.bloqueado = true;
    b.dono = "ninguem";
    const id = b.chega("qual o horario?");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toEqual({
      acao: "nada",
      motivo: "dono_nao_e_o_agente",
    });
    expect(b.registrosRecebidos).toEqual([]);
    expect(b.eventos).toEqual([]);
  });

  it("o pedido de parar vai ao banco como parar MESMO depois do teto, com o freio de volume cheio ou com resposta na fila", async () => {
    // teto de mensagens
    const t = criarBanco();
    for (const x of ["qual o horario", "qual medida"]) {
      await rodarAgente(t.porta, { conversaId: CONVERSA, mensagemId: t.chega(x) });
    }
    expect(t.enviados).toHaveLength(2);
    const id = t.chega("pare de me mandar mensagem");
    expect(await rodarAgente(t.porta, { conversaId: CONVERSA, mensagemId: id })).toMatchObject({
      decisao: "parar",
    });
    expect(t.registrosRecebidos.at(-1)).toEqual({ acao: "parar", motivo: "parar" });
    // resposta ainda na fila: sem o pedido de parar seria rajada
    const f = criarBanco();
    f.envioPendente = true;
    await rodarAgente(f.porta, {
      conversaId: CONVERSA,
      mensagemId: f.chega("pare de me mandar mensagem"),
    });
    expect(f.registrosRecebidos).toEqual([{ acao: "parar", motivo: "parar" }]);
  });

  it("resposta ainda na fila: a pergunta nova vai ao banco como entregar com o motivo rajada, não como silêncio", async () => {
    const b = criarBanco();
    b.envioPendente = true;
    const id = b.chega("qual o horario?");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toMatchObject({
      decisao: "entregar",
      motivo: "rajada",
      enviou: false,
    });
    expect(b.registrosRecebidos[0]).toMatchObject({ acao: "entregar", motivo: "rajada" });
  });

  it("freio de volume: vai ao banco como entregar, não como silêncio", async () => {
    const b = criarBanco();
    b.config.max_por_hora = 0;
    const id = b.chega("qual o horario?");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toMatchObject({
      decisao: "entregar",
      motivo: "freio_de_volume",
    });
  });

  it("parar vai ao banco como parar", async () => {
    const b = criarBanco();
    const id = b.chega("pare de me mandar mensagem");
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id })).toMatchObject({
      decisao: "parar",
      motivo: "parar",
      enviou: false,
    });
    expect(b.registrosRecebidos[0]).toEqual({ acao: "parar", motivo: "parar" });
  });
});

describe("ensaio: só anota", () => {
  it("grava o evento de ensaio, não envia, não despacha", async () => {
    const b = criarBanco({ estado: "ensaio" });
    b.dono = "ninguem";
    const id = b.chega("qual o horario?");
    const r = await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id });
    expect(r).toEqual({
      acao: "processada",
      decisao: "escolher",
      motivo: "horario_de_atendimento",
      enviou: false,
      ensaio: true,
    });
    expect(b.enviados).toEqual([]);
    expect(b.despachos).toBe(0);
    expect(b.eventos).toEqual([expect.objectContaining({ tipo: "ensaio", acao: "escolher" })]);
  });

  it("no ensaio a segunda pergunta de preço também é anotada como entrega", async () => {
    const b = criarBanco({ estado: "ensaio" });
    b.dono = "ninguem";
    await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: b.chega("quanto custa?") });
    const r = await rodarAgente(b.porta, {
      conversaId: CONVERSA,
      mensagemId: b.chega("qual o preco do cartao?"),
    });
    expect(r).toMatchObject({ decisao: "entregar", motivo: "preco_de_novo", ensaio: true });
  });
});

describe("nunca lança: a mensagem do contato já está gravada", () => {
  it("falha em cada etapa vira erro com a etapa e um código curto, sem texto", async () => {
    for (const etapa of ["contexto", "registrar", "configuracao"] as const) {
      const b = criarBanco();
      if (etapa === "contexto")
        b.forcar.lerContexto = () => {
          throw Object.assign(new Error("Falha com valor secreto 123"), { code: "PGRST301" });
        };
      if (etapa === "registrar")
        b.forcar.registrar = () => {
          throw new Error("boom");
        };
      if (etapa === "configuracao")
        b.forcar.estadoDaConfiguracao = () => {
          throw new Error("rede");
        };
      const id = b.chega("qual o horario?");
      const r = await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: id });
      expect(r).toEqual({ acao: "erro", etapa });
      expect(b.erros).toHaveLength(1);
      expect(b.erros[0].etapa).toBe(etapa);
      expect(JSON.stringify(b.erros)).not.toMatch(/secreto|123|horario/);
    }
  });

  it("resposta vazia do banco é erro de leitura, não exceção", async () => {
    const b = criarBanco();
    b.forcar.lerContexto = () => null;
    expect(await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: b.chega("oi") })).toEqual(
      { acao: "erro", etapa: "contexto" },
    );
  });

  it("nem a falha de registrar o erro derruba", async () => {
    const b = criarBanco();
    b.forcar.registrar = () => {
      throw new Error("boom");
    };
    b.forcar.registrarErro = async () => {
      throw new Error("banco fora");
    };
    expect(
      await rodarAgente(b.porta, { conversaId: CONVERSA, mensagemId: b.chega("qual o horario?") }),
    ).toEqual({ acao: "erro", etapa: "registrar" });
  });
});

describe("leitura do que o banco devolve", () => {
  it("configuração fora do formato volta aos padrões e a um estado seguro", () => {
    const c = configDoAgenteDoBanco({ estado: "banana", max_mensagens: "x" });
    expect(c.estado).toBe("desligada");
    expect(c.maxMensagens).toBe(3);
    expect(configDoAgenteDoBanco(null).estado).toBe("desligada");
  });

  it("a base só traz linha com texto aprovado e ramo válido, e a resposta é o texto aprovado", () => {
    const base = baseDoBanco([
      {
        id: "a",
        tema: "t_a",
        frases_gatilho: ["x"],
        ramos: ["cliente"],
        texto_aprovado: "Texto A.",
      },
      { id: "b", tema: "t_b", frases_gatilho: ["x"], ramos: ["cliente"], texto_aprovado: null },
      { id: "c", tema: "t_c", frases_gatilho: ["x"], ramos: ["outro"], texto_aprovado: "Texto C." },
      { tema: "sem_id", ramos: ["cliente"], texto_aprovado: "Texto D." },
    ]);
    expect(base.map((r) => r.id)).toEqual(["a"]);
    expect(base[0]).toMatchObject({
      status: "aprovada",
      resposta: "Texto A.",
      texto_aprovado: "Texto A.",
    });
  });

  it("o contexto sem conversa nem mensagem não quebra", () => {
    const c = contextoDoAgenteDoBanco(
      { config: {}, conversa: null, triagem: null, mensagem: null },
      1,
    );
    expect(c.triagem).toBeNull();
    expect(c.mensagem).toBeNull();
    expect(c.base).toEqual([]);
  });

  it("quem manda é a mesma fonte da assistente: o agente é um dono e a assistente não fala por cima", () => {
    expect(assistentePodeResponder("agente")).toEqual({ pode: false, motivo: "dono_agente" });
    expect(assistentePodeResponder("assistente").pode).toBe(true);
    expect(assistentePodeResponder(null).pode).toBe(false);
  });
});

describe("o consumidor da fila confere o agente, não a triagem", () => {
  const ok = {
    estado: "teste",
    triagemLiberou: true,
    degrauPermite: true,
    humanoNaConversa: false,
    bloqueado: false,
    telefoneAlcancavel: true,
    respostaAprovada: true,
  };
  it("tudo em ordem: sai", () =>
    expect(linhaDoAgentePodeSair(ok)).toEqual({ sai: true, motivo: "ok" }));
  it("cada motivo cancela", () => {
    expect(linhaDoAgentePodeSair({ ...ok, estado: "desligada" }).motivo).toBe("agente_desligado");
    expect(linhaDoAgentePodeSair({ ...ok, estado: null }).motivo).toBe("agente_desligado");
    expect(linhaDoAgentePodeSair({ ...ok, estado: "ensaio" }).motivo).toBe("agente_em_ensaio");
    expect(linhaDoAgentePodeSair({ ...ok, triagemLiberou: false }).motivo).toBe(
      "triagem_nao_liberou",
    );
    expect(linhaDoAgentePodeSair({ ...ok, telefoneAlcancavel: false }).motivo).toBe(
      "sem_numero_alcancavel",
    );
    expect(linhaDoAgentePodeSair({ ...ok, humanoNaConversa: true }).motivo).toBe(
      "humano_na_conversa",
    );
    expect(linhaDoAgentePodeSair({ ...ok, bloqueado: true }).motivo).toBe("bloqueado");
    expect(linhaDoAgentePodeSair({ ...ok, degrauPermite: false }).motivo).toBe("fora_do_degrau");
    // resposta arquivada, editada (outra versão) ou com produto: o banco diz resposta_aprovada false e a linha não sai
    expect(linhaDoAgentePodeSair({ ...ok, respostaAprovada: false })).toEqual({
      sai: false,
      motivo: "resposta_mudou",
    });
    for (const s of [
      { estado: "desligada" },
      { humanoNaConversa: true },
      { degrauPermite: false },
      { respostaAprovada: false },
    ])
      expect(linhaDoAgentePodeSair({ ...ok, ...s }).sai).toBe(false);
  });
});
