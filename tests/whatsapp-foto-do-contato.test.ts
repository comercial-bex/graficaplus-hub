import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  caminhoDaFoto,
  chaveDaFoto,
  ehImagem,
  fotoDoEvento,
  linkAindaVale,
  linkDaRespostaDoZapi,
  precisaGuardar,
  urlDeFotoConfiavel,
  vencimentoDoLink,
} from "@/domain/whatsapp/foto-do-contato";

/**
 * 14/10/2026, pedido do dono: "não aparece a foto da pessoa". O Z-API manda a
 * foto em todo ReceivedCallback (conferido nos eventos do banco); o link vence
 * em ~10 dias (oe=6ADC91AD → 24/10/2026). O que se segura:
 *   - só link https de host do WhatsApp entra (nada de baixar link qualquer);
 *   - grupo, canal e lista de transmissão não dão foto de contato;
 *   - a chave ignora a assinatura do link: mesma foto não é baixada de novo;
 *   - o servidor guarda a cópia, e o webhook nunca cai por causa da foto.
 */

// Link real do evento de 14/10/2026 (Cibele), com o parâmetro de vencimento.
const LINK =
  "https://pps.whatsapp.net/v/t61.24694-24/644705561_1718598132781750_8621810898558989608_n.jpg?ccb=11-4&oh=01_Q5Aa&oe=6ADC91AD&_nc_sid=5e03e0&_nc_cat=105";

function evento(extra: Record<string, unknown> = {}) {
  return {
    type: "ReceivedCallback",
    instanceId: "I1",
    phone: "559681176844",
    isGroup: false,
    fromMe: false,
    photo: LINK,
    ...extra,
  };
}

describe("o link da foto", () => {
  it("só https de host do WhatsApp/Meta", () => {
    expect(urlDeFotoConfiavel(LINK)?.hostname).toBe("pps.whatsapp.net");
    expect(urlDeFotoConfiavel("https://scontent.fbcdn.net/x.jpg")).not.toBeNull();
    expect(urlDeFotoConfiavel("http://pps.whatsapp.net/x.jpg")).toBeNull();
    expect(urlDeFotoConfiavel("https://evil.example.com/pps.whatsapp.net.jpg")).toBeNull();
    expect(urlDeFotoConfiavel("https://whatsapp.net.evil.com/x.jpg")).toBeNull();
    expect(urlDeFotoConfiavel(null)).toBeNull();
    expect(urlDeFotoConfiavel("não é link")).toBeNull();
  });

  it("vence pelo oe (hexadecimal): o de 14/10 vale até 24/10", () => {
    const u = urlDeFotoConfiavel(LINK)!;
    expect(vencimentoDoLink(u)?.toISOString()).toBe("2026-10-24T11:08:29.000Z");
    expect(linkAindaVale(u, new Date("2026-10-20T00:00:00Z"))).toBe(true);
    expect(linkAindaVale(u, new Date("2026-10-24T10:30:00Z"))).toBe(false); // menos de 1 h de folga
    expect(linkAindaVale(new URL("https://pps.whatsapp.net/a.jpg"), new Date())).toBe(true);
  });

  it("a chave é o caminho, sem a assinatura: mesma foto, mesma chave", () => {
    const a = chaveDaFoto(urlDeFotoConfiavel(LINK)!);
    const b = chaveDaFoto(urlDeFotoConfiavel(LINK.replace("oe=6ADC91AD", "oe=6ADD0000").replace("oh=01_Q5Aa", "oh=XYZ"))!);
    expect(a).toBe(b);
    expect(a).toBe("pps.whatsapp.net/v/t61.24694-24/644705561_1718598132781750_8621810898558989608_n.jpg");
    expect(precisaGuardar({ foto_path: "fotos/c.jpg", foto_chave: a }, b)).toBe(false);
    expect(precisaGuardar({ foto_path: "fotos/c.jpg", foto_chave: a }, "pps.whatsapp.net/outra.jpg")).toBe(true);
    expect(precisaGuardar({ foto_path: null, foto_chave: a }, a)).toBe(true);
  });
});

describe("a foto que o evento traz", () => {
  it("mensagem de pessoa: telefone, link e chave", () => {
    const f = fotoDoEvento(evento());
    expect(f?.telefone).toBe("559681176844");
    expect(f?.chave).toContain("644705561_");
  });

  it("vale também o eco do que a API mandou (a foto do contato vem nele)", () => {
    expect(fotoDoEvento(evento({ fromMe: true, fromApi: true }))).not.toBeNull();
  });

  it("grupo, canal, transmissão, status, sem foto ou outro tipo: nada", () => {
    expect(fotoDoEvento(evento({ isGroup: true }))).toBeNull();
    expect(fotoDoEvento(evento({ isNewsletter: true }))).toBeNull();
    expect(fotoDoEvento(evento({ broadcast: true }))).toBeNull();
    expect(fotoDoEvento(evento({ phone: "status@broadcast" }))).toBeNull();
    expect(fotoDoEvento(evento({ phone: "120363-group" }))).toBeNull();
    expect(fotoDoEvento(evento({ photo: null }))).toBeNull();
    expect(fotoDoEvento(evento({ type: "MessageStatusCallback" }))).toBeNull();
    expect(fotoDoEvento(null)).toBeNull();
  });
});

