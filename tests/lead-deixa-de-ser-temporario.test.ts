import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * O lead do WhatsApp nasce "temporário" e a marca saía de lugar nenhum (31/10/2026):
 * 27 de 27 leads marcados, 3 já ganhos, e o funil comercial mostrava zero. A
 * migração faz a marca sair pelos fatos: cliente, andamento (em atendimento,
 * orçamento, ganho) ou orçamento ligado ao lead. "Perdido" sozinho não qualifica.
 */

const DIR = "supabase/migrations";
const SQL = readFileSync(`${DIR}/20261101013000_lead_deixa_de_ser_temporario.sql`, "utf8");
const CODIGO = SQL.replace(/^\s*--.*$/gm, "");

/** Corpo de uma função da migração, de CREATE até o fim do bloco $function$. */
function corpo(nome: string): string {
  const inicio = CODIGO.indexOf(`FUNCTION public.${nome}`);
  expect(inicio, `${nome} não está na migração`).toBeGreaterThan(-1);
  return CODIGO.slice(inicio, CODIGO.indexOf("END $function$", inicio));
}

/** Última migração que cria a função (CREATE, não só GRANT ou REVOKE). */
function ultimaQueCria(funcao: string): string {
  const cria = new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${funcao}\\b`, "i");
  const achadas = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => cria.test(readFileSync(`${DIR}/${f}`, "utf8")));
  expect(achadas.length, `nenhuma migração cria ${funcao}`).toBeGreaterThan(0);
  return readFileSync(`${DIR}/${achadas[achadas.length - 1]}`, "utf8");
}

describe("a marca de temporário sai pelos fatos", () => {
  it("o lead que ganha cliente ou sai de 'novo' para atendimento, orçamento ou ganho deixa de ser temporário", () => {
    const f = corpo("tg_lead_deixa_de_ser_temporario");
    expect(f).toContain("NEW.temporario IS TRUE");
    expect(f).toContain("NEW.cliente_id IS NOT NULL");
    expect(f).toContain("NEW.status IN ('em_atendimento', 'orcamento', 'ganho')");
    expect(f).toContain("NEW.temporario := false");
    expect(CODIGO).toMatch(/CREATE TRIGGER tg_leads_deixa_de_ser_temporario\s+BEFORE UPDATE ON public\.leads/);
  });

  it("'perdido' sozinho não qualifica, nem no gatilho nem na correção dos dados antigos", () => {
    expect(corpo("tg_lead_deixa_de_ser_temporario")).not.toContain("perdido");
    const correcao = CODIGO.slice(CODIGO.indexOf("UPDATE public.leads l"), CODIGO.indexOf("ALTER TABLE public.leads ENABLE"));
    expect(correcao).toContain("l.status IN ('em_atendimento', 'orcamento', 'ganho')");
    expect(correcao).not.toContain("perdido");
  });

  it("os estados que qualificam existem na tela de leads", () => {
    const tela = readFileSync("src/routes/_authenticated/leads.tsx", "utf8");
    expect(tela).toContain('valor: "em_atendimento"');
    expect(tela).toContain('valor: "orcamento"');
  });

  it("orçamento ligado ao lead também qualifica, e o gatilho roda com a força do dono (quem orça nem sempre edita lead)", () => {
    const f = corpo("tg_orcamento_qualifica_lead");
    expect(f).toContain("SECURITY DEFINER");
    expect(f).toContain("SET temporario = false");
    expect(f).toContain("temporario IS TRUE");
    expect(CODIGO).toMatch(/AFTER INSERT OR UPDATE OF lead_id ON public\.orcamentos/);
  });

  it("função de gatilho não é para ninguém chamar", () => {
    for (const nome of ["tg_lead_deixa_de_ser_temporario", "tg_orcamento_qualifica_lead"]) {
      expect(CODIGO).toContain(`REVOKE ALL ON FUNCTION public.${nome}() FROM PUBLIC, anon, authenticated;`);
    }
  });

  it("os dados antigos são corrigidos sem apagar nada e sem rejuvenescer o lead (updated_at)", () => {
    const desliga = CODIGO.indexOf("ALTER TABLE public.leads DISABLE TRIGGER tg_leads_updated");
    const corrige = CODIGO.indexOf("UPDATE public.leads l");
    const religa = CODIGO.indexOf("ALTER TABLE public.leads ENABLE TRIGGER tg_leads_updated");
    expect(desliga).toBeGreaterThan(-1);
    expect(corrige).toBeGreaterThan(desliga);
    expect(religa).toBeGreaterThan(corrige);
    expect(CODIGO).not.toMatch(/\bDELETE\b/i);
  });
});

describe("o que depende dessa marca", () => {
  it("o funil comercial continua escondendo os temporários, por isso a marca precisa sair", () => {
    const funil = ultimaQueCria("funil_comercial");
    expect(funil).toMatch(/coalesce\(l\.temporario,\s*false\)\s*=\s*false/i);
  });
});
