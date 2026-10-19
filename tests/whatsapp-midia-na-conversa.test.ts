import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MensagemDaCaixa } from "../src/domain/whatsapp/caixa-de-entrada";
import {
  categoriaDaMidia,
  extensaoDoLink,
  nomeParaBaixar,
  precisaArquivar,
  temArquivo,
  temCopiaNossa,
} from "../src/domain/whatsapp/midia";

/**
 * Mídia na conversa do WhatsApp (19/10/2026). O dono: "só aparece o link com o
 * dia; quando é vídeo, foto ou áudio não aparece para baixar nem para ver
 * direto". Até então toda mídia virava "Abrir foto (link do Z-API, vale 30
 * dias)". Agora a foto aparece, o vídeo e o áudio tocam na bolha, e todo
 * arquivo tem "Baixar".
 *
 * Achado de carona: duas fotos recebidas (09/10 e 18/10) ficaram só com o link
 * do Z-API (vence em 30 dias), sem cópia nossa e sem erro registrado. A
 * conversa agora copia sozinha o que ficou só com o link.
 */

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
  createServerFn: () => {
    throw new Error("o desenho da bolha não declara função de servidor");
  },
}));
vi.mock("@/lib/api/whatsapp-midia.functions", () => ({
  guardarMidiaDaMensagem: vi.fn(async () => ({ ok: true, caminho: "x", reaproveitada: false })),
}));
vi.mock("@/components/whatsapp/usar-caixa-de-entrada", () => ({
  linkDaMidia: vi.fn(async () => "https://assinado.exemplo/arquivo"),
}));

import { MidiaDaMensagem } from "../src/components/whatsapp/midia-da-mensagem";

const Z = "https://f004.backblazeb2.com/file/temp-file-download/instances/I/C/ZK2rx8-zw83HVuzzkLDfdw==.jpg";

function msg(extra: Partial<MensagemDaCaixa>): MensagemDaCaixa {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    direcao: "entrada",
    tipo: "imagem",
    status: "recebida",
    texto: null,
    legenda: null,
    media_url: Z,
    storage_bucket: null,
    storage_path: null,
    erro: null,
    recebido_em: "2026-10-18T16:53:48Z",
    enviado_em: null,
    created_at: "2026-10-18T16:53:48Z",
    ...extra,
  };
}

let cliente: QueryClient;
beforeEach(() => {
  cliente = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
});

function desenhar(m: MensagemDaCaixa): string {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: cliente }, createElement(MidiaDaMensagem, { m })),
  );
}

describe("o que cada tipo de mídia é", () => {
  it("figurinha é imagem; localização e contato não têm arquivo para mostrar", () => {
    expect(categoriaDaMidia("imagem")).toBe("imagem");
    expect(categoriaDaMidia("sticker")).toBe("imagem");
    expect(categoriaDaMidia("video")).toBe("video");
    expect(categoriaDaMidia("audio")).toBe("audio");
    expect(categoriaDaMidia("documento")).toBe("documento");
    for (const t of ["texto", "localizacao", "contato", "sistema"]) expect(categoriaDaMidia(t), t).toBe("outra");
  });

  it("tem arquivo: a cópia nossa ou o link do Z-API", () => {
    expect(temArquivo(msg({}))).toBe(true);
    expect(temArquivo(msg({ media_url: null, storage_bucket: "whatsapp-midias", storage_path: "i/c/1-a.jpg" }))).toBe(true);
    expect(temArquivo(msg({ media_url: null }))).toBe(false);
    // Bucket sem caminho (ou o contrário) não é cópia.
    expect(temCopiaNossa(msg({ storage_bucket: "whatsapp-midias", storage_path: null }))).toBe(false);
  });
});

describe("copiar o que chegou só com o link (que vence em 30 dias)", () => {
  it("copia mensagem que CHEGOU só com o link; não mexe no que já tem cópia, na que saiu nem na que já falhou", () => {
    expect(precisaArquivar(msg({}))).toBe(true);
    expect(precisaArquivar(msg({ storage_path: "i/c/1-a.jpg" }))).toBe(false);
    expect(precisaArquivar(msg({ direcao: "saida" }))).toBe(false);
    expect(precisaArquivar(msg({ media_url: null }))).toBe(false);
    // Não insiste: a causa fica em `erro`, e o Monitor tem o "Reprocessar mídia".
    expect(precisaArquivar(msg({ erro: "cópia da mídia falhou: Z-API devolveu 403" }))).toBe(false);
  });
});

