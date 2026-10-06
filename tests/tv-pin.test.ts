import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gerarSegredo, hashDoSegredo } from "../src/domain/whatsapp/segredo-webhook";
import {
  esperaPorExtenso,
  interpretarEstadoDoPin,
  mensagemDoDefinirPin,
  passoDaResposta,
  pinBemFormado,
  pinObvio,
  textoDoPinErrado,
} from "../src/domain/tv/pin";

/**
 * A ENTRADA POR PIN da TV da Oficina, exercida de verdade — com o banco
 * trocado por um dublê que responde o que o teste mandar.
 *
 * O que se segura aqui é o combinado com a tela da TV:
 *   200 liberado   a TV guarda o crachá que ela mesma sorteou
 *   401            PIN errado, com quantas tentativas restam
 *   429            muitas erradas: espera, com retry-after
 *   403            PIN desligado: a TV avisa e espera ligarem (não há outra porta)
 *   409            crachá revogado: a TV sorteia outro
 *   503            banco fora — nunca um 200 inventado
 * E que o banco recebe o HASH do token, nunca o token; e que nenhuma resposta
 * devolve token nem PIN.
 */

type Resposta = { data: unknown; error: { code?: string; message?: string } | null };

const banco = vi.hoisted(() => {
  const estado = {
    chamadas: [] as { nome: string; params: Record<string, unknown> | undefined }[],
    fila: new Map<string, unknown[]>(),
    responder(nome: string, ...respostas: unknown[]) {
      estado.fila.set(nome, respostas);
    },
    rpc(nome: string, params?: Record<string, unknown>) {
      estado.chamadas.push({ nome, params });
      const fila = estado.fila.get(nome);
      if (!fila || fila.length === 0) throw new Error(`dublê sem resposta para ${nome}`);
      const proxima = fila.length > 1 ? fila.shift() : fila[0];
      if (proxima instanceof Error) throw proxima;
      return Promise.resolve(proxima);
    },
  };
  return estado;
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (nome: string, params?: Record<string, unknown>) => banco.rpc(nome, params),
  },
}));

import { entrarComPin, estadoDoPin } from "../src/lib/api/tv-pin.server";

const ok = (data: unknown): Resposta => ({ data, error: null });
const falha = (): Resposta => ({ data: null, error: { code: "57014", message: "canceling statement" } });

let erros: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  banco.chamadas.length = 0;
  banco.fila.clear();
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  erros.mockRestore();
});

function pedir(corpo: unknown, cabecalhos: Record<string, string> = {}): Promise<Response> {
  return entrarComPin(
    new Request("https://print.exemplo/api/tv/pin", {
      method: "POST",
      headers: { "content-type": "application/json", ...cabecalhos },
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }),
  );
}

describe("GET /api/tv/pin", () => {
  it("ligado: diz quantas casas, e mais nada", async () => {
    banco.responder("tv_estado_do_pin", ok({ ligado: true, digitos: 4 }));
    const r = await estadoDoPin();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ ligado: true, digitos: 4 });
  });

  it("desligado: digitos nulo", async () => {
    banco.responder("tv_estado_do_pin", ok({ ligado: false, digitos: null }));
    expect(await (await estadoDoPin()).json()).toEqual({ ligado: false, digitos: null });
  });

  it("banco fora ou resposta torta: 503, nunca 'desligado' inventado", async () => {
    banco.responder("tv_estado_do_pin", falha());
    expect((await estadoDoPin()).status).toBe(503);
    banco.responder("tv_estado_do_pin", ok({ ligado: true, digitos: "quatro" }));
    expect((await estadoDoPin()).status).toBe(503);
  });
});

