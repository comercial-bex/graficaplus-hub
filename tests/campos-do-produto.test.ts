import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { abasDaPasta, pendenciaDaPergunta } from "@/domain/catalogo/pasta-do-produto";
import { perguntaDaLinha, perguntasPorFinalidade } from "@/domain/orcamentos/perguntas-do-item";

/**
 * Fase 2 do plano de 02/11/2026: a aba Campos da pasta do produto, como no
 * Holdprint. Campo de informação é pergunta com finalidade `informacao`: o
 * item pergunta, a resposta vai para a produção, e nada muda no preço.
 */

const linha = (extra: Record<string, unknown>) => ({
  id: "q1",
  pergunta: "Texto da placa",
  tipo_resposta: "texto",
  respostas: [],
  acoes: [],
  ...extra,
});

describe("a finalidade da pergunta", () => {
  it("sem finalidade é cobrança; informação nunca carrega ação, mesmo gravada por fora", () => {
    expect(perguntaDaLinha(linha({})).finalidade).toBe("cobranca");
    const campo = perguntaDaLinha(
      linha({ finalidade: "informacao", acoes: [{ resposta: "Sim", processo_id: "p1" }] }),
    );
    expect(campo.finalidade).toBe("informacao");
    expect(campo.acoes).toEqual([]);
  });

  it("separa as perguntas do Checklist dos campos, cada grupo na ordem do cadastro", () => {
    const lista = [
      perguntaDaLinha(linha({ id: "a", pergunta: "Embalar?", tipo_resposta: "unica", respostas: ["Sim", "Não"] })),
      perguntaDaLinha(linha({ id: "b", finalidade: "informacao" })),
      perguntaDaLinha(linha({ id: "c", pergunta: "Acabamento?", tipo_resposta: "unica", respostas: ["Bainha", "Ilhós"] })),
      perguntaDaLinha(linha({ id: "d", pergunta: "Cor da letra", finalidade: "informacao" })),
    ];
    const g = perguntasPorFinalidade(lista);
    expect(g.cobranca.map((p) => p.id)).toEqual(["a", "c"]);
    expect(g.informacao.map((p) => p.id)).toEqual(["b", "d"]);
  });

  it("no cadastro, campo com ação é recusado e campo sem nome pede o nome", () => {
    const base = { pergunta: "Cor", tipo_resposta: "unica" as const, respostas: ["Azul", "Vermelho"], acoes: [] };
    expect(pendenciaDaPergunta({ ...base, finalidade: "informacao" })).toBeNull();
    expect(
      pendenciaDaPergunta({ ...base, finalidade: "informacao", acoes: [{ resposta: "Azul", processo_id: "p1" }] }),
    ).toMatch(/não acrescenta processo/);
    expect(pendenciaDaPergunta({ ...base, pergunta: " ", finalidade: "informacao" })).toBe("Escreva o nome do campo.");
    expect(pendenciaDaPergunta({ ...base, pergunta: " " })).toBe("Escreva a pergunta.");
  });

  it("a pasta tem as dez abas do Holdprint, Campos entre Info e Histórico", () => {
    const ids = abasDaPasta({ canSeePrices: true }).map((a) => a.id);
    expect(ids).toEqual([
      "descricao",
      "preco",
      "parametros",
      "processos",
      "formulas",
      "checklist",
      "ia",
      "info",
      "campos",
      "historico",
    ]);
  });
});

describe("as telas e o banco", () => {
  const pasta = readFileSync("src/routes/_authenticated/produtos_.$id.tsx", "utf8");
  const item = readFileSync("src/components/orcamento/perguntas-do-item.tsx", "utf8");
  const migracao = readFileSync("supabase/migrations/20261102210000_campos_do_produto.sql", "utf8");
  const ia = readFileSync("src/lib/api/orcamento-ia.functions.ts", "utf8");
  const tipos = readFileSync("src/integrations/supabase/types.ts", "utf8");

  it("a aba Campos reaproveita a tela do Checklist com a finalidade informacao, e cada aba lê só a sua", () => {
    expect(pasta).toContain('<AbaChecklist produtoId={id} podeEditar={podeEditar} finalidade="informacao" />');
    expect(pasta).toContain('.eq("finalidade", finalidade)');
    expect(pasta).toContain('const chave = ["pasta-perguntas", produtoId, finalidade];');
    expect(pasta).toContain("{comLista && !ehCampo && (");
    expect(pasta).toContain('data-testid={ehCampo ? "campos-do-produto" : "checklist-do-produto"}');
  });

  it("o item do orçamento mostra os campos num bloco próprio, depois das perguntas que cobram", () => {
    expect(item).toContain("nao_perguntar, finalidade");
    expect(item).toContain('testid="perguntas-do-item"');
    expect(item).toContain('testid="campos-do-item"');
    expect(item).toContain('titulo="Informações para a produção"');
    expect(item.indexOf('testid="perguntas-do-item"')).toBeLessThan(item.indexOf('testid="campos-do-item"'));
  });

  it("a migração dá a coluna com padrão cobranca, o CHECK e a regra de campo sem ação; a IA e os tipos conhecem a coluna", () => {
    expect(migracao).toContain("ADD COLUMN IF NOT EXISTS finalidade text NOT NULL DEFAULT 'cobranca'");
    expect(migracao).toContain("CHECK (finalidade IN ('cobranca', 'informacao'))");
    expect(migracao).toContain("CHECK (finalidade <> 'informacao' OR acoes IS NULL OR jsonb_array_length(acoes) = 0)");
    expect(ia).toContain("ia_instrucao, finalidade");
    const bloco = tipos.slice(tipos.indexOf("      produto_perguntas: {"), tipos.indexOf("      produto_precificacao: {"));
    expect(bloco.match(/finalidade/g)?.length).toBe(3);
  });
});
