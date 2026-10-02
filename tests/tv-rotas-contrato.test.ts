import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codigoValido, segredoBemFormado } from "../src/domain/tv/pareamento";
import { gerarSegredo, hashDoSegredo } from "../src/domain/whatsapp/segredo-webhook";

/**
 * O CONTRATO das rotas da TV, exercido de verdade — com o banco trocado por um
 * dublê que responde o que o teste mandar.
 *
 * `tv-rotas-sem-vazamento` lê o texto dos arquivos; este roda as funções. O que
 * ele segura é o que a tela da TV (outra trilha) vai tratar em cada resposta:
 *   401 = "TV desconectada", 503 = "servidor sem resposta", 200 = dado bom.
 * Se um 503 virar 200 com lista vazia, a parede mostra a oficina parada — e é
 * exatamente o defeito que esta tela nasceu para não ter.
 */

type Resposta = { data: unknown; error: { code?: string; message?: string } | null };
type Chamada = { nome: string; params: Record<string, unknown> | undefined };

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

import { responderPainel } from "../src/lib/api/tv-painel.server";
import { processarPareamento, saudeDoPareamento } from "../src/lib/api/tv-parear.server";

const ok = (data: unknown): Resposta => ({ data, error: null });
const falha = (): Resposta => ({
  data: null,
  error: { code: "57014", message: "canceling statement" },
});
const chamadasDe = (nome: string): Chamada[] => banco.chamadas.filter((c) => c.nome === nome);

const PAINEL = {
  versao: 1,
  gerado_em: "2026-10-01T18:00:00Z",
  intervalo_s: 60,
  maquinas: [{ nome: "Plotter i1600", estado: "rodando", os_numero: 90 }],
};

let erros: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  banco.chamadas.length = 0;
  banco.fila.clear();
  // As falhas simuladas registram no console.error; o teste confere o que foi dito.
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  erros.mockRestore();
});

function pedirPainel(
  token?: string | null,
  url = "https://print.exemplo/api/tv/painel",
): Promise<Response> {
  const headers = new Headers();
  if (token !== undefined && token !== null) headers.set("x-tv-token", token);
  return responderPainel(new Request(url, { headers }));
}

function parear(corpo: unknown, cabecalhos: Record<string, string> = {}): Promise<Response> {
  return processarPareamento(
    new Request("https://print.exemplo/api/tv/parear", {
      method: "POST",
      headers: { "content-type": "application/json", ...cabecalhos },
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }),
  );
}

/** Tudo que foi dito ao console e tudo que foi mandado ao banco, num texto só. */
function tudoQueSaiu(): string {
  return JSON.stringify([erros.mock.calls, banco.chamadas]);
}

