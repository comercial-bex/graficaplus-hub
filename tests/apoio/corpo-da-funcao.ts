import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Apoio das migrações da onda 1 de orçamentos (17/11/2026): lê o SQL como texto e extrai o corpo de uma função. */
export const RAIZ = join(__dirname, "..", "..");
export const PASTA_MIGRACOES = join(RAIZ, "supabase", "migrations");

export const lerMigracao = (nome: string) => readFileSync(join(PASTA_MIGRACOES, nome), "utf8");
export const lerDoc = (nome: string) => readFileSync(join(RAIZ, "docs", nome), "utf8");

export const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

export const md5 = (t: string) => createHash("md5").update(t).digest("hex");

/**
 * O que o Postgres guarda em pg_proc.prosrc: o texto entre os delimitadores do `AS $tag$ ... $tag$`,
 * sem tirar nem um espaço. O md5 disso é o que o ensaio no banco vivo imprimiu.
 */
export function corpoDa(texto: string, assinatura: string): string {
  const i = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${assinatura}`);
  if (i < 0) throw new Error(`sem ${assinatura}`);
  const m = /AS\s+(\$[a-z_]*\$)/.exec(texto.slice(i));
  if (!m) throw new Error(`sem delimitador em ${assinatura}`);
  const tag = m[1];
  const ini = i + m.index + m[0].length;
  return texto.slice(ini, texto.indexOf(tag, ini));
}

/** O cabeçalho da função (entre o nome e o delimitador), para conferir SECURITY DEFINER e search_path. */
export function cabecalhoDa(texto: string, assinatura: string): string {
  const i = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${assinatura}`);
  const m = /AS\s+(\$[a-z_]*\$)/.exec(texto.slice(i));
  return texto.slice(i, i + (m?.index ?? 0));
}
