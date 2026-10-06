import { readFileSync } from "node:fs";

/**
 * O contrato com o banco, lido do `src/integrations/supabase/types.ts`.
 *
 * O arquivo é gerado pelo Lovable a partir do banco vivo: é o retrato que o
 * código compila contra. Os testes que usam este apoio conferem consultas
 * que o TypeScript NÃO pega — o nome de coluna dentro de um `.select("…")`,
 * o `.order("…")`, o embed de relação no PostgREST —, e que em produção
 * viravam lista vazia ou zero: a consulta caía e a tela jogava o erro fora.
 *
 * Não é um teste (o nome não termina em .test.ts); é o apoio deles.
 */

const TIPOS = readFileSync("src/integrations/supabase/types.ts", "utf8");

// Só o schema public, de "Tables" até "Functions": o arquivo repete
// `public: {` no fim, nas constantes de enum.
const INICIO = TIPOS.indexOf("\n  public: {\n    Tables: {");
const PUBLICO = TIPOS.slice(INICIO, TIPOS.indexOf("\n    Functions: {", INICIO));

function bloco(relacao: string): string {
  const marca = `\n      ${relacao}: {\n`;
  const i = PUBLICO.indexOf(marca);
  if (i < 0) throw new Error(`a relação ${relacao} não está em types.ts`);
  return PUBLICO.slice(i, PUBLICO.indexOf("\n      }\n", i + marca.length));
}

function secao(relacao: string, nome: "Row" | "Insert"): string {
  const b = bloco(relacao);
  const marca = `\n        ${nome}: {\n`;
  const i = b.indexOf(marca);
  if (i < 0) throw new Error(`${relacao} não tem ${nome} em types.ts`);
  return b.slice(i + marca.length, b.indexOf("\n        }", i + marca.length));
}

/** Colunas que a tabela ou view tem. */
export function colunas(relacao: string): Set<string> {
  return new Set([...secao(relacao, "Row").matchAll(/^ {10}([a-z_0-9]+)\??:/gm)].map((m) => m[1]));
}

/** Colunas que o INSERT não pode omitir: NOT NULL sem default. */
export function obrigatoriasNoInsert(tabela: string): string[] {
  return [...secao(tabela, "Insert").matchAll(/^ {10}([a-z_0-9]+):/gm)].map((m) => m[1]);
}

type Chave = { nome: string; colunas: string[]; referencia: string };

function chavesEstrangeiras(relacao: string): Chave[] {
  const b = bloco(relacao);
  const i = b.indexOf("\n        Relationships: [");
  if (i < 0) return [];
  return [
    ...b
      .slice(i)
      .matchAll(
        /foreignKeyName: "([^"]+)"\s+columns: \[([^\]]*)\][\s\S]*?referencedRelation: "([^"]+)"/g,
      ),
  ].map((m) => ({
    nome: m[1],
    colunas: [...m[2].matchAll(/"([^"]+)"/g)].map((c) => c[1]),
    referencia: m[3],
  }));
}

/**
 * As chaves que ligam duas relações, nos dois sentidos. É o que o PostgREST
 * enxerga para resolver um embed: mais de uma e ele recusa a consulta inteira
 * (PGRST201) até alguém dizer qual.
 */
export function chavesEntre(de: string, para: string): Chave[] {
  const ida = chavesEstrangeiras(de).filter((c) => c.referencia === para);
  const volta = de === para ? [] : chavesEstrangeiras(para).filter((c) => c.referencia === de);
  const vistas = new Set<string>();
  return [...ida, ...volta].filter((c) => (vistas.has(c.nome) ? false : (vistas.add(c.nome), true)));
}

export type ItemDoSelect =
  | { tipo: "coluna"; nome: string }
  | { tipo: "embed"; relacao: string; dica: string | null; itens: ItemDoSelect[] };

/** Divide no separador, sem entrar em parênteses. */
function partesDeTopo(texto: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const ch of texto) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      partes.push(atual.trim());
      atual = "";
      continue;
    }
    atual += ch;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

/** Lê um `select` do PostgREST: colunas e embeds (`apelido:relacao!dica(…)`). */
export function lerSelect(select: string): ItemDoSelect[] {
  return partesDeTopo(select.replace(/\s+/g, " ")).map((parte): ItemDoSelect => {
    const abre = parte.indexOf("(");
    if (abre > 0 && parte.endsWith(")")) {
      const cabeca = parte.slice(0, abre).replace(/^[a-z_0-9]+:/, "");
      const [relacao, ...resto] = cabeca.split("!");
      const dica = resto.find((r) => r !== "inner" && r !== "left") ?? null;
      return { tipo: "embed", relacao, dica, itens: lerSelect(parte.slice(abre + 1, -1)) };
    }
    // apelido:coluna, coluna::tipo, coluna->caminho
    const nome = parte.replace(/^[a-z_0-9]+:(?!:)/, "").split("::")[0].split("->")[0].trim();
    return { tipo: "coluna", nome };
  });
}

/**
 * Tudo o que o PostgREST recusaria neste select: coluna que a relação não
 * tem, embed sem chave, embed com mais de uma chave e sem dizer qual, e dica
 * que não é chave nenhuma entre as duas.
 */
export function problemasDoSelect(relacao: string, select: string): string[] {
  const problemas: string[] = [];
  const existentes = colunas(relacao);
  for (const item of lerSelect(select)) {
    if (item.tipo === "coluna") {
      if (item.nome !== "*" && item.nome !== "count" && !existentes.has(item.nome)) {
        problemas.push(`${relacao}.${item.nome} não existe`);
      }
      continue;
    }
    const chaves = chavesEntre(relacao, item.relacao);
    if (item.dica) {
      const casa = chaves.some((c) => c.nome === item.dica || c.colunas.includes(item.dica as string));
      if (!casa) problemas.push(`${relacao}→${item.relacao}!${item.dica}: não é chave entre as duas`);
    } else if (chaves.length === 0) {
      problemas.push(`${relacao}→${item.relacao}: nenhuma chave liga as duas`);
    } else if (chaves.length > 1) {
      problemas.push(
        `${relacao}→${item.relacao}: ${chaves.length} chaves (${chaves.map((c) => c.nome).join(", ")}) — o embed precisa dizer qual`,
      );
    }
    problemas.push(...problemasDoSelect(item.relacao, item.itens.map(serializar).join(", ")));
  }
  return problemas;
}

function serializar(item: ItemDoSelect): string {
  if (item.tipo === "coluna") return item.nome;
  return `${item.relacao}${item.dica ? `!${item.dica}` : ""}(${item.itens.map(serializar).join(", ")})`;
}