describe("a resposta do Z-API e o arquivo", () => {
  it("GET /profile-picture devolve [{link}] (documentação do Z-API); {link} também serve", () => {
    expect(linkDaRespostaDoZapi([{ link: LINK }])?.hostname).toBe("pps.whatsapp.net");
    expect(linkDaRespostaDoZapi({ link: LINK })).not.toBeNull();
    expect(linkDaRespostaDoZapi([{ link: null }])).toBeNull(); // contato não mostra foto
    expect(linkDaRespostaDoZapi([])).toBeNull();
    expect(linkDaRespostaDoZapi([{ link: "https://evil.example.com/x.jpg" }])).toBeNull();
  });

  it("só imagem de verdade vira foto", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
    const html = new TextEncoder().encode("<html>erro</html>");
    expect(ehImagem("image/jpeg", jpeg)).toBe(true);
    expect(ehImagem(null, png)).toBe(true);
    expect(ehImagem("text/html", jpeg)).toBe(false);
    expect(ehImagem("image/jpeg", html)).toBe(false);
  });

  it("uma cópia por conversa", () => {
    expect(caminhoDaFoto("8b6d609e-7efa-427b-8aba-fa4f90156fe2")).toBe("fotos/8b6d609e-7efa-427b-8aba-fa4f90156fe2.jpg");
  });
});

/* ------------------------------------------------------------------ */
/* O servidor, com banco, Storage e rede trocados por dublês           */
/* ------------------------------------------------------------------ */

