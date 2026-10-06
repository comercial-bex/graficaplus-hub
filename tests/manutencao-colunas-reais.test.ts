import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { colunas, obrigatoriasNoInsert, problemasDoSelect } from "./apoio/contrato-do-banco";

/**
 * /manutencao: A TELA FOI ESCRITA PARA UMA TABELA QUE NÃO EXISTE.
 *
 * A lista ordenava por `data_prevista` (a coluna é `data_programada`): 42703
 * para os cinco usuários, e a tela, sem ler `isError`, ficava vazia. O "Criar"
 * gravava `maquina_nome` e `data_prevista`, que não existem, e não mandava
 * `maquina_id` nem `titulo`, que são NOT NULL sem default: nunca gravou nada.
 * A tabela tinha 0 linhas em 05/10/2026.
 *
 * O TypeScript pega coluna errada no `insert` do cliente tipado, mas não no
 * texto do `select` nem no `order` — e foi exatamente aí que a lista morreu.
 * Este teste confere os três contra o retrato do banco (types.ts).
 */

type Achado = { problemas: string[]; consultas: number };

/** Confere toda cadeia `.from("manutencoes")…;` do arquivo. */
function conferir(fonte: string): Achado {
  const problemas: string[] = [];
  const existentes = colunas("manutencoes");
  const constante = (nome: string) =>
    fonte.match(new RegExp(`const ${nome} =\\s*"([^"]*)"`))?.[1] ?? null;

  const cadeias = [...fonte.matchAll(/\.from\("manutencoes"\)([\s\S]*?);/g)].map((m) => m[1]);
  for (const cadeia of cadeias) {
    const select = cadeia.match(/\.select\(\s*(?:"([^"]*)"|([A-Z_]+))/);
    if (select) {
      const texto = select[1] ?? constante(select[2]);
      if (texto === null) problemas.push(`select com constante desconhecida: ${select[2]}`);
      else problemas.push(...problemasDoSelect("manutencoes", texto));
    }
    for (const ordem of cadeia.matchAll(/\.order\(\s*"([^"]+)"/g)) {
      if (!existentes.has(ordem[1])) problemas.push(`order por manutencoes.${ordem[1]}, que não existe`);
    }
    const insert = cadeia.match(/\.insert\(\{([\s\S]*?)\}\)/);
    if (insert) {
      const chaves = chavesDoObjeto(insert[1]);
      for (const c of chaves) if (!existentes.has(c)) problemas.push(`insert grava manutencoes.${c}, que não existe`);
      for (const c of obrigatoriasNoInsert("manutencoes")) {
        if (!chaves.includes(c)) problemas.push(`insert não manda manutencoes.${c}, que é obrigatória`);
      }
    }
  }
  // O update recebe `changes` montado nos botões: confere cada objeto.
  for (const m of fonte.matchAll(/changes:\s*\{([^}]*)\}/g)) {
    for (const c of chavesDoObjeto(m[1])) {
      if (!existentes.has(c)) problemas.push(`update grava manutencoes.${c}, que não existe`);
    }
  }
  return { problemas, consultas: cadeias.length };
}

/** Chaves de um literal de objeto, inclusive as abreviadas (`{ tipo }`). */
function chavesDoObjeto(corpo: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const ch of corpo) {
    if (ch === "(" || ch === "[") nivel++;
    if (ch === ")" || ch === "]") nivel--;
    if ((ch === "," || ch === ";") && nivel === 0) {
      partes.push(atual);
      atual = "";
      continue;
    }
    atual += ch;
  }
  partes.push(atual);
  return partes
    .map((p) => p.trim().match(/^([a-z_0-9]+)\??\s*(?::|$)/)?.[1])
    .filter((c): c is string => !!c);
}

describe("/manutencao", () => {
  it("o conferidor acusa a tela antiga — a trava não passa por não olhar", () => {
    // Trechos exatos da versão que estava no ar até 05/10/2026.
    const antiga = `
      const { data, error } = await db
        .from("manutencoes")
        .select("*")
        .order("data_prevista", { ascending: true });
      const { error } = await db.from("manutencoes").insert({
        maquina_nome: maquinaNome,
        tipo,
        data_prevista: dataPrevista || null,
        status: "agendada",
      });
    `;
    const { problemas } = conferir(antiga);
    expect(problemas).toEqual(
      expect.arrayContaining([
        "order por manutencoes.data_prevista, que não existe",
        "insert grava manutencoes.maquina_nome, que não existe",
        "insert grava manutencoes.data_prevista, que não existe",
        "insert não manda manutencoes.maquina_id, que é obrigatória",
        "insert não manda manutencoes.titulo, que é obrigatória",
      ]),
    );
  });

  it("a tela lê, ordena e grava só colunas que a tabela tem, e manda as obrigatórias", () => {
    const fonte = readFileSync("src/routes/_authenticated/manutencao.tsx", "utf8");
    const { problemas, consultas } = conferir(fonte);
    // listar, criar e atualizar: se o extrator não achar as três, não conferiu nada.
    expect(consultas).toBeGreaterThanOrEqual(3);
    expect(problemas).toEqual([]);
  });

  it("consulta caída aparece como erro, não como lista vazia", () => {
    const fonte = readFileSync("src/routes/_authenticated/manutencao.tsx", "utf8");
    expect(fonte).toContain("lista.isError");
    expect(fonte).toContain("Não foi possível carregar as manutenções");
  });
});
