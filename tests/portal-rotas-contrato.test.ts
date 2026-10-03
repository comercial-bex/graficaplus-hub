import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gerarSegredo, hashDoSegredo } from "../src/domain/whatsapp/segredo-webhook";
import { FORMATO_DO_CAMINHO } from "../src/domain/portal/envio-de-arquivo";
import { MENSAGEM_LINK_INVALIDO } from "../src/domain/portal/link-do-portal";

/**
 * O CONTRATO das rotas do portal por link, exercido de verdade — com o banco e
 * o Storage trocados por um dublê que responde o que o teste mandar.
 *
 * O que está em jogo é o defeito que a página tinha: responder "recebido" sem
 * gravar. Aqui, 200 só sai quando a função do banco devolveu `ok: true`; banco
 * fora é 503 (nunca "link inválido", que faria o cliente pedir outro link à
 * toa); link fechado é 401 com a frase combinada.
 */

type Chamada = { nome: string; params: Record<string, unknown> | undefined };

const dubles = vi.hoisted(() => {
  const estado = {
    chamadas: [] as { nome: string; params: Record<string, unknown> | undefined }[],
    fila: new Map<string, unknown[]>(),
    storage: [] as { bucket: string; metodo: string; args: unknown[] }[],
    storageResposta: null as unknown,
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
    from(bucket: string) {
      const registrar =
        (metodo: string) =>
        (...args: unknown[]) => {
          estado.storage.push({ bucket, metodo, args });
          const r = estado.storageResposta;
          if (r instanceof Error) throw r;
          return Promise.resolve(r);
        };
      return {
        createSignedUploadUrl: registrar("createSignedUploadUrl"),
        createSignedUrl: registrar("createSignedUrl"),
      };
    },
  };
  return estado;
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (nome: string, params?: Record<string, unknown>) => dubles.rpc(nome, params),
    storage: { from: (bucket: string) => dubles.from(bucket) },
  },
}));

import {
  processarArquivo,
  processarArte,
  processarEnvio,
  processarMensagem,
  responderPainel,
} from "../src/lib/api/portal-link.server";

const ok = (data: unknown) => ({ data, error: null });
const falha = () => ({ data: null, error: { code: "57014", message: "canceling statement" } });
const chamadasDe = (nome: string): Chamada[] => dubles.chamadas.filter((c) => c.nome === nome);

const CLIENTE = "204f09f6-2249-4454-938b-c938ac5cb530";
const OS = "135e06e7-94ec-4e22-bf4f-67935eb8d6f5";
const ARQUIVO = "5665e94b-da10-4a94-8ada-ba379d14a682";

let erros: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dubles.chamadas.length = 0;
  dubles.fila.clear();
  dubles.storage.length = 0;
  dubles.storageResposta = null;
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  erros.mockRestore();
});

