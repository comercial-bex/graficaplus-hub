import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { itemCandidatoDe, montarSugestoes } from "../src/lib/api/flexi-vinculos.functions";

const linha = (o: Record<string, unknown> = {}) => ({
  id: "item-1",
  descricao: "Lona 440g",
  quantidade: "1.00",
  largura: "2.500",
  altura: "1.300",
  orcamentos: {
    id: "orc-108",
    numero: 108,
    titulo: "Pedido pelo WhatsApp",
    status: "convertido",
    created_at: "2026-10-22T15:23:21-03:00",
    os_id: "os-1",
  },
  ...o,
});

const job = (o: Record<string, unknown> = {}) => ({
  id: "job-1",
  nome_job: "250x130.jpg",
  largura_cm: "131.000",
  altura_cm: "251.899",
  copias: 1,
  impresso_em: "2026-10-22T21:03:44+00:00",
  ...o,
});

describe("itens do orçamento para o vínculo", () => {
  it("lê os números que o banco devolve como texto", () => {
    expect(itemCandidatoDe(linha() as never)).toMatchObject({
      itemId: "item-1",
      orcamentoNumero: 108,
      larguraM: 2.5,
      alturaM: 1.3,
      quantidade: 1,
      osId: "os-1",
    });
  });

  it("item sem medida fica sem medida, e sem quantidade vale 1", () => {
    const c = itemCandidatoDe(linha({ largura: null, altura: "0", quantidade: null }) as never);
    expect(c).toMatchObject({ larguraM: null, alturaM: null, quantidade: 1 });
  });

  it("item sem orçamento é descartado", () => {
    expect(itemCandidatoDe(linha({ orcamentos: null }) as never)).toBeNull();
  });

  it("não deixa preço, custo nem cliente passarem para o navegador", () => {
    const c = itemCandidatoDe({
      ...linha(),
      valor_total: 999,
      custo_unitario: 5,
      cliente_id: "x",
    } as never);
    expect(Object.keys(c ?? {}).sort()).toEqual(
      [
        "alturaM",
        "descricao",
        "itemId",
        "larguraM",
        "orcamentoCriadoEm",
        "orcamentoId",
        "orcamentoNumero",
        "orcamentoStatus",
        "orcamentoTitulo",
        "osId",
        "quantidade",
      ].sort(),
    );
  });
});

describe("montar as sugestões", () => {
  const itens = [itemCandidatoDe(linha() as never)!];

  it("a lona da OS 108 vira sugestão confirmável, com o horário vindo em UTC do banco", () => {
    const { sugestoes, semCandidato } = montarSugestoes([job()], itens);
    expect(semCandidato).toBe(0);
    expect(sugestoes).toHaveLength(1);
    expect(sugestoes[0]).toMatchObject({
      rip_job_id: "job-1",
      estado: "sugerido",
      origem: "medida",
      orcamento_item_id: "item-1",
    });
    expect(sugestoes[0].confianca).toBeGreaterThanOrEqual(0.7);
  });

  it("job sem candidato é contado, não inventado", () => {
    const { sugestoes, semCandidato } = montarSugestoes(
      [job({ largura_cm: "30", altura_cm: "10" })],
      itens,
    );
    expect(sugestoes).toEqual([]);
    expect(semCandidato).toBe(1);
  });

  it("'revisar' vai sem item principal, só com candidatos", () => {
    const dois = [
      itemCandidatoDe(linha({ id: "a" }) as never)!,
      itemCandidatoDe(
        linha({ id: "b", orcamentos: { ...linha().orcamentos, id: "o2", numero: 109 } }) as never,
      )!,
    ];
    const { sugestoes } = montarSugestoes([job()], dois);
    expect(sugestoes[0].estado).toBe("revisar");
    expect(sugestoes[0].orcamento_item_id).toBeNull();
    expect(sugestoes[0].candidatos).toHaveLength(2);
  });
});

describe("a escrita do vínculo só passa pelo servidor", () => {
  const funcoes = readFileSync(
    resolve(__dirname, "../src/lib/api/flexi-vinculos.functions.ts"),
    "utf8",
  );
  const migracao = readFileSync(
    resolve(__dirname, "../supabase/migrations/20261024233000_flexi_vinculos.sql"),
    "utf8",
  );

  it("o servidor grava pelas funções SQL, nunca por insert direto", () => {
    expect(funcoes).toContain('rpc("rip_gravar_sugestoes"');
    expect(funcoes).toContain('rpc("rip_decidir_vinculo"');
    expect(funcoes).not.toMatch(/\.from\("rip_job_vinculos"\)\s*\.(insert|upsert|update|delete)/);
  });

  it("as duas funções SQL só executam para o service_role", () => {
    for (const nome of ["rip_gravar_sugestoes", "rip_decidir_vinculo"]) {
      expect(migracao).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${nome}\\([^)]*\\) FROM PUBLIC, anon, authenticated`,
        ),
      );
      expect(migracao).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${nome}\\([^)]*\\) TO service_role`),
      );
    }
  });

  it("não há policy de escrita para o navegador", () => {
    expect(migracao).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/i);
    expect(migracao).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.rip_job_vinculos FROM authenticated",
    );
  });

  it("decisão de pessoa nunca é sobrescrita por sugestão", () => {
    expect(migracao).toContain("WHERE v.estado IN ('sugerido', 'revisar')");
  });

  it("o servidor devolve ao navegador só número, título, descrição, medida e quantidade — sem preço", () => {
    // Só o que está entre aspas nos select(): os comentários falam dessas colunas para dizer que NÃO saem.
    const colunas = [...funcoes.matchAll(/select\(\s*"([^"]*)"/g)].map((m) => m[1]).join(" ");
    const embutidas = funcoes.match(/COLUNAS_DO_ITEM =\s*"([^"]*)"/)?.[1] ?? "";
    expect(embutidas).not.toBe("");
    expect(`${colunas} ${embutidas}`).not.toMatch(/valor_|custo_|margem|cliente|desconto/);
  });
});

describe("o que a coluna Orçamento diz", () => {
  const base = {
    origem: "medida" as const,
    orcamento_numero: 115,
    orcamento_titulo: "t",
    item_descricao: "d",
    confianca: 0.8,
    motivos: [],
    candidatos: [],
    motivo_sem_orcamento: null,
  };

  it("diz a situação de cada vínculo, sem chamar de confirmado o que é só sugestão", async () => {
    const { rotuloDoVinculo } = await import("../src/domain/flexi/rotulos");
    expect(rotuloDoVinculo(null)).toEqual({ texto: "Sem orçamento ligado", tom: "neutro" });
    expect(rotuloDoVinculo({ ...base, estado: "confirmado" }).texto).toBe("Orç. 115 ✓");
    expect(rotuloDoVinculo({ ...base, estado: "sugerido" }).texto).toBe("Orç. 115? (sugerido)");
    expect(rotuloDoVinculo({ ...base, estado: "sugerido" }).tom).toBe("atencao");
    expect(
      rotuloDoVinculo({ ...base, estado: "revisar", candidatos: [{}, {}] as never }).texto,
    ).toBe("Escolher entre 2");
    expect(
      rotuloDoVinculo({ ...base, estado: "sem_orcamento", motivo_sem_orcamento: "prova" }).texto,
    ).toBe("Sem orçamento (prova)");
    expect(rotuloDoVinculo({ ...base, estado: "recusado" }).texto).toBe("Sugestão recusada");
  });
});