describe("o nome do arquivo que a pessoa baixa", () => {
  it("só o link: o tipo e a hora em que chegou, em Belém — nunca o código do Z-API", () => {
    // 16:53:48 UTC = 13:53 em Belém.
    expect(nomeParaBaixar(msg({}))).toBe("foto-2026-10-18-1353.jpg");
    expect(nomeParaBaixar(msg({ tipo: "video", media_url: "https://x.exemplo/a/b/c.mp4" }))).toBe("video-2026-10-18-1353.mp4");
    expect(nomeParaBaixar(msg({ tipo: "audio", media_url: "https://x.exemplo/a/ptt.ogg?x=1" }))).toBe("audio-2026-10-18-1353.ogg");
    expect(nomeParaBaixar(msg({ tipo: "sticker", media_url: "https://x.exemplo/s.webp" }))).toBe("figurinha-2026-10-18-1353.webp");
  });

  it("link sem extensão cai no padrão do tipo", () => {
    expect(nomeParaBaixar(msg({ tipo: "audio", media_url: "https://x.exemplo/abc" }))).toBe("audio-2026-10-18-1353.ogg");
    expect(nomeParaBaixar(msg({ tipo: "video", media_url: "https://x.exemplo/abc" }))).toBe("video-2026-10-18-1353.mp4");
  });

  it("cópia nossa: o nome original, sem o número de instante que o armazenamento põe na frente", () => {
    expect(
      nomeParaBaixar(msg({ tipo: "documento", media_url: null, storage_bucket: "whatsapp-midias", storage_path: "inst/conv/1760000000000-orcamento_final.pdf" })),
    ).toBe("orcamento_final.pdf");
    // O caso do dia (id da mensagem + extensão) também sai limpo.
    expect(
      nomeParaBaixar(msg({ media_url: null, storage_bucket: "whatsapp-midias", storage_path: "inst/conv/1760000000000-e2d0b0c1.jpg" })),
    ).toBe("e2d0b0c1.jpg");
  });

  it("a extensão vem do endereço, com ou sem parâmetros", () => {
    expect(extensaoDoLink(Z)).toBe("jpg");
    expect(extensaoDoLink("https://x.exemplo/a.PNG?token=1")).toBe("png");
    expect(extensaoDoLink("https://x.exemplo/sem-extensao")).toBeNull();
    expect(extensaoDoLink(null)).toBeNull();
  });
});

describe("a bolha mostra a mídia de verdade (e não só um link)", () => {
  it("foto: aparece na bolha, amplia ao clicar e tem Baixar", () => {
    const html = desenhar(msg({}));
    expect(html).toContain("<img");
    expect(html).toContain(`src="${Z}"`);
    expect(html).toContain('aria-label="Ampliar imagem"');
    expect(html).toContain("Baixar");
    expect(html).toContain('data-midia="imagem"');
  });

  it("vídeo: toca na bolha, com controles, e tem Baixar", () => {
    const html = desenhar(msg({ tipo: "video", media_url: "https://x.exemplo/v.mp4" }));
    expect(html).toMatch(/<video[^>]*controls/);
    expect(html).toContain('src="https://x.exemplo/v.mp4"');
    expect(html).toContain("Baixar");
  });

  it("áudio: toca na bolha, com controles, e tem Baixar", () => {
    const html = desenhar(msg({ tipo: "audio", media_url: "https://x.exemplo/a.ogg" }));
    expect(html).toMatch(/<audio[^>]*controls/);
    expect(html).toContain("Baixar");
  });

  it("figurinha: imagem pequena", () => {
    const html = desenhar(msg({ tipo: "sticker", media_url: "https://x.exemplo/s.webp" }));
    expect(html).toContain("max-h-32");
  });

  it("cópia nossa: usa o link assinado (não o do Z-API) quando ele chega", () => {
    cliente.setQueryData(["wa-midia-link", "whatsapp-midias", "inst/conv/1-a.jpg"], "https://assinado.exemplo/foto");
    const html = desenhar(msg({ media_url: Z, storage_bucket: "whatsapp-midias", storage_path: "inst/conv/1-a.jpg" }));
    expect(html).toContain('src="https://assinado.exemplo/foto"');
    expect(html).not.toContain("backblazeb2");
  });

  it("cópia nossa ainda sem link assinado: diz que está carregando, sem apontar para o Z-API", () => {
    const html = desenhar(msg({ media_url: null, storage_bucket: "whatsapp-midias", storage_path: "inst/conv/1-a.jpg" }));
    expect(html).toContain("Carregando imagem");
    expect(html).not.toContain("<img");
  });

  it("documento: o nome do arquivo, Abrir e Baixar", () => {
    cliente.setQueryData(["wa-midia-link", "whatsapp-midias", "inst/conv/1760000000000-planta.pdf"], "https://assinado.exemplo/pdf");
    const html = desenhar(
      msg({ tipo: "documento", media_url: null, storage_bucket: "whatsapp-midias", storage_path: "inst/conv/1760000000000-planta.pdf" }),
    );
    expect(html).toContain("planta.pdf");
    expect(html).toContain("Abrir");
    expect(html).toContain("Baixar");
  });

  it("sem arquivo, ou tipo sem arquivo (localização, contato), não desenha nada", () => {
    expect(desenhar(msg({ media_url: null }))).toBe("");
    expect(desenhar(msg({ tipo: "localizacao" }))).toBe("");
    expect(desenhar(msg({ tipo: "texto", media_url: null }))).toBe("");
  });
});

