import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MensagemDaCaixa } from "../src/domain/whatsapp/caixa-de-entrada";
import {
  categoriaDaMidia,
  extensaoDoLink,
  fotosDaConversa,
  bolhaSemFundo,
  legendaDaBolha,
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
import { TooltipProvider } from "../src/components/ui/tooltip";

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
    createElement(
      QueryClientProvider,
      { client: cliente },
      createElement(TooltipProvider, null, createElement(MidiaDaMensagem, { m })),
    ),
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
  // Onda 1 (12/11/2026): a foto não leva botão solto embaixo (bolha limpa); o
  // Baixar mora no visor, que abre ao tocar na foto (tests/whatsapp-visor-de-fotos).
  it("foto: aparece na bolha e abre no visor ao tocar (o Baixar mora no visor)", () => {
    const html = desenhar(msg({}));
    expect(html).toContain("<img");
    expect(html).toContain(`src="${Z}"`);
    expect(html).toContain('aria-label="Ampliar imagem"');
    expect(html).toContain('data-midia="imagem"');
    expect(html).not.toContain("Baixar");
    expect(readFileSync("src/components/whatsapp/visor-de-fotos.tsx", "utf8")).toContain("Baixar");
  });

  it("vídeo: toca na bolha, com controles, e tem Baixar", () => {
    const html = desenhar(msg({ tipo: "video", media_url: "https://x.exemplo/v.mp4" }));
    expect(html).toMatch(/<video[^>]*controls/);
    expect(html).toContain('src="https://x.exemplo/v.mp4"');
    expect(html).toContain("Baixar");
  });

  it("áudio: tocador próprio (botão de tocar, barra, velocidade) e Baixar, sem os controles do navegador", () => {
    const html = desenhar(msg({ tipo: "audio", media_url: "https://x.exemplo/a.ogg" }));
    expect(html).toContain("data-voz");
    expect(html).toContain('aria-label="Tocar a mensagem de voz"');
    expect(html).toContain('role="slider"');
    expect(html).toContain("1x");
    expect(html).not.toMatch(/<audio[^>]*controls/);
    expect(html).toContain("Baixar");
  });

  it("figurinha: imagem de uns 160 px, sem moldura", () => {
    const html = desenhar(msg({ tipo: "sticker", media_url: "https://x.exemplo/s.webp" }));
    expect(html).toContain("size-40");
    expect(html).toMatch(/<img[^>]*class="size-40 object-contain"/);
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
    expect(html).toContain('data-documento="pdf"');
    // Nunca o "[Documento]" de antes: o tipo vai no aria-label da mídia.
    expect(html).not.toContain("[Documento]");
    expect(html).toContain('aria-label="Documento: planta.pdf"');
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
  const BOLHA = readFileSync("src/components/whatsapp/conteudo-da-bolha.tsx", "utf8");
  const COMPONENTE = readFileSync("src/components/whatsapp/midia-da-mensagem.tsx", "utf8");
  // Onda 1: baixar e abrir moram num lugar só, porque o cartão do documento, a
  // mídia da bolha e o visor de fotos usam os mesmos.
  const ARQUIVO = readFileSync("src/components/whatsapp/usar-arquivo-da-midia.ts", "utf8");

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

  // Onda 1 (12/11/2026): o miolo da bolha virou ConteudoDaBolha (da MIDIA), e a
  // conversa só o desenha. A metade "a conversa usa o miolo e mantém o fim à
  // vista" foi para tests/whatsapp-conversa-travas.test.ts (da CONVERSA).
  it("o miolo da bolha usa o componente — e não imprime mais o link do Z-API como texto", () => {
    expect(BOLHA).toContain("<MidiaDaMensagem");
    expect(BOLHA).toContain("aoMudarAltura");
    expect(BOLHA).not.toContain("link do Z-API, vale 30 dias");
  });

  it("falha ao carregar a mídia aparece como falha, com Baixar ao lado — nunca some", () => {
    expect(COMPONENTE).toContain('role="alert"');
    expect(COMPONENTE).toContain("onError={() => setFalhou(true)}");
    expect(COMPONENTE).toContain("o link do WhatsApp pode ter vencido");
  });

  it("o download da cópia nossa sai com o nome certo (Content-Disposition), não depende do atributo download", () => {
    const tela = readFileSync("src/components/whatsapp/usar-caixa-de-entrada.ts", "utf8");
    expect(tela).toContain("{ download: baixarComo }");
    expect(ARQUIVO).toContain("linkDaMidia(m.storage_bucket as string, m.storage_path as string, 60, nome)");
    expect(COMPONENTE).toContain("baixarMidia(m, nome)");
  });
});

/**
 * Onda 1 (12/11/2026): mídia em cima e legenda embaixo. O "[Documento]",
 * "[Imagem]" e "[Áudio]" não aparecem quando a mídia aparece; a legenda igual
 * ao nome do arquivo não se repete; mídia sem arquivo diz uma frase clara.
 */
describe("a legenda embaixo da mídia", () => {
  const COPIA = { media_url: null, storage_bucket: "whatsapp-midias", storage_path: "i/c/1760000000000-planta.pdf" };

  it("mídia que aparece e não tem texto: nenhuma frase (sem [Documento], [Imagem], [Áudio])", () => {
    for (const tipo of ["imagem", "documento", "audio", "video", "sticker"]) {
      expect(legendaDaBolha(msg({ tipo })), tipo).toBe("");
    }
  });

  it("a legenda de verdade aparece; a igual ao nome do arquivo não se repete", () => {
    expect(legendaDaBolha(msg({ legenda: "a arte do banner" }))).toBe("a arte do banner");
    expect(legendaDaBolha(msg({ tipo: "documento", ...COPIA, legenda: "planta.pdf" }))).toBe("");
    expect(legendaDaBolha(msg({ tipo: "documento", ...COPIA, legenda: "Planta" }))).toBe("");
    expect(legendaDaBolha(msg({ tipo: "documento", ...COPIA, texto: "planta.pdf" }))).toBe("");
    expect(legendaDaBolha(msg({ tipo: "documento", ...COPIA, legenda: "planta nova, versão 2" }))).toBe("planta nova, versão 2");
  });

  it("mídia sem arquivo diz uma frase clara, sem colchete e sem travessão", () => {
    for (const tipo of ["imagem", "documento", "audio", "video", "sticker"]) {
      const f = legendaDaBolha(msg({ tipo, media_url: null }));
      expect(f, tipo).not.toBe("");
      expect(f, tipo).not.toMatch(/[\[\]\u2014\u2013\u2192]/);
    }
    expect(legendaDaBolha(msg({ tipo: "imagem", media_url: null }))).toContain("não chegou");
    expect(legendaDaBolha(msg({ tipo: "imagem", media_url: null, direcao: "saida" }))).toContain("não foi guardado");
  });

  it("texto comum, localização, contato e aviso do sistema seguem como antes, sem colchete", () => {
    expect(legendaDaBolha(msg({ tipo: "texto", media_url: null, texto: "bom dia" }))).toBe("bom dia");
    expect(legendaDaBolha(msg({ tipo: "localizacao", media_url: null }))).toBe("Localização enviada.");
    expect(legendaDaBolha(msg({ tipo: "contato", media_url: null }))).toBe("Contato enviado.");
    expect(legendaDaBolha(msg({ tipo: "sistema", media_url: null }))).toContain("não suportada");
  });

  it("figurinha não tem fundo de bolha; foto tem", () => {
    expect(bolhaSemFundo({ tipo: "sticker" })).toBe(true);
    expect(bolhaSemFundo({ tipo: "imagem" })).toBe(false);
  });

  it("o visor anda só nas fotos que têm arquivo, da mais antiga para a mais nova", () => {
    const a = msg({ id: "a", recebido_em: "2026-10-18T10:00:00Z" });
    const b = msg({ id: "b", recebido_em: "2026-10-18T09:00:00Z" });
    const semArquivo = msg({ id: "c", media_url: null });
    const doc = msg({ id: "d", tipo: "documento" });
    expect(fotosDaConversa([a, semArquivo, doc, b]).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("a bolha de mídia, pelo código", () => {
  const MIDIA = readFileSync("src/components/whatsapp/midia-da-mensagem.tsx", "utf8");
  const BOLHA = readFileSync("src/components/whatsapp/conteudo-da-bolha.tsx", "utf8");

  it("a mídia vem antes da legenda, e o texto da bolha tem 16 px", () => {
    expect(BOLHA.indexOf("<MidiaDaMensagem")).toBeGreaterThan(-1);
    expect(BOLHA.indexOf("<MidiaDaMensagem")).toBeLessThan(BOLHA.indexOf("partesComRealce(texto"));
    expect(BOLHA).toContain("text-base");
    expect(BOLHA).toContain("legendaDaBolha");
    expect(BOLHA).not.toContain("conteudoDaMensagem(");
  });

  it("todo botão de mídia tem 44 px, nenhum title, nenhum travessão nem seta nas frases", () => {
    expect(MIDIA).toContain("h-11");
    for (const arq of ["midia-da-mensagem", "capa-do-documento", "tocador-de-voz", "visor-de-fotos"]) {
      const t = readFileSync(`src/components/whatsapp/${arq}.tsx`, "utf8");
      expect(t, arq).not.toMatch(/\btitle=/);
      expect(t, arq).not.toContain("<title");
      // Comentário de código pode; frase em aspas ou crase não.
      const frases = t
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      expect(frases, arq).not.toMatch(/[\u2014\u2013\u2192\u2190\u21d2]/);
    }
  });
});
