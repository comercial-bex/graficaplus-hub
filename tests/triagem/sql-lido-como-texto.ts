import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ajuda dos testes de contrato das migrações da triagem: lê o SQL como texto,
 * tira comentários e lê as linhas de um INSERT ... VALUES para comparar com as
 * constantes TypeScript. Nada aqui fala com banco.
 */
export const PASTA_DAS_MIGRACOES = join(__dirname, "..", "..", "supabase", "migrations");

export const MIGRACAO_B1 = "20261113130000_triagem_dados.sql";
export const MIGRACAO_B3 = "20261113131000_horario_unico.sql";
export const MIGRACAO_B4 = "20261113132000_triagem_estado_e_envio.sql";

export function lerMigracao(nome: string): string {
  return readFileSync(join(PASTA_DAS_MIGRACOES, nome), "utf8");
}

/** Tira os comentários `--` para que explicar algo num comentário não passe nem reprove. */
export function semComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Corpo de `CREATE OR REPLACE FUNCTION public.<nome>(` até o `$function$;` que fecha. */
export function corpoDaFuncao(sql: string, nome: string): string {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  if (inicio < 0) throw new Error(`a função ${nome} não está na migração`);
  const fim = sql.indexOf("$function$;", inicio);
  if (fim < 0) throw new Error(`a função ${nome} não fecha`);
  return sql.slice(inicio, fim + "$function$;".length);
}

export type Valor = string | number | boolean | null | Valor[];

/**
 * Lê as tuplas de `INSERT INTO public.<tabela> (...) VALUES (...), (...);`.
 * Entende texto com '' escapado, NULL, true, false, números, ARRAY[...]::text[] e '{}'::text[].
 */
export function lerTuplas(sql: string, tabela: string): Valor[][] {
  // o INSERT de sementes é o que tem literais depois de VALUES (o das funções usa variáveis)
  let ini = -1;
  for (let de = 0; ; ) {
    const achou = sql.indexOf(`INSERT INTO public.${tabela} (`, de);
    if (achou < 0) break;
    const depois = sql.slice(sql.indexOf("VALUES", achou) + "VALUES".length).trimStart();
    if (/^\(\s*('|NULL)/.test(depois)) {
      ini = achou;
      break;
    }
    de = achou + 1;
  }
  if (ini < 0) throw new Error(`sem INSERT de sementes em ${tabela}`);
  let i = sql.indexOf("VALUES", ini) + "VALUES".length;
  const tuplas: Valor[][] = [];

  function pular() {
    while (i < sql.length && /\s/.test(sql[i])) i++;
  }
  function lerTexto(): string {
    // sql[i] é a aspa de abertura
    i++;
    let s = "";
    for (;;) {
      const ch = sql[i];
      if (ch === undefined) throw new Error("texto sem fim");
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          s += "'";
          i += 2;
          continue;
        }
        i++;
        return s;
      }
      s += ch;
      i++;
    }
  }
  function lerValor(): Valor {
    pular();
    if (sql[i] === "'") {
      const s = lerTexto();
      if (sql.startsWith("::text[]", i)) {
        i += "::text[]".length;
        if (s === "{}") return [];
        throw new Error(`array literal inesperado: ${s}`);
      }
      return s;
    }
    if (sql.startsWith("ARRAY[", i)) {
      i += "ARRAY[".length;
      const itens: Valor[] = [];
      for (;;) {
        itens.push(lerValor());
        pular();
        if (sql[i] === ",") {
          i++;
          continue;
        }
        if (sql[i] === "]") {
          i++;
          break;
        }
        throw new Error("array mal formado");
      }
      if (sql.startsWith("::text[]", i)) i += "::text[]".length;
      return itens;
    }
    const m = /^(NULL|true|false|-?\d+)/.exec(sql.slice(i, i + 12));
    if (!m) throw new Error(`valor inesperado perto de: ${sql.slice(i, i + 40)}`);
    i += m[1].length;
    if (m[1] === "NULL") return null;
    if (m[1] === "true") return true;
    if (m[1] === "false") return false;
    return Number(m[1]);
  }

  for (;;) {
    pular();
    if (sql[i] === ";") break;
    if (sql[i] !== "(") throw new Error(`esperava '(' perto de: ${sql.slice(i, i + 40)}`);
    i++;
    const tupla: Valor[] = [];
    for (;;) {
      tupla.push(lerValor());
      pular();
      if (sql[i] === ",") {
        i++;
        continue;
      }
      if (sql[i] === ")") {
        i++;
        break;
      }
      throw new Error(`tupla mal formada perto de: ${sql.slice(i, i + 40)}`);
    }
    tuplas.push(tupla);
    pular();
    if (sql[i] === ",") i++;
  }
  return tuplas;
}

/** Todos os `GRANT ... TO ...` do arquivo, como { o que, para quem }. */
export function grants(sql: string): { alvo: string; para: string[] }[] {
  return [...sql.matchAll(/\bGRANT\b([^;]+?)\bTO\b([^;]+);/gi)].map((m) => ({
    alvo: m[1].trim(),
    para: m[2].split(",").map((p) => p.trim().toLowerCase()),
  }));
}