describe("GET /api/tv/painel", () => {
  it("sem crachá: 401 tv_nao_pareada, sem nem ir ao banco", async () => {
    for (const token of [undefined, "", "1234", "a".repeat(44), `${"a".repeat(42)}=`]) {
      const r = await pedirPainel(token);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ erro: "tv_nao_pareada" });
    }
    expect(banco.chamadas).toHaveLength(0);
  });

  it("token na URL não vale: só o cabeçalho é lido", async () => {
    const token = gerarSegredo();
    const r = await pedirPainel(
      undefined,
      `https://print.exemplo/api/tv/painel?token=${token}&x-tv-token=${token}`,
    );
    expect(r.status).toBe(401);
    expect(banco.chamadas).toHaveLength(0);
  });

  it("crachá desconhecido: 401 tv_nao_pareada e o painel não é consultado", async () => {
    banco.responder("tv_conferir_dispositivo", ok({ estado: "desconhecida" }));
    const r = await pedirPainel(gerarSegredo());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ erro: "tv_nao_pareada" });
    expect(chamadasDe("tv_painel_maquinas")).toHaveLength(0);
  });

  it("crachá revogado: 401 tv_revogada e o painel não é consultado", async () => {
    banco.responder("tv_conferir_dispositivo", ok({ estado: "revogada" }));
    const r = await pedirPainel(gerarSegredo());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ erro: "tv_revogada" });
    expect(chamadasDe("tv_painel_maquinas")).toHaveLength(0);
  });

  it("crachá bom: 200 com o jsonb da função, sem mexer, e sem cache", async () => {
    const token = gerarSegredo();
    banco.responder("tv_conferir_dispositivo", ok({ estado: "ativa", nome: "TV da Oficina" }));
    banco.responder("tv_painel_maquinas", ok(PAINEL));
    const r = await pedirPainel(token);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual(PAINEL);

    // O banco recebe o SHA-256 do crachá, nunca o crachá.
    const [conferencia] = chamadasDe("tv_conferir_dispositivo");
    expect(conferencia.params).toEqual({ p_token_hash: await hashDoSegredo(token) });
    expect(chamadasDe("tv_painel_maquinas")[0].params).toBeUndefined();
    expect(tudoQueSaiu()).not.toContain(token);
  });

  it.each([
    ["conferência com erro do banco", () => banco.responder("tv_conferir_dispositivo", falha())],
    ["conferência que devolve nulo", () => banco.responder("tv_conferir_dispositivo", ok(null))],
    [
      "conferência com estado que o servidor não conhece",
      () => banco.responder("tv_conferir_dispositivo", ok({ estado: "talvez" })),
    ],
    [
      "conferência que estoura",
      () => banco.responder("tv_conferir_dispositivo", new Error("fetch failed")),
    ],
  ])("%s: 503, nunca 401 (a TV apagaria um crachá bom)", async (_nome, preparar) => {
    preparar();
    banco.responder("tv_painel_maquinas", ok(PAINEL));
    const r = await pedirPainel(gerarSegredo());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ erro: "banco_indisponivel" });
    expect(chamadasDe("tv_painel_maquinas")).toHaveLength(0);
  });

  it.each([
    ["função do painel com erro (ainda não existe, timeout…)", falha()],
    ["função do painel devolvendo nulo", ok(null)],
    ["função do painel devolvendo lista em vez de objeto", ok([])],
    ["função do painel devolvendo texto", ok("")],
    ["função do painel estourando", new Error("fetch failed")],
  ])("%s: 503, NUNCA 200 com vazio", async (_nome, resposta) => {
    banco.responder("tv_conferir_dispositivo", ok({ estado: "ativa", nome: "TV" }));
    banco.responder("tv_painel_maquinas", resposta);
    const r = await pedirPainel(gerarSegredo());
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ erro: "banco_indisponivel" });
  });

  it("a falha é registrada sem token e sem hash", async () => {
    const token = gerarSegredo();
    banco.responder("tv_conferir_dispositivo", falha());
    await pedirPainel(token);
    expect(erros).toHaveBeenCalled();
    const dito = JSON.stringify(erros.mock.calls);
    expect(dito).not.toContain(token);
    expect(dito).not.toContain(await hashDoSegredo(token));
    expect(dito).toContain("tv_conferir_dispositivo");
  });
});

