import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A fila de Design não pode voltar aos três defeitos que tinha:
 *
 *   1. aprovar gravando direto em `aprovacoes` — sem o histórico da peça
 *      (arquivo_aprovacoes) e sem mexer no status da OS;
 *   2. o botão de comentário chamando `concluir` (final_producao = true);
 *   3. listar arquivo inativo ("[teste removido]") como arte na fila.
 *
 * São regras de LIGAÇÃO, não de cálculo: nenhum teste de domínio pega se
 * alguém trocar a RPC por um insert de novo. Por isso o teste lê o código.
 */

const PASTA = "src/components/design";
const pagina = readFileSync("src/routes/_authenticated/design.tsx", "utf8");
const componentes = Object.fromEntries(
  readdirSync(PASTA).map((f) => [f, readFileSync(join(PASTA, f), "utf8")]),
);
const tudo = [pagina, ...Object.values(componentes)].join("\n");

/** Chaves do objeto passado a `.rpc("nome", { ... })`. */
function paramsDa(texto: string, rpc: string): string[] {
  const m = new RegExp(
    `\\.rpc\\s*(?:as any\\s*\\))?\\s*\\(\\s*["']${rpc}["']\\s*,\\s*\\{([^}]*)\\}`,
  ).exec(texto);
  if (!m) return [];
  return [...m[1].matchAll(/(?:^|[,{])\s*([a-z_][a-z0-9_]*)\s*:/gi)].map((k) => k[1]).sort();
}

describe("aprovar passa pelo caminho que já existe", () => {
  it("nenhum insert direto em aprovacoes", () => {
    expect(tudo).not.toMatch(/from\(\s*["']aprovacoes["']\s*\)/);
  });

  it("chama registrar_aprovacao_interna com os seis parâmetros da função viva", () => {
    // Assinatura lida no banco em 02/10/2026 (pg_get_function_identity_arguments).
    expect(paramsDa(componentes["decisao-da-arte.tsx"], "registrar_aprovacao_interna")).toEqual(
      [
        "p_arquivo_id",
        "p_canal",
        "p_cliente_contato_id",
        "p_decisao",
        "p_observacao",
        "p_os_id",
      ].sort(),
    );
  });
});

describe("comentar comenta; concluir conclui", () => {
  it("o botão de comentário grava pela função comentar_arte, com os nomes da migração", () => {
    const migracao = readFileSync(
      "supabase/migrations/20261002103001_comentarios_da_arte.sql",
      "utf8",
    );
    expect(migracao).toContain("comentar_arte(p_arquivo_id uuid, p_comentario text)");
    expect(paramsDa(componentes["comentarios-da-arte.tsx"], "comentar_arte")).toEqual([
      "p_arquivo_id",
      "p_comentario",
    ]);
  });

  it("o componente do balão de comentário não toca em final_producao", () => {
    expect(componentes["comentarios-da-arte.tsx"]).toContain("MessageSquare");
    expect(componentes["comentarios-da-arte.tsx"]).not.toContain("final_producao");
  });

  it("final_producao só é gravado pelo botão que diz Concluir", () => {
    const arquivos = Object.entries(componentes)
      .filter(([, t]) => t.includes("final_producao: true"))
      .map(([f]) => f);
    expect(arquivos).toEqual(["cartao-da-arte.tsx"]);
    const cartao = componentes["cartao-da-arte.tsx"];
    const concluir = cartao.slice(cartao.indexOf("function ConcluirArte"));
    expect(concluir).toContain("final_producao: true");
    expect(concluir).toContain("Concluir");
    expect(cartao.slice(0, cartao.indexOf("function ConcluirArte"))).not.toContain(
      "final_producao",
    );
    expect(pagina).not.toContain("final_producao: true");
  });
});

describe("a fila mostra a arte de verdade, e só a que vale", () => {
  it("a fila lê só arquivo ativo e não substituído", () => {
    expect(pagina).toMatch(/\.eq\(\s*"ativo",\s*true\s*\)/);
    expect(pagina).toMatch(/\.not\(\s*"status",\s*"in",\s*"\(substituido,inativo\)"\s*\)/);
  });

  it("a miniatura vem de URL assinada, não de ícone fixo", () => {
    expect(componentes["miniatura-da-arte.tsx"]).toContain("createSignedUrl");
    expect(componentes["miniatura-da-arte.tsx"]).toContain("<img");
  });
});
