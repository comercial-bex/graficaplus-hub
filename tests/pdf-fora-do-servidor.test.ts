import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * O motor do PDF não pode entrar no pacote do servidor.
 *
 * O @react-pdf (pdfkit, fontkit, brotli, reconciler, yoga) e o pdf.js só rodam
 * no navegador, mas qualquer import ESTÁTICO deles num módulo que uma rota
 * alcança os leva para o build do servidor — que já estava no limite de
 * memória (3ª fase, nitro). Medido em 06/10/2026: com o DocumentoPDF importado
 * direto por generate.ts, .output/server tinha 11 MB e 15 bibliotecas de PDF;
 * sem, 7,7 MB e nenhuma.
 *
 * A regra que esta trava confere:
 *   - @react-pdf/renderer só é importado (como valor) pelo próprio DocumentoPDF;
 *   - pdfjs-dist nunca é importado como valor de forma estática;
 *   - o DocumentoPDF só é importado com `import type`;
 *   - todo `import()` dessas três coisas mora num arquivo que o esconde atrás
 *     de `import.meta.env.SSR` (o build do servidor troca o ramo por null).
 */

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) && !nome.endsWith(".d.ts") ? [caminho] : [];
  });
}

const FONTES = arquivos("src").map((caminho) => ({
  caminho,
  texto: readFileSync(caminho, "utf8"),
}));

/** `import X from "alvo"` e `import { X } from "alvo"`, mas não `import type`. */
function importaValorDe(texto: string, alvo: RegExp): boolean {
  return [...texto.matchAll(/^import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm)].some((m) =>
    alvo.test(m[1]),
  );
}

describe("o motor do PDF fica fora do servidor", () => {
  it("só o DocumentoPDF importa o @react-pdf como valor", () => {
    const culpados = FONTES.filter((f) => importaValorDe(f.texto, /^@react-pdf\//)).map(
      (f) => f.caminho,
    );
    expect(culpados).toEqual(["src/lib/pdf/DocumentoPDF.tsx"]);
  });

  it("ninguém importa o pdf.js de forma estática", () => {
    const culpados = FONTES.filter((f) => importaValorDe(f.texto, /^pdfjs-dist/)).map(
      (f) => f.caminho,
    );
    expect(culpados).toEqual([]);
  });

  it("o DocumentoPDF só entra como tipo", () => {
    const culpados = FONTES.filter((f) => importaValorDe(f.texto, /(^|\/)DocumentoPDF$/)).map(
      (f) => f.caminho,
    );
    expect(culpados).toEqual([]);
  });

  it("todo import() do motor está atrás de import.meta.env.SSR", () => {
    const dinamicos = FONTES.filter((f) =>
      /import\(\s*["'](@react-pdf\/renderer|pdfjs-dist[^"']*|\.\/DocumentoPDF)["']\s*\)/.test(
        f.texto,
      ),
    );
    expect(dinamicos.map((f) => f.caminho).sort()).toEqual([
      "src/lib/pdf/generate.ts",
      "src/lib/pdf/pdfjs.ts",
    ]);
    for (const f of dinamicos) {
      expect(f.texto, `${f.caminho} precisa do ramo import.meta.env.SSR`).toMatch(
        /=\s*import\.meta\.env\.SSR\s*\?\s*null\s*:/,
      );
    }
  });
});