const banco = vi.hoisted(() => ({
  conversa: null as Record<string, unknown> | null,
  pendentes: [] as Record<string, unknown>[],
  uploads: [] as { caminho: string; tipo: string; bytes: number }[],
  updates: [] as Record<string, unknown>[],
  rpcs: [] as { nome: string; params: Record<string, unknown> }[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (nome: string, params: Record<string, unknown>) => {
      banco.rpcs.push({ nome, params });
      if (nome === "whatsapp_conversa_do_telefone") return Promise.resolve({ data: banco.conversa ? [banco.conversa] : [], error: null });
      if (nome === "whatsapp_fotos_pendentes") return Promise.resolve({ data: banco.pendentes, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from: () => ({
        upload: (caminho: string, bytes: Uint8Array, op: { contentType: string }) => {
          banco.uploads.push({ caminho, tipo: op.contentType, bytes: bytes.byteLength });
          return Promise.resolve({ error: null });
        },
      }),
    },
    from: () => {
      const cadeia: Record<string, unknown> = {};
      cadeia.update = (v: Record<string, unknown>) => {
        banco.updates.push(v);
        return cadeia;
      };
      cadeia.select = () => cadeia;
      cadeia.eq = () => cadeia;
      cadeia.limit = () => cadeia;
      cadeia.maybeSingle = () => Promise.resolve({ data: { zapi_instance_id: "I1" }, error: null });
      cadeia.then = (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r);
      return cadeia;
    },
  },
}));

import { fotoPeloWebhook, fotosPendentes } from "@/lib/api/whatsapp-fotos.server";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(1)]);
const baixaJpeg = (async () =>
  new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;

beforeEach(() => {
  banco.conversa = { conversa_id: "c-1", foto_path: null, foto_chave: null };
  banco.pendentes = [];
  banco.uploads = [];
  banco.updates = [];
  banco.rpcs = [];
});

describe("o webhook guarda a foto", () => {
  it("conversa sem foto: baixa, guarda em fotos/<conversa>.jpg e grava a chave", async () => {
    expect(await fotoPeloWebhook(evento(), "inst-1", baixaJpeg)).toBe("foto: guardada");
    expect(banco.rpcs[0]).toEqual({
      nome: "whatsapp_conversa_do_telefone",
      params: { p_instancia_id: "inst-1", p_telefone: "559681176844" },
    });
    expect(banco.uploads).toEqual([{ caminho: "fotos/c-1.jpg", tipo: "image/jpeg", bytes: JPEG.byteLength }]);
    expect(banco.updates[0]).toMatchObject({ foto_path: "fotos/c-1.jpg", foto_chave: expect.stringContaining("644705561_") });
  });

  it("mesma foto (link com outra assinatura): não baixa de novo", async () => {
    banco.conversa = { conversa_id: "c-1", foto_path: "fotos/c-1.jpg", foto_chave: chaveDaFoto(new URL(LINK)) };
    let baixou = false;
    const espia = (async () => {
      baixou = true;
      return new Response(JPEG);
    }) as unknown as typeof fetch;
    expect(await fotoPeloWebhook(evento({ photo: LINK.replace("oe=6ADC91AD", "oe=6ADE0000") }), "inst-1", espia)).toBe("foto: a mesma");
    expect(baixou).toBe(false);
  });

  it("link que não devolve imagem: diz o motivo e NÃO lança (o 200 do webhook fica)", async () => {
    const html = (async () => new Response("<html/>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const r = await fotoPeloWebhook(evento(), "inst-1", html);
    expect(r).toContain("não devolveu imagem");
    expect(banco.uploads).toEqual([]);
  });

  it("evento sem foto: nem consulta o banco", async () => {
    expect(await fotoPeloWebhook(evento({ photo: null }), "inst-1", baixaJpeg)).toBeNull();
    expect(banco.rpcs).toEqual([]);
  });
});

describe("as pendentes (job do pg_cron)", () => {
  it("usa a foto que o webhook viu se o link ainda vale; senão pergunta ao Z-API", async () => {
    process.env.ZAPI_TOKEN = "tk";
    process.env.ZAPI_CLIENT_TOKEN = "ct";
    banco.pendentes = [
      { conversa_id: "c-velha", instancia_id: "inst-1", telefone: "5596981216527", ultima_foto: LINK.replace("oe=6ADC91AD", "oe=60000000") },
      { conversa_id: "c-nova", instancia_id: "inst-1", telefone: "559681176844", ultima_foto: LINK },
      { conversa_id: "c-privada", instancia_id: "inst-1", telefone: "5596991578102", ultima_foto: null },
    ];
    const pedidos: string[] = [];
    const rede = (async (url: string, init?: RequestInit) => {
      pedidos.push(url);
      if (url.includes("/profile-picture")) {
        expect((init?.headers as Record<string, string>)["Client-Token"]).toBe("ct");
        const link = url.includes("5596991578102") ? null : LINK;
        return new Response(JSON.stringify([{ link }]), { status: 200 });
      }
      return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;

    const r = await fotosPendentes(5, rede);
    expect(r).toEqual({ guardadas: 2, sem_foto: 1, falhas: [] });
    // c-velha: link vencido → Z-API; c-nova: link do webhook direto; c-privada: Z-API sem link.
    expect(pedidos.filter((u) => u.includes("/profile-picture"))).toEqual([
      "https://api.z-api.io/instances/I1/token/tk/profile-picture?phone=5596981216527",
      "https://api.z-api.io/instances/I1/token/tk/profile-picture?phone=5596991578102",
    ]);
    expect(banco.uploads.map((u) => u.caminho)).toEqual(["fotos/c-velha.jpg", "fotos/c-nova.jpg"]);
    // Sem foto: só a tentativa anotada (volta em 7 dias).
    expect(banco.updates.at(-1)).toEqual({ foto_tentativa_em: expect.any(String) });
  });
});

describe("a migração e o webhook", () => {
  const sql = readFileSync("supabase/migrations/20261014150000_whatsapp_foto_do_contato_e_aviso_de_transferencia.sql", "utf8");
  const webhook = readFileSync("src/lib/api/whatsapp-webhook.server.ts", "utf8");

  it("as funções novas são só do servidor, conferidas com has_function_privilege", () => {
    for (const f of [
      "whatsapp_conversa_do_telefone(uuid, text)",
      "whatsapp_fotos_pendentes(integer)",
      "_wa_enfileirar_mensagem_da_equipe(uuid, uuid, text, text, text)",
      "whatsapp_transferir_fila(uuid, uuid, text, text, text)",
      "whatsapp_transferir(uuid, uuid, uuid, text)",
    ]) {
      expect(sql).toContain(`'public.${f}'`);
    }
    expect(sql).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated");
    expect(sql).toMatch(/has_function_privilege\('anon', v_funcao, 'EXECUTE'\)/);
  });

  it("casa o telefone como whatsapp_registrar_mensagem (normalize dos dois lados)", () => {
    expect(sql).toContain(
      "public.normalize_whatsapp_phone(c.telefone) = public.normalize_whatsapp_phone(p_telefone)",
    );
  });

  it("a foto roda depois da mensagem gravada e dentro de try (nunca derruba o 200)", () => {
    const i = webhook.indexOf("fotoPeloWebhook(payload, instancia.id)");
    expect(i).toBeGreaterThan(webhook.indexOf("resultado = await tratar("));
    expect(webhook.slice(webhook.lastIndexOf("try {", i), i)).toContain("await import(");
  });
});