function pedir(
  rota: string,
  token: string | undefined,
  corpo?: unknown,
  url = `https://print.exemplo${rota}`,
): Request {
  const headers = new Headers();
  if (token !== undefined) headers.set("x-portal-token", token);
  if (corpo !== undefined) headers.set("content-type", "application/json");
  return new Request(url, {
    method: corpo === undefined ? "GET" : "POST",
    headers,
    body:
      corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

/** Tudo que foi dito ao console e mandado ao banco, num texto só. */
function tudoQueSaiu(): string {
  return JSON.stringify([erros.mock.calls, dubles.chamadas, dubles.storage]);
}

const PAINEL = {
  situacao: "aberto",
  vence_em: "2026-11-01T12:00:00Z",
  versao: 1,
  cliente: { id: CLIENTE, nome: "Guilherme Menezes" },
  ordens: [{ numero: 44, valor_pedido: 121.15 }],
};

describe("GET /api/portal/painel", () => {
  it("sem token ou token mal formado: 401, sem nem ir ao banco", async () => {
    for (const token of [undefined, "", "orc-245", "a".repeat(42), `${"a".repeat(42)}=`]) {
      const r = await responderPainel(pedir("/api/portal/painel", token));
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ erro: "link_invalido", mensagem: MENSAGEM_LINK_INVALIDO });
    }
    expect(dubles.chamadas).toHaveLength(0);
  });

  it("token na URL da rota não vale: só o cabeçalho é lido", async () => {
    const token = gerarSegredo();
    const r = await responderPainel(
      pedir(
        "/api/portal/painel",
        undefined,
        undefined,
        `https://print.exemplo/api/portal/painel?token=${token}`,
      ),
    );
    expect(r.status).toBe(401);
    expect(dubles.chamadas).toHaveLength(0);
  });

  it.each(["invalido", "vencido", "revogado"])(
    "link %s: 401 com a frase combinada",
    async (situacao) => {
      dubles.responder("portal_link_abrir", ok({ situacao }));
      const r = await responderPainel(pedir("/api/portal/painel", gerarSegredo()));
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ erro: "link_invalido", mensagem: MENSAGEM_LINK_INVALIDO });
    },
  );

  it("link bom: 200 com o jsonb da função, sem mexer, sem cache, e o banco recebe só o hash", async () => {
    const token = gerarSegredo();
    dubles.responder("portal_link_abrir", ok(PAINEL));
    const r = await responderPainel(pedir("/api/portal/painel", token));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual(PAINEL);
    expect(chamadasDe("portal_link_abrir")[0].params).toEqual({
      p_token_hash: await hashDoSegredo(token),
    });
    expect(tudoQueSaiu()).not.toContain(token);
  });

  it.each([
    ["erro do banco", falha()],
    ["resposta nula", ok(null)],
    ["lista em vez de objeto", ok([])],
    ["situação que o servidor não conhece", ok({ situacao: "talvez" })],
    [
      "exceção (sem chave de serviço, rede fora)",
      new Error("Missing Supabase environment variable(s)"),
    ],
  ])("%s: 503 — nunca 401, que faria o cliente pedir outro link à toa", async (_nome, resposta) => {
    dubles.responder("portal_link_abrir", resposta);
    const r = await responderPainel(pedir("/api/portal/painel", gerarSegredo()));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ erro: "portal_indisponivel" });
  });

  it("a falha é registrada sem token e sem hash", async () => {
    const token = gerarSegredo();
    dubles.responder("portal_link_abrir", falha());
    await responderPainel(pedir("/api/portal/painel", token));
    const dito = JSON.stringify(erros.mock.calls);
    expect(dito).toContain("portal_link_abrir");
    expect(dito).not.toContain(token);
    expect(dito).not.toContain(await hashDoSegredo(token));
  });
});

