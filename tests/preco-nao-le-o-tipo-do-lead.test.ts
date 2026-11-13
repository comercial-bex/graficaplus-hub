import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regra do dono: o tipo do lead (cliente final ou parceiro) é uma ETIQUETA
 * INTERNA. Quem tem tabela de parceiro é quem está CADASTRADO como parceiro
 * (tabela parceiros). Nenhum caminho de preço pode ler o tipo do lead.
 */
function arquivos(dir: string): string[] {
  let itens: string[];
  try {
    itens = readdirSync(dir);
  } catch {
    return [];
  }
  return itens.flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) ? [caminho] : [];
  });
}

const PASTAS_DE_PRECO = [
  "src/domain/parceiros",
  "src/domain/orcamentos",
  "src/domain/precos",
  "src/domain/catalogo",
  "src/domain/impressao3d",
  "src/components/orcamento",
  "src/components/precos",
  "src/components/parceiro",
  "src/components/catalogo",
];

function candidatos(): string[] {
  const soltos = [
    ...arquivos("src/lib/api").filter((f) => /orcamento|preco|catalogo-cotacao/.test(f)),
    ...arquivos("src/components").filter((f) => /^src\/components\/[^/]*(orcamento|preco)[^/]*$/.test(f)),
    ...arquivos("src/routes").filter((f) => /orcamento|parceiro|preco/.test(f)),
    ...arquivos("src").filter((f) => /preco-do-orcamento|preco-aplicado/.test(f)),
  ];
  return [...new Set([...PASTAS_DE_PRECO.flatMap(arquivos), ...soltos])];
}

const PROIBIDO = [
  /tipo-do-lead/,
  /tipos-dos-leads/,
  /origem-do-contato/,
  /\btipoDoLead\b/,
  /\bclassificarLead\b/,
  /\behLeadParceiro\b/,
  /\blerTiposDosLeads\b/,
  /\bdefinirTipoDoLead\b/,
  /\btipo_contato\b/,
  /\btipo_origem\b/,
  /\bleads\.tipo\b/,
  /from\(["']leads["']\)[^;]*\btipo\b/s,
];

describe("preço nunca lê o tipo do lead", () => {
  it("encontra arquivos de preço para varrer", () => {
    const lista = candidatos();
    expect(lista.length).toBeGreaterThan(30);
    expect(lista).toContain("src/domain/parceiros/preco.ts");
    expect(lista).toContain("src/domain/orcamentos/preco-aplicado.ts");
    expect(lista.some((f) => f.endsWith("preco-do-orcamento.tsx"))).toBe(true);
  });
  it("nenhum arquivo de preço importa ou lê leads.tipo", () => {
    const achados: string[] = [];
    for (const f of candidatos()) {
      const fonte = readFileSync(f, "utf8");
      for (const re of PROIBIDO) if (re.test(fonte)) achados.push(`${f}: ${re}`);
    }
    expect(achados).toEqual([]);
  });
  it("o domínio do tipo do lead não importa nada de preço nem de parceiros cadastrados", () => {
    for (const f of ["src/domain/crm/tipo-do-lead.ts", "src/domain/whatsapp/origem-do-contato.ts", "src/lib/api/origem-do-contato.functions.ts"]) {
      const fonte = readFileSync(f, "utf8");
      expect(fonte, f).not.toMatch(/from\s+["'][^"']*(orcamentos|precos|parceiros)\//);
      expect(fonte, f).not.toMatch(/\.from\(["'](parceiros|orcamentos|clientes)["']\)/);
    }
  });
});
