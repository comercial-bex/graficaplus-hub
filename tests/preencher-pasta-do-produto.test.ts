import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Preencher a pasta do produto com o que já existe (03/11/2026, OK do dono):
 * a migração só deriva de dado que o sistema já tem. Estas guardas leem o SQL
 * para que ninguém "melhore" a regra sem perceber o que ela protege.
 */

const sql = readFileSync("supabase/migrations/20261103001000_preencher_pasta_do_produto.sql", "utf8");
const corpo = sql.replace(/--[^\n]*/g, "");

describe("a migração que preenche a pasta", () => {
  it("a medida padrão vem do tamanho pronto marcado como padrão, só em produto por área e só onde falta", () => {
    expect(corpo).toContain("WHERE t.padrao AND t.largura > 0 AND t.altura > 0");
    expect(corpo).toContain("DISTINCT ON (t.produto_id)");
    expect(corpo).toContain("pr.tipo::text <> 'servico'");
    expect(corpo).toContain("= 'm2'");
    expect(corpo).toContain("coalesce(f.largura_padrao_m, 0) <= 0 OR coalesce(f.altura_padrao_m, 0) <= 0");
  });

  it("o material principal só é escolhido quando a ficha tem UMA bobina, com largura cadastrada", () => {
    expect(corpo).toContain("coalesce(m.largura_bobina_m, 0) > 0");
    expect(corpo).toContain("count(DISTINCT m.id) AS quantas");
    expect(corpo).toContain("b.quantas = 1");
    expect(corpo).toContain("p.material_principal_id IS NULL");
  });

  it("as placas ganham as três perguntas com resposta já marcada, sem duplicar o que já existe", () => {
    expect(corpo).toContain("p.familia = 'Placas'");
    expect(corpo).toContain("'Não, o cliente instala'");
    expect(corpo).toContain("'seguir_cliente'");
    expect(corpo).toContain("NOT EXISTS (");
    expect(corpo).toContain("x.produto_id = p.id AND x.pergunta = q.pergunta");
    // Os processos são achados pelo nome; se algum faltar, nada entra.
    expect(corpo).toContain("proc.arte IS NOT NULL AND proc.instalacao IS NOT NULL");
  });

  it("não toca em preço, custo, descrição, foto nem na revisão de quem atende", () => {
    for (const proibido of [
      "preco_base",
      "custo_medio",
      "preco_sugerido",
      "preco_publico",
      "margem",
      "descricao =",
      "imagem_url",
      "ia_revisado",
    ]) {
      expect(corpo, proibido).not.toContain(proibido);
    }
  });
});