describe("POST /api/tv/pin", () => {
  it("PIN certo: 200 liberado; o banco recebe o hash do token e o da origem, nunca o token", async () => {
    const token = gerarSegredo();
    banco.responder("tv_entrar_com_pin", ok({ estado: "liberado", nome: "TV pelo PIN · 05/10 18:30", repetido: false }));
    const r = await pedir({ pin: "1234", token }, { "cf-connecting-ip": "200.1.2.3" });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toEqual({ estado: "liberado", nome: "TV pelo PIN · 05/10 18:30" });
    expect(JSON.stringify(corpo)).not.toContain(token);
    expect(JSON.stringify(corpo)).not.toContain("1234");

    const [chamada] = banco.chamadas;
    expect(chamada.nome).toBe("tv_entrar_com_pin");
    expect(Object.keys(chamada.params ?? {}).sort()).toEqual(["p_origem_hash", "p_pin", "p_token_hash"]);
    expect(chamada.params?.p_pin).toBe("1234");
    expect(chamada.params?.p_token_hash).toBe(await hashDoSegredo(token));
    expect(chamada.params?.p_origem_hash).toBe(await hashDoSegredo("bexprint-tv-origem:200.1.2.3"));
    expect(JSON.stringify(chamada.params)).not.toContain(token);
  });

  it("a resposta repetida (mesmo token) também é 200 — a TV não fica sem crachá", async () => {
    banco.responder("tv_entrar_com_pin", ok({ estado: "liberado", nome: "TV pelo PIN · 05/10 18:30", repetido: true }));
    const r = await pedir({ pin: "1234", token: gerarSegredo() });
    expect(r.status).toBe(200);
  });

  it("sem endereço conhecido: a origem vai nula, e o freio geral do banco ainda vale", async () => {
    banco.responder("tv_entrar_com_pin", ok({ estado: "pin_errado", restantes: 4 }));
    await pedir({ pin: "0000", token: gerarSegredo() });
    expect(banco.chamadas[0].params?.p_origem_hash).toBeNull();
  });

  it("PIN errado: 401 com as tentativas que restam", async () => {
    banco.responder("tv_entrar_com_pin", ok({ estado: "pin_errado", restantes: 2 }));
    const r = await pedir({ pin: "0000", token: gerarSegredo() });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ erro: "pin_errado", restantes: 2 });
  });

  it("muitas erradas: 429 com o tempo de espera no corpo e no retry-after", async () => {
    banco.responder("tv_entrar_com_pin", ok({ estado: "bloqueado", libera_s: 840 }));
    const r = await pedir({ pin: "1234", token: gerarSegredo() });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("840");
    expect(await r.json()).toEqual({ erro: "muitas_tentativas", libera_s: 840 });
  });

  it("PIN desligado: 403; crachá revogado: 409", async () => {
    banco.responder("tv_entrar_com_pin", ok({ estado: "pin_desligado" }));
    const desligado = await pedir({ pin: "1234", token: gerarSegredo() });
    expect(desligado.status).toBe(403);
    expect(await desligado.json()).toEqual({ erro: "pin_desligado" });

    banco.responder("tv_entrar_com_pin", ok({ estado: "token_revogado" }));
    const revogado = await pedir({ pin: "1234", token: gerarSegredo() });
    expect(revogado.status).toBe(409);
    expect(await revogado.json()).toEqual({ erro: "token_revogado" });
  });

  it("banco fora ou estado desconhecido: 503, nunca liberado", async () => {
    banco.responder("tv_entrar_com_pin", falha());
    expect((await pedir({ pin: "1234", token: gerarSegredo() })).status).toBe(503);
    banco.responder("tv_entrar_com_pin", ok({ estado: "talvez" }));
    expect((await pedir({ pin: "1234", token: gerarSegredo() })).status).toBe(503);
    banco.responder("tv_entrar_com_pin", new Error("rede caiu"));
    expect((await pedir({ pin: "1234", token: gerarSegredo() })).status).toBe(503);
  });

  it("a falha vai para o log sem PIN, sem token e sem hash", async () => {
    const token = gerarSegredo();
    banco.responder("tv_entrar_com_pin", falha());
    await pedir({ pin: "4321", token });
    const registrado = JSON.stringify(erros.mock.calls);
    expect(registrado).toContain("tv_entrar_com_pin");
    expect(registrado).not.toContain("4321");
    expect(registrado).not.toContain(token);
    expect(registrado).not.toContain(await hashDoSegredo(token));
  });

  it("pedido torto: 400 sem ir ao banco e sem gastar tentativa", async () => {
    const casos: [unknown, string][] = [
      ["não é json", "corpo_invalido"],
      [[1, 2], "corpo_invalido"],
      [{ pin: "1234" }, "token_mal_formado"],
      [{ pin: "1234", token: "curto" }, "token_mal_formado"],
      [{ pin: "12", token: gerarSegredo() }, "pin_mal_formado"],
      [{ pin: "123456789", token: gerarSegredo() }, "pin_mal_formado"],
      [{ pin: 1234, token: gerarSegredo() }, "pin_mal_formado"],
      [{ pin: "12a4", token: gerarSegredo() }, "pin_mal_formado"],
    ];
    for (const [corpo, erro] of casos) {
      const r = await pedir(corpo);
      expect(r.status, JSON.stringify(corpo)).toBe(400);
      expect(await r.json()).toEqual({ erro });
    }
    expect(banco.chamadas).toEqual([]);
  });
});

