import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { entradaDoHtml, entradaRodando, haVersaoNova } from "../src/lib/versao-publicada";

/**
 * Aba aberta numa versão velha (21/10/2026). A faixa "Nova versão disponível"
 * dependia do service worker mudar, e o sw.js é o mesmo em toda publicação:
 * quem deixava o WhatsApp aberto seguia no código da manhã. Agora a aba compara
 * o script de entrada dela com o do HTML publicado.
 */

// O trecho real do /login publicado em 21/10 (deploy b7faa9d6).
const HTML_PUBLICADO =
  '<link rel="modulepreload" href="/assets/index-9tSbyMUF.js"/><link rel="modulepreload" href="/assets/login-xutfhFNM.js"/>' +
  '<script defer src="/~flock.js" data-proxy-url="/~api/analytics"></script>' +
  '<script type="module" async="" src="/assets/index-9tSbyMUF.js"></script>';

const documentoCom = (src: string | null) =>
  ({
    querySelector: (sel: string) =>
      src && sel.includes("/assets/index-") ? { getAttribute: (a: string) => (a === "src" ? src : null) } : null,
  }) as unknown as Document;

describe("qual versão", () => {
  it("lê o script de entrada do HTML publicado (não o modulepreload de outras telas)", () => {
    expect(entradaDoHtml(HTML_PUBLICADO)).toBe("/assets/index-9tSbyMUF.js");
    expect(entradaDoHtml('<script type="module" src="/assets/login-xutfhFNM.js"></script>')).toBeNull();
    expect(entradaDoHtml("")).toBeNull();
  });

  it("lê o script que a aba carregou; no desenvolvimento não há", () => {
    expect(entradaRodando(documentoCom("/assets/index-9tSbyMUF.js"))).toBe("/assets/index-9tSbyMUF.js");
    expect(entradaRodando(documentoCom(null))).toBeNull();
  });
});

describe("há versão nova?", () => {
  afterEach(() => vi.unstubAllGlobals());
  const publicado = (html: string, ok = true) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok, text: async () => html })));

  it("mesma entrada: não", async () => {
    publicado(HTML_PUBLICADO);
    expect(await haVersaoNova(documentoCom("/assets/index-9tSbyMUF.js"))).toBe(false);
  });

  it("entrada diferente: sim", async () => {
    publicado(HTML_PUBLICADO);
    expect(await haVersaoNova(documentoCom("/assets/index-ANTIGO12.js"))).toBe(true);
  });

  it("na dúvida, não: rede fora, resposta de erro, HTML sem o script, desenvolvimento", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await haVersaoNova(documentoCom("/assets/index-ANTIGO12.js"))).toBe(false);
    publicado(HTML_PUBLICADO, false);
    expect(await haVersaoNova(documentoCom("/assets/index-ANTIGO12.js"))).toBe(false);
    publicado("<html></html>");
    expect(await haVersaoNova(documentoCom("/assets/index-ANTIGO12.js"))).toBe(false);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await haVersaoNova(documentoCom(null))).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("pede o HTML sem cache e sem sessão", async () => {
    const f = vi.fn(async () => ({ ok: true, text: async () => HTML_PUBLICADO }));
    vi.stubGlobal("fetch", f);
    await haVersaoNova(documentoCom("/assets/index-9tSbyMUF.js"));
    expect(f).toHaveBeenCalledWith("/login", { cache: "no-store", credentials: "omit" });
  });
});

describe("a faixa usa a conferência", () => {
  const PWA = readFileSync("src/components/pwa/instalar-app.tsx", "utf8");

  it("a cada 5 minutos e ao voltar para a aba, no máximo uma vez por minuto, só com a aba à vista", () => {
    expect(PWA).toContain("setInterval(conferirPublicacao, 5 * 60_000)");
    expect(PWA).toContain('document.addEventListener("visibilitychange", conferirPublicacao);');
    expect(PWA).toContain("if (Date.now() - ultimaConferencia < 60_000) return;");
    expect(PWA).toContain('if (document.visibilityState !== "visible") return;');
    expect(PWA).toContain("if (nova) setNovaVersao(true);");
  });

  it("limpa o relógio e o ouvinte ao sair", () => {
    expect(PWA).toContain("clearInterval(intervaloDaConferencia);");
    expect(PWA).toContain('document.removeEventListener("visibilitychange", conferirPublicacao);');
  });

  it("recarregar continua sendo decisão da pessoa (pode estar no meio de um texto)", () => {
    expect(PWA).toContain("onClick={() => window.location.reload()}");
    const conferencia = PWA.slice(PWA.indexOf("const conferirPublicacao"), PWA.indexOf("const intervaloDaConferencia"));
    expect(conferencia).not.toContain("reload");
  });
});
