import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIAS_CUSTO_OS } from "../src/domain/custos/categorias";

/**
 * Trava contra categoria de custo inventada.
 *
 * Escrevi `mao_de_obra` (com o "de") num filtro de relatório; a categoria real é
 * `mao_obra`. O filtro não casou com nada e a mão de obra saiu SEMPRE ZERO —
 * numa tela de custo de gráfica, onde ela costuma ser o maior custo. Nada deu
 * erro: a coluna somou zero, com cara de número.
 *
 * O teste varre as migrações e o código do front atrás de nomes de categoria que
 * o banco não aceita. Não substitui rodar o caso real — foi rodando que o defeito
 * apareceu — mas pega a digitação errada antes.
 */

const MIGRACOES = "supabase/migrations";
const FONTES = ["src/domain", "src/routes", "src/components", "src/lib"];

function arquivos(dir: string, extensoes: RegExp): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, nome.name);
    if (nome.isDirectory()) saida.push(...arquivos(caminho, extensoes));
    else if (extensoes.test(nome.name)) saida.push(caminho);
  }
  return saida;
}

/**
 * `categoria` é palavra genérica: `produtos`, `caixa_movimentos` e os dados de
 * exemplo também têm uma. Só interessa a de `custos_operacionais_os`, então a
 * busca é feita em JANELAS de texto em volta de cada menção a essa tabela.
 *
 * Janela em vez de arquivo inteiro porque um arquivo grande pode falar das duas
 * tabelas, e acusar a categoria errada seria pior que não acusar nada.
 */
const JANELA = 1500;
// Para TRÁS também: em SQL o `from custos_operacionais_os` aparece DEPOIS dos
// filtros `where categoria = ...`, então uma janela curta para trás não alcança
// as linhas que interessam. Descobri isso quebrando o código de propósito e
// vendo o teste passar — guarda que não sabe falhar não vale nada.

function categoriasCitadas(texto: string): { valor: string; contexto: string }[] {
  const achados: { valor: string; contexto: string }[] = [];
  const vistos = new Set<string>();

  for (const tabela of texto.matchAll(/custos_operacionais_os/g)) {
    const inicio = Math.max(0, (tabela.index ?? 0) - JANELA);
    const trecho = texto.slice(inicio, (tabela.index ?? 0) + JANELA);

    for (const m of trecho.matchAll(/categoria\s*(?:=|:|==|===)\s*["']([a-z_]+)["']/gi)) {
      const chave = `${inicio}|${m[0]}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      achados.push({ valor: m[1], contexto: m[0] });
    }
    for (const m of trecho.matchAll(/categoria\s+(?:not\s+)?in\s*\(([^)]*)\)/gi)) {
      for (const v of m[1].matchAll(/["']([a-z_]+)["']/g)) {
        const chave = `${inicio}|${m[0]}|${v[1]}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        achados.push({ valor: v[1], contexto: m[0].replace(/\s+/g, " ").slice(0, 80) });
      }
    }
  }
  return achados;
}

describe("categorias de custo operacional", () => {
  it("a lista do código tem as categorias que o sistema usa", () => {
    // Se o banco ganhar uma categoria, esta lista precisa acompanhar — senão o
    // teste abaixo passa a acusar falso positivo e alguém o desliga.
    expect(CATEGORIAS_CUSTO_OS).toContain("mao_obra");
    expect(CATEGORIAS_CUSTO_OS).toContain("perda");
    expect(CATEGORIAS_CUSTO_OS).not.toContain("mao_de_obra");
  });

  it("nenhuma migração usa categoria que o banco não aceita", () => {
    const invalidas: string[] = [];
    for (const caminho of arquivos(MIGRACOES, /\.sql$/)) {
      const texto = readFileSync(caminho, "utf8");
      for (const { valor, contexto } of categoriasCitadas(texto)) {
        if (!(CATEGORIAS_CUSTO_OS as readonly string[]).includes(valor)) {
          // A própria linha que DEFINE a trava lista os valores válidos; e o
          // comentário que explica o erro cita o nome errado de propósito.
          if (/check\s*\(|array\[|--/.test(contexto)) continue;
          invalidas.push(`${caminho}: ${contexto}`);
        }
      }
    }
    expect(
      invalidas,
      "Categoria que não existe faz o filtro somar ZERO em silêncio — sem erro, " +
        `com cara de número.\n${invalidas.join("\n")}`,
    ).toEqual([]);
  });

  it("nenhuma tela usa categoria que o banco não aceita", () => {
    const invalidas: string[] = [];
    for (const pasta of FONTES) {
      for (const caminho of arquivos(pasta, /\.tsx?$/)) {
        if (caminho.includes("categorias.ts")) continue;
        const texto = readFileSync(caminho, "utf8");
        for (const { valor, contexto } of categoriasCitadas(texto)) {
          if (!(CATEGORIAS_CUSTO_OS as readonly string[]).includes(valor)) {
            invalidas.push(`${caminho}: ${contexto}`);
          }
        }
      }
    }
    expect(invalidas, invalidas.join("\n")).toEqual([]);
  });
});