describe("o PIN visto pela TV", () => {
  it("formato: 4 a 8 números, nada mais", () => {
    expect(pinBemFormado("1234")).toBe(true);
    expect(pinBemFormado("12345678")).toBe(true);
    expect(pinBemFormado("123")).toBe(false);
    expect(pinBemFormado("123456789")).toBe(false);
    expect(pinBemFormado(" 1234")).toBe(false);
    expect(pinBemFormado(1234)).toBe(false);
  });

  it("PIN óbvio: repetido ou em sequência, para frente ou para trás", () => {
    for (const p of ["1234", "0000", "4321", "7890", "98765", "111111"]) expect(pinObvio(p), p).toBe(true);
    for (const p of ["2580", "1357", "8462", "120934"]) expect(pinObvio(p), p).toBe(false);
  });

  it("o GET torto vira 'não sei', nunca 'desligado'", () => {
    expect(interpretarEstadoDoPin({ ligado: true, digitos: 4 })).toEqual({ ligado: true, digitos: 4 });
    expect(interpretarEstadoDoPin({ ligado: false, digitos: null })).toEqual({ ligado: false, digitos: null });
    expect(interpretarEstadoDoPin({ ligado: true, digitos: 3 })).toBeNull();
    expect(interpretarEstadoDoPin({ ligado: true })).toBeNull();
    expect(interpretarEstadoDoPin({ ligado: "sim" })).toBeNull();
    expect(interpretarEstadoDoPin(null)).toBeNull();
  });

  it("cada resposta do servidor vira um passo da TV", () => {
    expect(passoDaResposta(200, { estado: "liberado", nome: "TV A" }, null)).toEqual({
      tipo: "liberado",
      nome: "TV A",
    });
    expect(passoDaResposta(401, { erro: "pin_errado", restantes: 3 }, null)).toEqual({
      tipo: "pin_errado",
      restantes: 3,
    });
    expect(passoDaResposta(429, { erro: "muitas_tentativas", libera_s: 61.2 }, null)).toEqual({
      tipo: "esperar",
      s: 62,
    });
    // corpo sem o tempo: vale o retry-after
    expect(passoDaResposta(429, null, 120)).toEqual({ tipo: "esperar", s: 120 });
    expect(passoDaResposta(403, { erro: "pin_desligado" }, null)).toEqual({ tipo: "pin_desligado" });
    expect(passoDaResposta(409, { erro: "token_revogado" }, null)).toEqual({ tipo: "trocar_cracha" });
    expect(passoDaResposta(503, { erro: "banco_indisponivel" }, null)).toEqual({
      tipo: "sem_servidor",
      detalhe: "503",
    });
    // 200 sem "liberado" não libera
    expect(passoDaResposta(200, { estado: "talvez" }, null).tipo).toBe("sem_servidor");
    // 403 de outra coisa (um proxy, por exemplo) não desliga o PIN da TV
    expect(passoDaResposta(403, null, null).tipo).toBe("sem_servidor");
  });

  it("as frases da parede", () => {
    expect(textoDoPinErrado(1)).toContain("resta 1 tentativa");
    expect(textoDoPinErrado(3)).toContain("restam 3 tentativas");
    expect(textoDoPinErrado(0)).toContain("15 minutos");
    expect(esperaPorExtenso(40)).toBe("40 s");
    expect(esperaPorExtenso(61)).toBe("2 min");
    expect(esperaPorExtenso(900)).toBe("15 min");
  });

  it("a frase de quem salva o PIN conta as TVs que caíram", () => {
    expect(
      mensagemDoDefinirPin({ ok: true, ligado: true, digitos: 4, igual: false, desconectadas: 2 }),
    ).toBe("PIN salvo. 2 TVs que tinham entrado pelo PIN antigo foram desconectadas e pedem o PIN de novo.");
    expect(
      mensagemDoDefinirPin({ ok: true, ligado: true, digitos: 4, igual: false, desconectadas: 0 }),
    ).toBe("PIN salvo.");
    expect(
      mensagemDoDefinirPin({ ok: true, ligado: true, digitos: 4, igual: true, desconectadas: 0 }),
    ).toContain("Nada mudou");
    expect(
      mensagemDoDefinirPin({ ok: true, ligado: false, digitos: null, igual: false, desconectadas: 1 }),
    ).toContain("A TV passa a pedir o código");
  });
});