describe("POST /api/portal/envio — preparar", () => {
  const preparar = (corpo: Record<string, unknown>, token = gerarSegredo()) =>
    processarEnvio(pedir("/api/portal/envio", token, { acao: "preparar", ...corpo }));

  it("corpo torto: 400 sem ir ao banco", async () => {
    for (const corpo of [
      { tipo: "executavel", os_id: OS, nome: "a.pdf", tamanho: 10 },
      { tipo: "arte", os_id: "44", nome: "a.pdf", tamanho: 10 },
      { tipo: "arte", os_id: OS, nome: "", tamanho: 10 },
      { tipo: "arte", os_id: OS, nome: "a.pdf", tamanho: 0 },
      { tipo: "arte", os_id: OS, nome: "a.pdf", tamanho: 60 * 1024 * 1024 },
    ]) {
      const r = await preparar(corpo);
      expect(r.status, JSON.stringify(corpo)).toBe(400);
    }
    const r = await processarEnvio(pedir("/api/portal/envio", gerarSegredo(), "{nao é json"));
    expect(r.status).toBe(400);
    expect(dubles.chamadas).toHaveLength(0);
  });

  it("a pasta é montada com o cliente que o BANCO tirou do link — não com o do navegador", async () => {
    const token = gerarSegredo();
    dubles.responder(
      "portal_link_abrir_envio",
      ok({ situacao: "aberto", ok: true, cliente_id: CLIENTE }),
    );
    dubles.storageResposta = {
      data: { token: "assinatura-de-envio", signedUrl: "x", path: "p" },
      error: null,
    };
    const r = await preparar(
      {
        tipo: "arte",
        os_id: OS,
        nome: "Cartão São João.PDF",
        tamanho: 2048,
        cliente_id: "00000000-0000-4000-8000-000000000000",
      },
      token,
    );
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.bucket).toBe("arquivos-clientes");
    expect(corpo.assinatura).toBe("assinatura-de-envio");
    expect(corpo.caminho).toMatch(FORMATO_DO_CAMINHO);
    expect(corpo.caminho.startsWith(`portal/${CLIENTE}/${OS}/`)).toBe(true);
    expect(corpo.caminho).toMatch(/-Cartao-Sao-Joao\.pdf$/);
    expect(dubles.storage).toEqual([
      { bucket: "arquivos-clientes", metodo: "createSignedUploadUrl", args: [corpo.caminho] },
    ]);
    expect(chamadasDe("portal_link_abrir_envio")[0].params).toEqual({
      p_token_hash: await hashDoSegredo(token),
      p_os_id: OS,
      p_tipo: "arte",
    });
  });

  it("comprovante vai para o bucket do financeiro, e pode vir sem pedido", async () => {
    dubles.responder(
      "portal_link_abrir_envio",
      ok({ situacao: "aberto", ok: true, cliente_id: CLIENTE }),
    );
    dubles.storageResposta = { data: { token: "t", signedUrl: "x", path: "p" }, error: null };
    const r = await preparar({ tipo: "comprovante", os_id: null, nome: "pix.jpg", tamanho: 900 });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.bucket).toBe("comprovantes");
    expect(corpo.caminho.startsWith(`portal/${CLIENTE}/sem-os/`)).toBe(true);
  });

  it("o banco recusa com motivo: 422 com o motivo, e nada de URL de envio", async () => {
    dubles.responder(
      "portal_link_abrir_envio",
      ok({ situacao: "aberto", ok: false, mensagem: "Este pedido não está na sua lista." }),
    );
    const r = await preparar({ tipo: "arte", os_id: OS, nome: "a.pdf", tamanho: 10 });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      erro: "recusado",
      mensagem: "Este pedido não está na sua lista.",
    });
    expect(dubles.storage).toHaveLength(0);
  });

  it("link cancelado: 401", async () => {
    dubles.responder("portal_link_abrir_envio", ok({ situacao: "revogado" }));
    const r = await preparar({ tipo: "arte", os_id: OS, nome: "a.pdf", tamanho: 10 });
    expect(r.status).toBe(401);
  });

  it.each([
    ["Storage recusou", { data: null, error: { name: "StorageApiError" } }],
    ["Storage fora", new Error("fetch failed")],
  ])("%s: 503", async (_nome, resposta) => {
    dubles.responder(
      "portal_link_abrir_envio",
      ok({ situacao: "aberto", ok: true, cliente_id: CLIENTE }),
    );
    dubles.storageResposta = resposta;
    const r = await preparar({ tipo: "arte", os_id: OS, nome: "a.pdf", tamanho: 10 });
    expect(r.status).toBe(503);
  });

  it("cliente_id que não é uuid vindo do banco: 503, nunca uma pasta inventada", async () => {
    dubles.responder(
      "portal_link_abrir_envio",
      ok({ situacao: "aberto", ok: true, cliente_id: "../x" }),
    );
    const r = await preparar({ tipo: "arte", os_id: OS, nome: "a.pdf", tamanho: 10 });
    expect(r.status).toBe(503);
    expect(dubles.storage).toHaveLength(0);
  });
});

