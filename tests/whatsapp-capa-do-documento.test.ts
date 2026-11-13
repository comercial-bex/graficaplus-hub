import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArquivoGrandeDemais,
  LIMITE_DA_CAPA_BYTES,
  criarFilaDeUm,
  criarGuardaDeCapas,
  descricaoDoDocumento,
  extensaoDoNome,
  lerComLimite,
  modoDaCapa,
  tamanhoLegivel,
  tipoDoArquivo,
} from "../src/domain/whatsapp/documento";

/**
 * O cartão do documento na bolha (onda 1, 12/11/2026): a capa da 1ª página
 * pelo pdf.js, só quando o cartão aparece, uma por vez, com limite de 15 MB
 * medido antes, espaço reservado e "Sem prévia" na falha.
 */

vi.mock("../src/lib/pdf/imagens", () => ({
  capaDoPdf: vi.fn(async () => ({ src: "data:image/png;base64,AAAA", paginas: 18 })),
}));
import { CapaDoDocumento } from "../src/components/whatsapp/capa-do-documento";
import { TooltipProvider } from "../src/components/ui/tooltip";

const CODIGO = readFileSync("src/components/whatsapp/capa-do-documento.tsx", "utf8");

describe("o limite de 15 MB, medido antes de baixar", () => {
  it("o limite é 15 MB", () => {
    expect(LIMITE_DA_CAPA_BYTES).toBe(15 * 1024 * 1024);
  });

  it("PDF conhecido acima do limite não desenha; no limite ou sem tamanho conhecido, sim", () => {
    expect(modoDaCapa("pdf", LIMITE_DA_CAPA_BYTES)).toBe("pdf");
    expect(modoDaCapa("pdf", LIMITE_DA_CAPA_BYTES + 1)).toBe("sem_previa");
    expect(modoDaCapa("pdf", null)).toBe("pdf");
  });

  it("arte PNG ou JPG mostra a própria imagem; Word, ZIP e projeto não têm capa", () => {
    expect(modoDaCapa("imagem", null)).toBe("imagem");
    for (const t of ["word", "planilha", "apresentacao", "compactado", "projeto", "outro"] as const) {
      expect(modoDaCapa(t, 1000), t).toBe("sem_previa");
    }
  });

  it("a leitura desiste pelo content-length, sem ler o corpo", async () => {
    const r = new Response("x".repeat(10), { headers: { "content-length": String(LIMITE_DA_CAPA_BYTES + 1) } });
    await expect(lerComLimite(r)).rejects.toBeInstanceOf(ArquivoGrandeDemais);
  });

  it("sem content-length, desiste ao passar do limite enquanto os bytes chegam", async () => {
    let enviados = 0;
    const corpo = new ReadableStream<Uint8Array>({
      pull(c) {
        enviados += 400;
        c.enqueue(new Uint8Array(400));
      },
    });
    await expect(lerComLimite(new Response(corpo), 1000)).rejects.toBeInstanceOf(ArquivoGrandeDemais);
    // Parou perto do limite: não leu o arquivo inteiro (que nunca acaba).
    expect(enviados).toBeLessThan(5000);
  });

  it("dentro do limite devolve os bytes inteiros", async () => {
    const bytes = await lerComLimite(new Response(new Uint8Array([1, 2, 3, 4, 5])), 100);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("uma capa por vez", () => {
  it("a segunda só começa quando a primeira termina", async () => {
    const emFila = criarFilaDeUm();
    const ordem: string[] = [];
    let soltar!: () => void;
    const primeira = emFila(
      () =>
        new Promise<void>((ok) => {
          ordem.push("a começou");
          soltar = () => {
            ordem.push("a terminou");
            ok();
          };
        }),
    );
    const segunda = emFila(async () => {
      ordem.push("b começou");
    });
    await Promise.resolve();
    expect(ordem).toEqual(["a começou"]);
    soltar();
    await Promise.all([primeira, segunda]);
    expect(ordem).toEqual(["a começou", "a terminou", "b começou"]);
  });

  it("quem saiu da tela esperando na fila nem começa, e a fila segue", async () => {
    const emFila = criarFilaDeUm();
    const fez = vi.fn();
    let sair = false;
    const a = emFila(async () => {
      sair = true;
    });
    const b = emFila(
      async () => fez("b"),
      () => sair,
    );
    const c = emFila(async () => fez("c"));
    await a;
    await expect(b).rejects.toThrow("cancelado");
    await c;
    expect(fez).toHaveBeenCalledTimes(1);
    expect(fez).toHaveBeenCalledWith("c");
  });

  it("uma capa que falha não trava as seguintes", async () => {
    const emFila = criarFilaDeUm();
    await expect(emFila(async () => Promise.reject(new Error("pdf quebrado")))).rejects.toThrow("pdf quebrado");
    await expect(emFila(async () => "ok")).resolves.toBe("ok");
  });

  it("o guarda de capas esquece a mais antiga ao passar do máximo", () => {
    const g = criarGuardaDeCapas<number>(2);
    g.gravar("a", 1);
    g.gravar("b", 2);
    g.ler("a");
    g.gravar("c", 3);
    expect(g.ler("b")).toBeUndefined();
    expect(g.ler("a")).toBe(1);
    expect(g.tamanho).toBe(2);
  });
});

describe("o que o cartão diz do arquivo", () => {
  it("o tipo pelo nome; sem extensão conhecida, pelo mimeType", () => {
    expect(tipoDoArquivo("Planta Final.PDF")).toBe("pdf");
    expect(tipoDoArquivo("arte.png")).toBe("imagem");
    expect(tipoDoArquivo("proposta.docx")).toBe("word");
    expect(tipoDoArquivo("custos.xlsx")).toBe("planilha");
    expect(tipoDoArquivo("apresentacao.pptx")).toBe("apresentacao");
    expect(tipoDoArquivo("arquivos.zip")).toBe("compactado");
    expect(tipoDoArquivo("logo.cdr")).toBe("projeto");
    expect(tipoDoArquivo("peca.stl")).toBe("projeto");
    expect(tipoDoArquivo("sem-extensao")).toBe("outro");
    expect(tipoDoArquivo("sem-extensao", "application/pdf")).toBe("pdf");
    expect(extensaoDoNome("a.b.JPG?x=1")).toBe("jpg");
  });

  it('"PDF · 18 páginas" só com o que se sabe: nunca inventa número', () => {
    expect(descricaoDoDocumento({ tipo: "pdf", paginas: 18 })).toBe("PDF · 18 páginas");
    expect(descricaoDoDocumento({ tipo: "pdf", paginas: 1 })).toBe("PDF · 1 página");
    expect(descricaoDoDocumento({ tipo: "pdf" })).toBe("PDF");
    expect(descricaoDoDocumento({ tipo: "pdf", paginas: null, bytes: null })).toBe("PDF");
    expect(descricaoDoDocumento({ tipo: "pdf", paginas: 18, bytes: 2.34 * 1024 * 1024 })).toBe("PDF · 18 páginas · 2,3 MB");
    expect(descricaoDoDocumento({ tipo: "word" })).toBe("Word");
    expect(descricaoDoDocumento({ tipo: "outro" })).toBe("Arquivo");
  });

  it("tamanho com vírgula decimal", () => {
    expect(tamanhoLegivel(512)).toBe("512 B");
    expect(tamanhoLegivel(340 * 1024)).toBe("340 KB");
    expect(tamanhoLegivel(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });
});

describe("o cartão desenhado", () => {
  const props = {
    mensagemId: "m-capa-1",
    origem: "https://assinado.exemplo/planta.pdf",
    baixando: false,
    aoBaixar: () => {},
    aoAbrir: () => {},
  };

  it("PDF antes de aparecer: espaço reservado, nome com 16 px, Abrir e Baixar de 44 px, sem desenhar nada", () => {
    const html = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(CapaDoDocumento, { ...props, nome: "planta.pdf" })));
    expect(html).toContain('data-documento="pdf"');
    expect(html).toContain("h-44");
    expect(html).toContain("planta.pdf");
    expect(html).toMatch(/text-base[^"]*">planta\.pdf/);
    expect(html).toContain('aria-label="Abrir planta.pdf em outra aba"');
    expect(html).toContain('aria-label="Baixar planta.pdf"');
    expect((html.match(/h-11/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("data:image");
  });

  it("Word: cartão sem capa nem 'Sem prévia' (não tem o que desenhar)", () => {
    const html = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(CapaDoDocumento, { ...props, nome: "proposta.docx" })));
    expect(html).toContain('data-documento="word"');
    expect(html).not.toContain("h-44");
    expect(html).not.toContain("Sem prévia");
    expect(html).toContain("Word");
  });

  it("arte PNG mandada como documento mostra a própria imagem, reduzida", () => {
    const html = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(CapaDoDocumento, { ...props, nome: "banner.png", origem: "https://x.exemplo/banner.png" })));
    expect(html).toContain('src="https://x.exemplo/banner.png"');
    expect(html).toContain("max-h-full max-w-full object-contain");
  });

  it("pelo código: só desenha ao aparecer, uma por vez, com limite, e falhou vira Sem prévia", () => {
    expect(CODIGO).toContain("IntersectionObserver");
    expect(CODIGO).toContain("criarFilaDeUm()");
    expect(CODIGO).toContain("lerComLimite(r, LIMITE_DA_CAPA_BYTES)");
    expect(CODIGO).toContain("Sem prévia");
    expect(CODIGO).toContain("ArquivoGrandeDemais");
    // A capa vem do pdf.js já existente, não de uma biblioteca nova.
    expect(CODIGO).toContain('from "@/lib/pdf/imagens"');
    // O pdf.js nunca é importado direto na tela: o carregamento sob demanda é de src/lib/pdf/pdfjs.ts.
    expect(CODIGO).not.toMatch(/from "pdfjs-dist/);
  });

  it("gif e segundos já são props opcionais, para a onda seguinte", () => {
    expect(CODIGO).toMatch(/gif\?: boolean/);
    expect(CODIGO).toMatch(/segundos\?: number/);
  });

  it("nenhum title, nenhum travessão nem seta, nenhuma letra abaixo de 12 px", () => {
    expect(CODIGO).not.toMatch(/\btitle=/);
    expect(CODIGO).not.toMatch(/[—–→←⇒]/);
    expect(CODIGO).not.toMatch(/text-\[(\d|1[01])px\]/);
  });
});