describe("POST /api/tv/parear — novo", () => {
  const CRIAR = "tv_criar_pareamento_da_origem";
  const id = "0b0e3f3e-6f0f-4c0d-9d6c-2f5d0c1a7e11";
  const criado = () =>
    ok({ estado: "criado", pareamento_id: id, expira_em: "2026-10-01T18:10:00Z", validade_s: 600 });

  it("devolve código legível, segredo de retirada e validade; o banco só vê o hash", async () => {
    banco.responder(CRIAR, criado());
    const r = await parear({ acao: "novo" });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual([
      "codigo",
      "expira_em",
      "pareamento_id",
      "retirada",
      "validade_s",
    ]);
    expect(corpo.pareamento_id).toBe(id);
    expect(corpo.expira_em).toBe("2026-10-01T18:10:00Z");
    // Quanto falta vem do relógio do banco: a TV não compara data com o relógio dela.
    expect(corpo.validade_s).toBe(600);
    expect(codigoValido(corpo.codigo as string)).toBe(true);
    expect(segredoBemFormado(corpo.retirada)).toBe(true);

    const [chamada] = chamadasDe(CRIAR);
    expect(chamada.params).toEqual({
      p_codigo: corpo.codigo,
      p_retirada_hash: await hashDoSegredo(corpo.retirada as string),
      // Sem cabeçalho de endereço a origem é desconhecida: nulo, não um balde comum.
      p_origem_hash: null,
    });
    expect(JSON.stringify(banco.chamadas)).not.toContain(corpo.retirada);
    // A função de dentro (sem freio por origem) nunca é chamada daqui.
    expect(chamadasDe("tv_criar_pareamento")).toHaveLength(0);
  });

  it("a origem vai ao banco como hash: mesmo endereço, mesmo hash; outro endereço, outro", async () => {
    banco.responder(CRIAR, criado());
    await parear({ acao: "novo" }, { "cf-connecting-ip": "203.0.113.7" });
    await parear({ acao: "novo" }, { "cf-connecting-ip": "203.0.113.7" });
    await parear({ acao: "novo" }, { "cf-connecting-ip": "203.0.113.8" });
    const [a, b, c] = chamadasDe(CRIAR).map((ch) => ch.params?.p_origem_hash as string);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(c).toMatch(/^[0-9a-f]{64}$/);
    expect(c).not.toBe(a);
    // O endereço em claro não vai ao banco nem ao console.
    expect(tudoQueSaiu()).not.toContain("203.0.113");
  });

  it("o endereço que a borda escreve ganha do que quem chama pode inventar", async () => {
    banco.responder(CRIAR, criado());
    await parear({ acao: "novo" }, { "cf-connecting-ip": "203.0.113.7" });
    await parear(
      { acao: "novo" },
      { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 10.0.0.1" },
    );
    // Sem a borda, vale o primeiro da lista do x-forwarded-for.
    await parear({ acao: "novo" }, { "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" });
    await parear({ acao: "novo" }, { "x-forwarded-for": "198.51.100.1" });
    const [a, b, c, d] = chamadasDe(CRIAR).map((ch) => ch.params?.p_origem_hash);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(d).toBe(c);
  });

  it.each([
    ["fila cheia", { estado: "cheio", motivo: "fila", libera_em: "2026-10-01T18:04:00Z" }],
    [
      "muitos pedidos do mesmo endereço",
      { estado: "cheio", motivo: "origem", libera_em: "2026-10-01T18:04:00Z" },
    ],
  ])("%s: 429 com Retry-After, não 200 e não 503", async (_nome, resposta) => {
    banco.responder(CRIAR, ok(resposta));
    const r = await parear({ acao: "novo" });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    // A mesma resposta nos dois casos: quem enche não aprende em qual teto bateu.
    expect(await r.json()).toEqual({
      erro: "muitos_pareamentos",
      libera_em: "2026-10-01T18:04:00Z",
    });
    expect(chamadasDe(CRIAR)).toHaveLength(1);
  });

  it("código repetido: sorteia outro e segue", async () => {
    banco.responder(CRIAR, ok({ estado: "codigo_repetido" }), criado());
    const r = await parear({ acao: "novo" });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as Record<string, string>;
    const feitas = chamadasDe(CRIAR);
    expect(feitas).toHaveLength(2);
    // O que volta para a TV é o código que o banco aceitou, não o primeiro sorteado.
    expect(feitas[1].params?.p_codigo).toBe(corpo.codigo);
    expect(feitas[1].params?.p_retirada_hash).toBe(await hashDoSegredo(corpo.retirada));
  });

  it("três colisões seguidas ou banco fora: 503", async () => {
    banco.responder(CRIAR, ok({ estado: "codigo_repetido" }));
    const r = await parear({ acao: "novo" });
    expect(r.status).toBe(503);
    expect(chamadasDe(CRIAR)).toHaveLength(3);

    banco.chamadas.length = 0;
    banco.responder(CRIAR, falha());
    const r2 = await parear({ acao: "novo" });
    expect(r2.status).toBe(503);
    expect(await r2.json()).toEqual({ erro: "banco_indisponivel" });
    expect(chamadasDe(CRIAR)).toHaveLength(1);
  });
});

describe("POST /api/tv/parear — retirar", () => {
  const id = "0b0e3f3e-6f0f-4c0d-9d6c-2f5d0c1a7e11";

  it("ainda não aprovado: 200 aguardando, sem token", async () => {
    banco.responder(
      "tv_retirar_pareamento",
      ok({ estado: "aguardando", expira_em: "2026-10-01T18:10:00Z", validade_s: 412 }),
    );
    const r = await parear({ acao: "retirar", pareamento_id: id, retirada: gerarSegredo() });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      estado: "aguardando",
      expira_em: "2026-10-01T18:10:00Z",
      validade_s: 412,
    });
  });

  it("aprovado: 200 com o token, e o hash que foi ao banco é o desse token", async () => {
    const retirada = gerarSegredo();
    banco.responder(
      "tv_retirar_pareamento",
      ok({ estado: "pareado", nome: "TV da Oficina", repetido: false }),
    );
    const r = await parear({ acao: "retirar", pareamento_id: id, retirada });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const corpo = (await r.json()) as Record<string, string>;
    expect(Object.keys(corpo).sort()).toEqual(["estado", "nome", "token"]);
    expect(corpo.estado).toBe("pareado");
    expect(corpo.nome).toBe("TV da Oficina");
    expect(segredoBemFormado(corpo.token)).toBe(true);

    const [chamada] = chamadasDe("tv_retirar_pareamento");
    expect(chamada.params).toEqual({
      p_pareamento_id: id,
      p_retirada_hash: await hashDoSegredo(retirada),
      p_token_hash: await hashDoSegredo(corpo.token),
    });
    // Nem o token nem a retirada em claro: no banco e no console.
    expect(tudoQueSaiu()).not.toContain(corpo.token);
    expect(tudoQueSaiu()).not.toContain(retirada);
  });

  it("a retirada é repetível: mesmo pedido e mesmo segredo dão o MESMO token", async () => {
    // Resposta "pareado" perdida no Wi-Fi não pode deixar a TV sem crachá e um
    // dispositivo órfão em /telas. O token é derivado do segredo de retirada.
    const retirada = gerarSegredo();
    banco.responder(
      "tv_retirar_pareamento",
      ok({ estado: "pareado", nome: "TV", repetido: false }),
      ok({ estado: "pareado", nome: "TV", repetido: true }),
    );
    const primeira = (await (
      await parear({ acao: "retirar", pareamento_id: id, retirada })
    ).json()) as Record<string, string>;
    const segunda = (await (
      await parear({ acao: "retirar", pareamento_id: id.toUpperCase(), retirada })
    ).json()) as Record<string, string>;
    expect(segunda.token).toBe(primeira.token);
    const [a, b] = chamadasDe("tv_retirar_pareamento");
    expect(b.params?.p_token_hash).toBe(a.params?.p_token_hash);
    // `repetido` é assunto do banco; a TV recebe o mesmo corpo nas duas vezes.
    expect(Object.keys(segunda).sort()).toEqual(["estado", "nome", "token"]);
  });

  it("o token depende do segredo E do pedido, e não é o segredo", async () => {
    const outroId = "7c1f0d7a-2b7e-4a51-8d55-0f3b1e9a4c22";
    const retirada = gerarSegredo();
    banco.responder("tv_retirar_pareamento", ok({ estado: "pareado", nome: "TV" }));
    const token = async (pareamento_id: string, segredo: string) =>
      (
        (await (
          await parear({ acao: "retirar", pareamento_id, retirada: segredo })
        ).json()) as Record<string, string>
      ).token;
    const base = await token(id, retirada);
    expect(await token(id, gerarSegredo())).not.toBe(base);
    expect(await token(outroId, retirada)).not.toBe(base);
    expect(base).not.toBe(retirada);
    // Nem o hash: quem lê `retirada_hash` no banco não tem o `token_hash`.
    const [chamada] = chamadasDe("tv_retirar_pareamento");
    expect(chamada.params?.p_token_hash).not.toBe(chamada.params?.p_retirada_hash);
  });

  it.each(["expirado", "consumido"])("%s: 200 com o estado e sem token", async (estado) => {
    banco.responder("tv_retirar_pareamento", ok({ estado }));
    const r = await parear({ acao: "retirar", pareamento_id: id, retirada: gerarSegredo() });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado });
  });

  it("segredo errado ou pedido inexistente: 401 sem dizer qual", async () => {
    banco.responder("tv_retirar_pareamento", ok({ estado: "recusado" }));
    const r = await parear({ acao: "retirar", pareamento_id: id, retirada: gerarSegredo() });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ erro: "pareamento_recusado" });
  });

  it("pedido mal formado recebe a mesma recusa, sem ir ao banco", async () => {
    const casos = [
      { acao: "retirar" },
      { acao: "retirar", pareamento_id: id },
      { acao: "retirar", pareamento_id: "não é uuid", retirada: gerarSegredo() },
      { acao: "retirar", pareamento_id: id, retirada: "curto" },
      { acao: "retirar", pareamento_id: id, retirada: 12345 },
    ];
    for (const caso of casos) {
      const r = await parear(caso);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ erro: "pareamento_recusado" });
    }
    expect(banco.chamadas).toHaveLength(0);
  });

  it("banco fora ou estado desconhecido: 503, e o token não sai", async () => {
    for (const resposta of [
      falha(),
      ok(null),
      ok({ estado: "talvez" }),
      new Error("fetch failed"),
    ]) {
      banco.responder("tv_retirar_pareamento", resposta);
      const r = await parear({ acao: "retirar", pareamento_id: id, retirada: gerarSegredo() });
      expect(r.status).toBe(503);
      const corpo = (await r.json()) as Record<string, unknown>;
      expect(corpo).toEqual({ erro: "banco_indisponivel" });
      expect("token" in corpo).toBe(false);
    }
  });
});

describe("POST /api/tv/parear — pedidos tortos", () => {
  it("corpo que não é JSON ou não é objeto: 400", async () => {
    for (const corpo of ["isto não é json", "[]", "null", '"novo"']) {
      const r = await parear(corpo);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ erro: "corpo_invalido" });
    }
    expect(banco.chamadas).toHaveLength(0);
  });

  it("ação que não existe: 400", async () => {
    for (const corpo of [{}, { acao: "aprovar" }, { acao: "listar" }, { acao: 1 }]) {
      const r = await parear(corpo);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ erro: "acao_desconhecida" });
    }
    // Aprovar é da tela logada (RPC com guarda de papel), nunca desta rota pública.
    expect(banco.chamadas).toHaveLength(0);
  });

  it("GET de saúde não toca no banco", async () => {
    const r = saudeDoPareamento();
    expect(r.status).toBe(200);
    expect(banco.chamadas).toHaveLength(0);
  });
});
