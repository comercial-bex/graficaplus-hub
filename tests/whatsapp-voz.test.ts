import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MIME_DA_VOZ,
  VELOCIDADES,
  aparelhoNaoTocaOgg,
  aplicarVelocidade,
  criarRegistroDeAudio,
  formatarDuracao,
  fracaoDoClique,
  fracaoTocada,
  proximaVelocidade,
  rotuloDaVelocidade,
} from "../src/domain/whatsapp/voz";
import { TocadorDeVoz } from "../src/components/whatsapp/tocador-de-voz";
import { TooltipProvider } from "../src/components/ui/tooltip";

/** O tocador de voz próprio da bolha (onda 1, 12/11/2026). */

const CODIGO = readFileSync("src/components/whatsapp/tocador-de-voz.tsx", "utf8");

describe("a velocidade", () => {
  it("1x, 1,5x e 2x, em ciclo, e volta ao 1x", () => {
    expect(VELOCIDADES).toEqual([1, 1.5, 2]);
    expect(proximaVelocidade(1)).toBe(1.5);
    expect(proximaVelocidade(1.5)).toBe(2);
    expect(proximaVelocidade(2)).toBe(1);
    expect(proximaVelocidade(3)).toBe(1);
  });

  it("o rótulo usa vírgula decimal", () => {
    expect(VELOCIDADES.map(rotuloDaVelocidade)).toEqual(["1x", "1,5x", "2x"]);
  });

  it("muda a velocidade mantendo o tom (preservesPitch)", () => {
    const el = { playbackRate: 1, preservesPitch: false, webkitPreservesPitch: false, pause: vi.fn() };
    aplicarVelocidade(el, 1.5);
    expect(el.playbackRate).toBe(1.5);
    expect(el.preservesPitch).toBe(true);
    expect(el.webkitPreservesPitch).toBe(true);
  });
});

describe("a duração e a barra", () => {
  it("duração formatada em minutos e segundos", () => {
    expect(formatarDuracao(0)).toBe("0:00");
    expect(formatarDuracao(7.9)).toBe("0:07");
    expect(formatarDuracao(65)).toBe("1:05");
    expect(formatarDuracao(723)).toBe("12:03");
  });

  it("sem duração conhecida (infinita, não é número, negativa) mostra 0:00", () => {
    for (const v of [Infinity, NaN, -3]) expect(formatarDuracao(v)).toBe("0:00");
  });

  it("a fração tocada fica entre 0 e 1 e nunca divide por zero", () => {
    expect(fracaoTocada(5, 20)).toBe(0.25);
    expect(fracaoTocada(30, 20)).toBe(1);
    expect(fracaoTocada(5, 0)).toBe(0);
    expect(fracaoTocada(5, Infinity)).toBe(0);
  });

  it("o clique na barra vira posição: meio, começo, fim e fora da barra", () => {
    expect(fracaoDoClique(150, 100, 100)).toBe(0.5);
    expect(fracaoDoClique(100, 100, 100)).toBe(0);
    expect(fracaoDoClique(200, 100, 100)).toBe(1);
    expect(fracaoDoClique(50, 100, 100)).toBe(0);
    expect(fracaoDoClique(500, 100, 100)).toBe(1);
    expect(fracaoDoClique(150, 100, 0)).toBe(0);
  });
});

describe("um áudio por vez", () => {
  it("ao tocar um, o que tocava pausa", () => {
    const registro = criarRegistroDeAudio();
    const a = { playbackRate: 1, pause: vi.fn() };
    const b = { playbackRate: 1, pause: vi.fn() };
    registro.tocar(a);
    registro.tocar(b);
    expect(a.pause).toHaveBeenCalledTimes(1);
    expect(b.pause).not.toHaveBeenCalled();
    expect(registro.tocando).toBe(b);
  });

  it("tocar o mesmo de novo não o pausa; soltar o que não é o atual não muda nada", () => {
    const registro = criarRegistroDeAudio();
    const a = { playbackRate: 1, pause: vi.fn() };
    const b = { playbackRate: 1, pause: vi.fn() };
    registro.tocar(a);
    registro.tocar(a);
    registro.soltar(b);
    expect(a.pause).not.toHaveBeenCalled();
    expect(registro.tocando).toBe(a);
    registro.soltar(a);
    expect(registro.tocando).toBeNull();
  });

  it("o tocador usa o registro único da tela", () => {
    expect(CODIGO).toContain("registroDeAudio.tocar(el)");
    expect(CODIGO).toContain("registroDeAudio.soltar(");
  });
});

describe("o aparelho que não toca Ogg Opus", () => {
  it("avisa quando o formato é Ogg e canPlayType devolve vazio", () => {
    expect(aparelhoNaoTocaOgg("audio-2026-10-18-1353.ogg", () => "")).toBe(true);
    expect(aparelhoNaoTocaOgg("voz.opus", () => "")).toBe(true);
  });

  it("não avisa quando toca, nem quando o formato não é Ogg", () => {
    expect(aparelhoNaoTocaOgg("a.ogg", () => "maybe")).toBe(false);
    expect(aparelhoNaoTocaOgg("a.ogg", () => "probably")).toBe(false);
    expect(aparelhoNaoTocaOgg("a.mp3", () => "")).toBe(false);
  });

  it("pergunta pelo formato certo", () => {
    const pergunta = vi.fn(() => "maybe");
    aparelhoNaoTocaOgg("a.ogg", pergunta);
    expect(pergunta).toHaveBeenCalledWith(MIME_DA_VOZ);
    expect(MIME_DA_VOZ).toContain("opus");
  });

  it("o aviso com Baixar mora na mídia da bolha", () => {
    const midia = readFileSync("src/components/whatsapp/midia-da-mensagem.tsx", "utf8");
    expect(midia).toContain("Ogg Opus");
    expect(midia).toContain("Toque em Baixar");
  });
});

describe("o tocador desenhado", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(TocadorDeVoz, { origem: "https://x.exemplo/a.ogg", nome: "audio.ogg", segundos: 23, aoFalhar: () => {} }),
    ),
  );

  it("botão de tocar de 44 px, barra clicável com área de 44 px, velocidade de 44 px", () => {
    expect(html).toContain('aria-label="Tocar a mensagem de voz"');
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-label="Posição da mensagem de voz"');
    expect((html.match(/size-11/g) ?? []).length).toBe(2);
    expect(html).toContain("h-11");
    expect(html).toContain('aria-label="Velocidade 1x. Toque para mudar."');
  });

  it("mostra a duração que o Z-API informou antes de o arquivo carregar", () => {
    expect(html).toContain("0:23");
  });

  it("não usa os controles do navegador, que mudam de cara em cada aparelho", () => {
    expect(html).not.toMatch(/<audio[^>]*controls/);
  });

  it("nenhum title, travessão nem seta, e nenhuma letra abaixo de 12 px", () => {
    expect(CODIGO).not.toMatch(/\btitle=/);
    expect(CODIGO).not.toMatch(/[—–→←⇒]/);
    expect(CODIGO).not.toMatch(/text-\[(\d|1[01])px\]/);
  });
});
