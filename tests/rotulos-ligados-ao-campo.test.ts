import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Rótulo ligado ao campo (02/11/2026).
 *
 * `<Label>` sem `htmlFor` não dá nome ao campo para o leitor de tela e clicar
 * no texto não leva o cursor ao campo. A auditoria achou 289 de 572 assim; as
 * telas corrigidas (compromissos, cliente, produtos, materiais…) saíram da
 * lista. Este teste é uma catraca: o número por arquivo pode CAIR, nunca subir,
 * e arquivo novo não entra com rótulo solto. Ao ligar rótulos, baixe o número
 * em `tests/rotulos-sem-ligacao.baseline.json` (ou apague a linha).
 *
 * Alguns `<Label>` da lista rotulam texto de leitura, não campo: esses podem
 * ficar na linha-base.
 */
const RAIZ = join(__dirname, "..", "src");
const BASE: Record<string, number> = JSON.parse(
  readFileSync(join(__dirname, "rotulos-sem-ligacao.baseline.json"), "utf8"),
);

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return caminho.endsWith(".tsx") ? [caminho] : [];
  });
}

function soltos(texto: string): number {
  let n = 0;
  for (const m of texto.matchAll(/<Label\b([^>]*)>/g)) if (!m[1].includes("htmlFor")) n++;
  return n;
}

describe("rótulo ligado ao campo", () => {
  it("nenhum arquivo ganha <Label> sem htmlFor além da linha-base", () => {
    const acima: string[] = [];
    for (const f of arquivos(RAIZ)) {
      const rel = "src/" + f.slice(RAIZ.length + 1).replaceAll("\\", "/");
      const n = soltos(readFileSync(f, "utf8"));
      const permitido = BASE[rel] ?? 0;
      if (n > permitido) acima.push(`${rel}: ${n} (linha-base ${permitido})`);
    }
    expect(acima, "ligue o rótulo ao campo com htmlFor + id").toEqual([]);
  });

  it("a linha-base não lista arquivo que sumiu", () => {
    const existentes = new Set(
      arquivos(RAIZ).map((f) => "src/" + f.slice(RAIZ.length + 1).replaceAll("\\", "/")),
    );
    expect(Object.keys(BASE).filter((f) => !existentes.has(f))).toEqual([]);
  });
});
