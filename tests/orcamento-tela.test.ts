import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { reordenar } from "../src/components/orcamento/layouts-do-item";

/**
 * A tela do orçamento e os layouts de cada item.
 *
 * Três defeitos de 05/10/2026 que estes testes seguram:
 *   - o vendedor não conseguia anexar a arte: o Storage exigia
 *     `arquivos.upload`. A migração 20261005234000 abre SÓ a pasta
 *     `orcamento/…` para quem edita orçamento — então a tela tem de gravar
 *     nessa pasta, senão volta a dar "violates row-level security";
 *   - a lista de itens descartava o erro (`.data ?? []`): consulta caída virava
 *     "Sem itens" e o vendedor adicionava tudo de novo;
 *   - prazos, entrega e pagamento não existem nas views `orcamentos_*`: lidos
 *     da tabela base com lista FECHADA de colunas (o `*` traria colunas de
 *     dinheiro sem grant e a consulta inteira cairia).
 */

const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
const LAYOUTS = readFileSync("src/components/orcamento/layouts-do-item.tsx", "utf8");
const ACORDO = readFileSync("src/components/orcamento/acordo-do-orcamento.tsx", "utf8");
const MIGRACAO = readFileSync(
  "supabase/migrations/20261005234000_layout_de_orcamento_para_quem_vende.sql",
  "utf8",
);

describe("layouts do item", () => {
  it("a arte vai para a pasta que a migração abriu", () => {
    expect(LAYOUTS).toContain("const caminho = `orcamento/${orcamentoId}/${crypto.randomUUID()}.${ext}`");
    expect(LAYOUTS).toContain('const BUCKET = "arquivos-clientes"');
    // as quatro policies falam da mesma pasta e das chaves de orçamento
    expect(MIGRACAO.match(/LIKE 'orcamento\/%'/g)).toHaveLength(4);
    expect(MIGRACAO).toContain("'orcamentos.update'");
    expect(MIGRACAO).toContain("'orcamentos.read'");
    // e não dá arquivos.* a ninguém
    expect(MIGRACAO).not.toMatch(/INSERT INTO public\.perfil_permissoes/i);
  });

  it("toda escrita das artes confere o erro", () => {
    const escritas = [...LAYOUTS.matchAll(/\.(insert|update|delete)\(/g)].length;
    const conferidas = [...LAYOUTS.matchAll(/if \((error|erroCapa|erroUpload)\) throw/g)].length;
    expect(escritas).toBeGreaterThan(0);
    expect(conferidas).toBeGreaterThanOrEqual(escritas);
  });

  it("capa é a primeira: usar como capa leva para o começo; mover troca de lugar", () => {
    expect(reordenar(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(reordenar(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    // fora da lista não mexe (nem devolve cópia: quem chama sabe que nada mudou)
    const lista = ["a", "b"];
    expect(reordenar(lista, 0, -1)).toBe(lista);
    expect(reordenar(lista, 1, 2)).toBe(lista);
  });
});

describe("a tela não esconde falha", () => {
  it("a lista de itens lê o erro e mostra, em vez de 'nenhum item'", () => {
    expect(TELA).not.toMatch(/\)\.data \?\? \[\]/);
    expect(TELA).toContain("consultaItens.isError");
    expect(TELA).toContain("não orçamento vazio");
  });

  it("prazos, entrega e pagamento vêm da tabela com lista fechada", () => {
    expect(TELA).toContain(".select(COLUNAS_DO_ACORDO)");
    expect(ACORDO).toMatch(/export const COLUNAS_DO_ACORDO =\s*"[a-z_, ]+"/);
    expect(ACORDO).not.toMatch(/COLUNAS_DO_ACORDO =\s*"\*"/);
    for (const coluna of ["precisa_entrega", "endereco_entrega", "observacao_cliente", "condicao_pagamento", "prazo"]) {
      expect(ACORDO).toContain(coluna);
    }
  });

  it("toda gravação do quadro lateral confere linha gravada (RLS devolve 0 sem erro)", () => {
    expect(ACORDO).toContain('if (!data || data.length === 0) throw new Error("Seu perfil não pode alterar este orçamento.")');
  });

  it("dinheiro sai em pt-BR, nunca R$ 0.00", () => {
    expect(TELA).not.toMatch(/R\$ \{Number\([^)]*\)\.toFixed\(2\)\}/);
    expect(TELA).toContain("brl(");
  });
});

describe("o build não engole o que não usa", () => {
  it("idioma do date-fns entra um por um, nunca pelo índice de todos", () => {
    // `from "date-fns/locale"` puxa os ~100 idiomas (529 módulos a mais) e o
    // build de produção estourou a memória no passo do servidor (05/10/2026).
    const achados = execSync('grep -rln "from \\"date-fns/locale\\"" src || true', { encoding: "utf8" }).trim();
    expect(achados).toBe("");
  });
});
