import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Pendencia } from "@/hooks/usePendencias";
import { MAXIMO_DE_NUMEROS, numerosDoDia, RESUMO_POR_ROTULO } from "@/domain/painel/resumo-do-dia";

const p = (
  chave: string,
  quantidade: number,
  severidade: Pendencia["severidade"] = "atencao",
): Pendencia => ({
  chave,
  titulo: chave,
  quantidade,
  total: null,
  severidade,
  quem_resolve: "x",
  o_que_fazer: "",
  link: `/${chave}`,
});

describe("seu dia", () => {
  const todas = [
    p("orcamento_aprovado_sem_os", 2, "critico"),
    p("whatsapp_esperando_resposta", 3, "atencao"),
    p("os_na_fila_de_producao", 7, "ok"),
    p("os_parada", 1, "critico"),
    p("parcela_vencida_sem_baixa", 4, "critico"),
    p("produto_custo_provisorio", 7, "critico"),
  ];

  it("cada papel vê os números dele", () => {
    expect(numerosDoDia(todas, ["vendedor"]).map((n) => n.chave)).toEqual([
      "orcamento_aprovado_sem_os",
      "whatsapp_esperando_resposta",
    ]);
    expect(numerosDoDia(todas, ["operador"]).map((n) => n.chave)).toEqual([
      "os_na_fila_de_producao",
    ]);
    expect(numerosDoDia(todas, ["financeiro"]).map((n) => n.chave)).toEqual([
      "parcela_vencida_sem_baixa",
      "produto_custo_provisorio",
    ]);
  });

  it("o gestor também vê o custo provisório, que é do financeiro", () => {
    expect(numerosDoDia(todas, ["gestor"]).map((n) => n.chave)).toContain(
      "produto_custo_provisorio",
    );
  });

  it("no máximo quatro, os mais graves primeiro", () => {
    const r = numerosDoDia(todas, ["admin"]);
    expect(r).toHaveLength(MAXIMO_DE_NUMEROS);
    expect(r.every((n) => n.severidade === "critico")).toBe(true);
  });

  it("ignora o que está zerado e não repete a mesma pendência", () => {
    expect(numerosDoDia([p("os_parada", 0)], ["gestor"])).toEqual([]);
    const dup = numerosDoDia([p("os_prazo_vencido", 2)], ["vendedor", "gestor", "admin"]);
    expect(dup.filter((n) => n.chave === "os_prazo_vencido")).toHaveLength(1);
  });

  it("papel sem nada e papel desconhecido dão lista vazia", () => {
    expect(numerosDoDia(todas, ["designer"])).toEqual([]);
    expect(numerosDoDia(todas, [])).toEqual([]);
    expect(numerosDoDia(todas, null)).toEqual([]);
  });
});

describe("as chaves existem de verdade", () => {
  const sql = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
    .join("\n");

  it("toda chave do resumo é uma pendência que algum banco devolve", () => {
    const faltando: string[] = [];
    for (const lista of Object.values(RESUMO_POR_ROTULO)) {
      for (const { chave } of lista) if (!sql.includes(`'${chave}'`)) faltando.push(chave);
    }
    expect(faltando, `chaves sem pendência no banco: ${faltando.join(", ")}`).toEqual([]);
  });

  it("aparece no painel acima das pendências", () => {
    const dash = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
    expect(dash.indexOf("<ResumoDoDia />")).toBeGreaterThan(0);
    expect(dash.indexOf("<ResumoDoDia />")).toBeLessThan(dash.indexOf("<PendenciasDoMeuPapel />"));
  });
});