describe("POST /api/portal/envio — confirmar", () => {
  const caminho = `portal/${CLIENTE}/${OS}/1790000000000-arte.pdf`;
  const confirmar = (corpo: Record<string, unknown>, token = gerarSegredo()) =>
    processarEnvio(pedir("/api/portal/envio", token, { acao: "confirmar", ...corpo }));

  it("caminho fora da pasta do portal: 400 sem ir ao banco", async () => {
    for (const c of ["../../etc", "orcamento/x/1.pdf", `portal/${CLIENTE}/${OS}/a b.pdf`, 42]) {
      const r = await confirmar({ tipo: "arte", os_id: OS, nome: "arte.pdf", caminho: c });
      expect(r.status).toBe(400);
    }
    expect(dubles.chamadas).toHaveLength(0);
  });

  it("gravou: 200 com o protocolo que o banco gerou", async () => {
    const token = gerarSegredo();
    dubles.responder(
      "portal_link_registrar_envio",
      ok({ situacao: "aberto", ok: true, protocolo: "C28D47BE", os_numero: 44, tipo: "arte" }),
    );
    const r = await confirmar(
      { tipo: "arte", os_id: OS, nome: "arte.pdf", caminho, mensagem: "usar no topo" },
      token,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      ok: true,
      protocolo: "C28D47BE",
      os_numero: 44,
      tipo: "arte",
    });
    expect(chamadasDe("portal_link_registrar_envio")[0].params).toEqual({
      p_token_hash: await hashDoSegredo(token),
      p_os_id: OS,
      p_tipo: "arte",
      p_caminho: caminho,
      p_nome: "arte.pdf",
      p_mensagem: "usar no topo",
    });
  });

  it.each([
    [
      "o banco recusou",
      ok({
        situacao: "aberto",
        ok: false,
        mensagem: "O arquivo não chegou ao armazenamento. Envie de novo.",
      }),
      422,
    ],
    ["o banco não disse se gravou", ok({ situacao: "aberto" }), 503],
    ["link vencido", ok({ situacao: "vencido" }), 401],
    ["banco fora", falha(), 503],
  ])("%s: %s — nunca 200 sem gravação", async (_nome, resposta, status) => {
    dubles.responder("portal_link_registrar_envio", resposta);
    const r = await confirmar({ tipo: "arte", os_id: OS, nome: "arte.pdf", caminho });
    expect(r.status).toBe(status);
    expect(JSON.stringify(await r.json())).not.toMatch(/recebemos/i);
  });

  it("ação desconhecida: 400", async () => {
    const r = await processarEnvio(
      pedir("/api/portal/envio", gerarSegredo(), {
        acao: "apagar",
        tipo: "arte",
        os_id: OS,
        nome: "a",
      }),
    );
    expect(r.status).toBe(400);
  });
});

describe("POST /api/portal/arte", () => {
  const decidir = (corpo: Record<string, unknown>, token = gerarSegredo()) =>
    processarArte(pedir("/api/portal/arte", token, corpo));

  it("decisão que não existe: 400 sem ir ao banco", async () => {
    for (const corpo of [
      { arquivo_id: ARQUIVO, decisao: "reprovado" },
      { arquivo_id: "x", decisao: "aprovado" },
      { arquivo_id: ARQUIVO, decisao: "ajuste", comentario: "x".repeat(1001) },
    ]) {
      expect((await decidir(corpo)).status).toBe(400);
    }
    expect(dubles.chamadas).toHaveLength(0);
  });

  it("aprovou: 200, com a OS que andou", async () => {
    const token = gerarSegredo();
    dubles.responder(
      "portal_link_decidir_arte",
      ok({ situacao: "aberto", ok: true, decisao: "aprovado", os_numero: 44 }),
    );
    const r = await decidir({ arquivo_id: ARQUIVO, decisao: "aprovado" }, token);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, decisao: "aprovado", os_numero: 44 });
    expect(chamadasDe("portal_link_decidir_arte")[0].params).toEqual({
      p_token_hash: await hashDoSegredo(token),
      p_arquivo_id: ARQUIVO,
      p_decisao: "aprovado",
      p_comentario: null,
    });
  });

  it("arte que não espera mais resposta: 422 com o motivo do banco", async () => {
    dubles.responder(
      "portal_link_decidir_arte",
      ok({
        situacao: "aberto",
        ok: false,
        mensagem: "Esta arte não está mais esperando a sua resposta.",
      }),
    );
    const r = await decidir({ arquivo_id: ARQUIVO, decisao: "aprovado" });
    expect(r.status).toBe(422);
  });
});

