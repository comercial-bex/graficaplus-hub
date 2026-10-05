import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * O CUSTO DO MATERIAL SÓ SE LÊ PELA VIEW FINANCEIRA.
 *
 * A tabela `materiais` libera por coluna só o que não é dinheiro (nome,
 * unidade, estoque…). Pedir `custo_medio` ou `custo_unitario` nela derruba a
 * consulta INTEIRA com "permission denied for table materiais" — inclusive
 * para o admin. Foi assim que a calculadora de custo do orçamento ficou com a
 * lista de materiais sempre vazia (a consulta caía e o erro era jogado fora):
 * não dava para escolher acrílico nem lona, e a ficha técnica do produto nunca
 * carregava. Medido em 05/10/2026 para admin, gestor e financeiro; a view
 * `materiais_financeiro` devolvia os 18 materiais para os três.
 */

function arquivosFonte(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosFonte(caminho, acc);
    else if (/\.(ts|tsx)$/.test(nome) && !caminho.includes("integrations/supabase/types.ts")) acc.push(caminho);
  }
  return acc;
}

describe("custo de material", () => {
  it("nenhuma tela pede custo direto da tabela materiais", () => {
    const culpados: string[] = [];
    for (const arquivo of arquivosFonte("src")) {
      const texto = readFileSync(arquivo, "utf8");
      // .from("materiais") seguido, na mesma cadeia, de um select com custo.
      const re = /\.from\(\s*["']materiais["']\s*\)([\s\S]{0,200}?)\.select\(\s*["'`]([^"'`]*)["'`]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(texto))) {
        // Para no primeiro ponto e vírgula: outra instrução não é a mesma cadeia.
        if (m[1].includes(";")) continue;
        if (/\bcusto_(medio|unitario)\b/.test(m[2])) culpados.push(`${arquivo}: select("${m[2]}")`);
      }
    }
    expect(
      culpados,
      `Leia o custo pela view financeira (fromFinancialView("materiais", ...)). A tabela crua recusa a consulta inteira:\n  ${culpados.join("\n  ")}`,
    ).toEqual([]);
  });

  it("a calculadora do orçamento lê pela view financeira e não joga erro fora", () => {
    const fonte = readFileSync("src/components/orcamento/calculadora-custo.tsx", "utf8");
    expect(fonte).toContain('fromFinancialView("materiais"');
    // Toda consulta da calculadora lê o erro: `const { data } = await` sem
    // `error` é a lista vazia que mente.
    expect(fonte).not.toMatch(/const\s*\{\s*data\s*\}\s*=\s*await/);
    expect(fonte).toContain("falhasDeCarga");
  });
});
