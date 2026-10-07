import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

/**
 * Método do cliente Supabase solto numa constante perde o `this`.
 *
 *   const rpc = supabase.rpc as unknown as RpcSemTipo;
 *   await rpc("contas_a_receber", ...)   // lança antes de sair do navegador
 *
 * `rpc` é método da classe e lê `this.rest`. Solto, `this` é `undefined` e
 * a chamada lança "Cannot read properties of undefined (reading 'rest')".
 * Foi assim que a tela de Contas a receber nunca carregou (desde 24/09/2026;
 * a conta de R$ 121,15 vencida em 04/09 não aparecia) e a de Relatórios
 * também não (desde 31/05/2026). Achado navegando no sistema em 07/10/2026.
 *
 * Nenhum teste pegou porque o mock do cliente é uma função comum, que não
 * liga para `this`. Por isso o primeiro caso abaixo usa o cliente DE VERDADE.
 *
 * O jeito certo: chamar direto (`supabase.rpc("x")`, inclusive
 * `(supabase.rpc as any)("x")`, que mantém o `this`) ou prender antes
 * (`supabase.rpc.bind(supabase)`).
 */

const METODOS = [
  "rpc",
  "from",
  "schema",
  "channel",
  "removeChannel",
  "removeAllChannels",
  "invoke",
  "getSession",
  "getUser",
  "signOut",
  "refreshSession",
  "onAuthStateChange",
  "upload",
  "download",
  "createSignedUrl",
  "createSignedUrls",
  "getPublicUrl",
].join("|");

/**
 * `= supabase.rpc`, `= db.from`, `= supabase.storage.from` ... sem chamar na
 * hora: o que vem depois do nome não é `(`, `.` (como em `.bind`), `<` nem `?.`.
 */
const SOLTO = new RegExp(
  String.raw`=\s*(?:supabase|db)(?:\s*\.\s*\w+)*?\s*\.\s*(?:${METODOS})\b(?!\s*(?:\(|\.|<|\?\.))`,
);

/** `= (supabase.rpc as Tipo)` sem os parênteses da chamada logo depois. */
const SOLTO_COM_CAST = new RegExp(
  String.raw`=\s*\(\s*(?:supabase|db)(?:\s*\.\s*\w+)*?\s*\.\s*(?:${METODOS})\s+as\s+[^()]*\)\s*(?!\s*\()`,
);

/** `const { rpc } = supabase` */
const DESESTRUTURADO = new RegExp(
  String.raw`(?:const|let|var)\s*\{[^}]*\b(?:${METODOS})\b[^}]*\}\s*=\s*(?:supabase|db)\b`,
);

function arquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosTs(caminho));
    else if (/\.tsx?$/.test(nome) && !nome.endsWith(".d.ts")) saida.push(caminho);
  }
  return saida;
}

describe("cliente Supabase: método solto perde o this", () => {
  it("é isso mesmo que acontece com o cliente de verdade", () => {
    const cliente = createClient("https://exemplo.supabase.co", "chave-de-teste", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const solto = cliente.rpc as unknown as (nome: string) => unknown;
    expect(() => solto("qualquer")).toThrow(/reading 'rest'/);

    const preso = cliente.rpc.bind(cliente) as unknown as (nome: string) => unknown;
    expect(() => preso("qualquer")).not.toThrow();
  });

  it("os padrões da guarda reconhecem o defeito e deixam passar o certo", () => {
    expect(SOLTO.test("const rpc = supabase.rpc as unknown as RpcSemTipo;")).toBe(true);
    expect(SOLTO.test("const de = supabase.storage.from;")).toBe(true);
    expect(SOLTO_COM_CAST.test("const rpc = (supabase.rpc as any);")).toBe(true);
    expect(DESESTRUTURADO.test("const { rpc } = supabase;")).toBe(true);

    expect(SOLTO.test("const rpc = supabase.rpc.bind(supabase) as unknown as X;")).toBe(false);
    expect(SOLTO.test('const r = await supabase.rpc("x", {});')).toBe(false);
    expect(SOLTO.test('const q = supabase.from("clientes").select("id");')).toBe(false);
    expect(SOLTO.test("const r = supabase.rpc<Tipo>('x');")).toBe(false);
    expect(SOLTO_COM_CAST.test('const r = (supabase.rpc as any)("x", {});')).toBe(false);
  });

  it("nenhum arquivo de src solta método do cliente", () => {
    const arquivos = arquivosTs("src");
    expect(arquivos.length).toBeGreaterThan(50);

    const achados: string[] = [];
    for (const caminho of arquivos) {
      const linhas = readFileSync(caminho, "utf8").split("\n");
      linhas.forEach((linha, i) => {
        const codigo = linha.replace(/\/\/.*$/, "");
        if (SOLTO.test(codigo) || SOLTO_COM_CAST.test(codigo) || DESESTRUTURADO.test(codigo)) {
          achados.push(`${caminho}:${i + 1}: ${linha.trim()}`);
        }
      });
    }
    expect(achados).toEqual([]);
  });
});