describe("as travas", () => {
  const FUNCOES = readFileSync("src/lib/api/whatsapp-midia.functions.ts", "utf8");
  const SERVIDOR = readFileSync("src/lib/api/whatsapp-webhook.server.ts", "utf8");
  const CONVERSA = readFileSync("src/components/whatsapp/conversa-aberta.tsx", "utf8");
  const COMPONENTE = readFileSync("src/components/whatsapp/midia-da-mensagem.tsx", "utf8");

  it("copiar a mídia é com quem lê a conversa, conferido no banco, e a chave de serviço fica no servidor", () => {
    const trecho = FUNCOES.slice(FUNCOES.indexOf("export const guardarMidiaDaMensagem"));
    expect(trecho).toContain('_permission: "whatsapp.read"');
    expect(trecho).toContain("requireSupabaseAuth");
    expect(trecho).toContain('await import("@/lib/api/whatsapp-webhook.server")');
    expect(trecho).toContain("/^[0-9a-f-]{36}$/i");
    // O servidor importado no topo levaria a chave de serviço para o navegador.
    expect(FUNCOES.split("export const guardarMidiaDaMensagem")[0]).not.toMatch(/^import .*webhook\.server/m);
  });

  it("não insiste em cópia que já falhou e deixa o rastro da falha", () => {
    const trecho = SERVIDOR.slice(SERVIDOR.indexOf("export async function arquivarMidiaDaMensagem"));
    expect(trecho).toContain("if (m.erro) return");
    expect(trecho).toContain('eventoId: ""');
    expect(trecho).toContain("registrarFalhaDeMidia(");
  });

  it("a conversa usa o componente — e não imprime mais o link do Z-API como texto", () => {
    expect(CONVERSA).toContain("<MidiaDaMensagem");
    expect(CONVERSA).not.toContain("link do Z-API, vale 30 dias");
    expect(CONVERSA).toContain("manterNoFim");
  });

  it("falha ao carregar a mídia aparece como falha, com Baixar ao lado — nunca some", () => {
    expect(COMPONENTE).toContain('role="alert"');
    expect(COMPONENTE).toContain("onError={() => setFalhou(true)}");
    expect(COMPONENTE).toContain("o link do WhatsApp pode ter vencido");
  });

  it("o download da cópia nossa sai com o nome certo (Content-Disposition), não depende do atributo download", () => {
    const tela = readFileSync("src/components/whatsapp/usar-caixa-de-entrada.ts", "utf8");
    expect(tela).toContain("{ download: baixarComo }");
    expect(COMPONENTE).toContain("linkDaMidia(m.storage_bucket as string, m.storage_path as string, 60, nome)");
  });
});