describe("POST /api/portal/arquivo", () => {
  const abrir = (corpo: Record<string, unknown>) =>
    processarArquivo(pedir("/api/portal/arquivo", gerarSegredo(), corpo));

  it("arquivo que não é do cliente: 404, sem URL", async () => {
    dubles.responder("portal_link_objeto", ok({ situacao: "aberto", ok: false }));
    const r = await abrir({ tipo: "arquivo", id: ARQUIVO, para: "ver" });
    expect(r.status).toBe(404);
    expect(dubles.storage).toHaveLength(0);
  });

  it("comprovante não sai por aqui, mesmo que o banco mandasse", async () => {
    dubles.responder(
      "portal_link_objeto",
      ok({
        situacao: "aberto",
        ok: true,
        bucket: "comprovantes",
        caminho: "portal/x/sem-os/1-a.jpg",
        nome: "a.jpg",
      }),
    );
    const r = await abrir({ tipo: "arquivo", id: ARQUIVO, para: "baixar" });
    expect(r.status).toBe(503);
    expect(dubles.storage).toHaveLength(0);
  });

  it("baixar: URL assinada de 10 minutos, com o nome do arquivo", async () => {
    dubles.responder(
      "portal_link_objeto",
      ok({
        situacao: "aberto",
        ok: true,
        bucket: "documentos-pdf",
        caminho: "os/44.pdf",
        nome: "OS-44.pdf",
        mime: "application/pdf",
      }),
    );
    dubles.storageResposta = { data: { signedUrl: "https://storage/assinada" }, error: null };
    const r = await abrir({ tipo: "documento", id: ARQUIVO, para: "baixar" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      url: "https://storage/assinada",
      nome: "OS-44.pdf",
      mime: "application/pdf",
    });
    expect(dubles.storage).toEqual([
      {
        bucket: "documentos-pdf",
        metodo: "createSignedUrl",
        args: ["os/44.pdf", 600, { download: "OS-44.pdf" }],
      },
    ]);
  });

  it("tipo que não existe: 400", async () => {
    expect((await abrir({ tipo: "comprovante", id: ARQUIVO })).status).toBe(400);
  });
});

describe("POST /api/portal/mensagem", () => {
  const mandar = (corpo: Record<string, unknown>) =>
    processarMensagem(pedir("/api/portal/mensagem", gerarSegredo(), corpo));

  it("assunto que não existe ou texto curto: 400 sem ir ao banco", async () => {
    expect((await mandar({ tipo: "pagamento", mensagem: "paguei ontem" })).status).toBe(400);
    expect((await mandar({ tipo: "duvida", mensagem: "oi" })).status).toBe(400);
    expect(dubles.chamadas).toHaveLength(0);
  });

  it("gravou: 200 com o protocolo", async () => {
    dubles.responder(
      "portal_link_enviar_mensagem",
      ok({ situacao: "aberto", ok: true, protocolo: "AB12CD34", os_numero: null }),
    );
    const r = await mandar({ tipo: "entrega", os_id: null, mensagem: "Posso retirar sábado?" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, protocolo: "AB12CD34", os_numero: null });
  });
});
