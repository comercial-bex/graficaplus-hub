import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BarraDeMeta } from "../src/components/metas/barra-de-meta";
import { foco, marcos, nivelParaComemorar, nomeDoMes, posicaoNaBarra, type MetaDoMes } from "../src/domain/metas/progresso";

/**
 * Meta de vendas com Ouro (1% da OS) e Diamante (2,5%), pedida pelo dono em
 * 21/10/2026: Jhesselem R$ 20 mil, Fernando e Leonardo R$ 10 mil. A regra do
 * nível mora no banco (ensaiada em transação com rollback contra os dados
 * reais); aqui ficam o desenho da barra, as frases e o contrato da migração.
 */

const base: MetaDoMes = {
  meta_id: "m", usuario_id: "u", mes: "2026-10-01",
  meta: 10000, ouro_em: 10000, diamante_em: 15000,
  pct_ouro: 1, pct_diamante: 2.5, diamante_em_pct: 150,
  vendido: 0, pago: 0, os_vendidas: 0,
  nivel: "nenhum", pct_atual: 0, comissao_atual: 0,
  nivel_se_receber: "nenhum", comissao_se_receber: 0,
  proximo_nivel: "ouro", falta_proximo: 10000, ritmo_por_dia_util: 1250,
  dias_uteis_restantes: 8, dias_uteis_total: 22, projecao_vendido: null,
  fechada: false, nivel_fechado: null, pct_fechado: null, comemorado_nivel: "nenhum",
};
const com = (p: Partial<MetaDoMes>): MetaDoMes => ({ ...base, ...p });

describe("a barra vai do zero ao Diamante", () => {
  it("o Ouro fica a dois terços e o Diamante no fim", () => {
    const m = marcos(base);
    expect(m.find((x) => x.chave === "ouro")!.posicao).toBeCloseTo(66.67, 1);
    expect(m.find((x) => x.chave === "diamante")!.posicao).toBe(100);
    expect(m.map((x) => x.chave)).toEqual(["50", "75", "ouro", "diamante"]);
  });

  it("nunca passa de 100% nem fica negativa", () => {
    expect(posicaoNaBarra(99999, base)).toBe(100);
    expect(posicaoNaBarra(-5, base)).toBe(0);
    expect(posicaoNaBarra(5, { diamante_em: 0 })).toBe(0);
  });

  it("marco atingido é pelo PAGO, não pelo vendido", () => {
    const m = marcos(com({ vendido: 12000, pago: 5000 }));
    expect(m.find((x) => x.chave === "50")!.atingido).toBe(true);
    expect(m.find((x) => x.chave === "75")!.atingido).toBe(false);
    expect(m.find((x) => x.chave === "ouro")!.atingido).toBe(false);
  });
});

describe("a frase de foco", () => {
  it("sem nível: diz quanto falta para o Ouro", () => {
    expect(foco(base).titulo).toMatch(/Faltam .*10\.000.* para o Ouro/);
    expect(foco(base).tom).toBe("neutro");
  });

  it("vendido que ainda não foi pago vira lembrete de cobrança, não de venda", () => {
    const f = foco(com({ vendido: 3000, pago: 1000, falta_proximo: 9000 }));
    expect(f.detalhe).toMatch(/aguardam pagamento/);
  });

  it("se o vendido pago já fecha o Ouro, a frase promete o valor", () => {
    const f = foco(com({ vendido: 11000, pago: 4000, nivel_se_receber: "ouro", comissao_se_receber: 110 }));
    expect(f.detalhe).toMatch(/fecha o Ouro/);
    expect(f.detalhe).toMatch(/110,00/);
  });

  it("Ouro: mostra o que falta para o Diamante e o percentual maior", () => {
    const f = foco(com({ nivel: "ouro", pago: 10500, pct_atual: 1, comissao_atual: 105, proximo_nivel: "diamante", falta_proximo: 4500 }));
    expect(f.tom).toBe("ouro");
    expect(f.titulo).toMatch(/4\.500.*Diamante/);
    expect(f.detalhe).toMatch(/2,5%/);
  });

  it("Diamante: sem próximo degrau", () => {
    const f = foco(com({ nivel: "diamante", pago: 16000, pct_atual: 2.5, comissao_atual: 400, proximo_nivel: null, falta_proximo: 0 }));
    expect(f.tom).toBe("diamante");
    expect(f.detalhe).toMatch(/400,00/);
  });
});

describe("a comemoração acontece uma vez por nível", () => {
  it("Ouro novo comemora; já comemorado não repete", () => {
    expect(nivelParaComemorar(com({ nivel: "ouro", comemorado_nivel: "nenhum" }))).toBe("ouro");
    expect(nivelParaComemorar(com({ nivel: "ouro", comemorado_nivel: "ouro" }))).toBeNull();
  });
  it("subir de Ouro para Diamante comemora de novo, uma vez", () => {
    expect(nivelParaComemorar(com({ nivel: "diamante", comemorado_nivel: "ouro" }))).toBe("diamante");
    expect(nivelParaComemorar(com({ nivel: "diamante", comemorado_nivel: "diamante" }))).toBeNull();
  });
  it("sem nível não há o que comemorar", () => {
    expect(nivelParaComemorar(base)).toBeNull();
  });
});

describe("nome do mês sem passar por Date (fuso)", () => {
  it("2026-10-01 é outubro, não setembro", () => {
    expect(nomeDoMes("2026-10-01")).toBe("outubro de 2026");
    expect(nomeDoMes("2026-01-01")).toBe("janeiro de 2026");
  });
});

describe("a barra desenhada", () => {
  it("mostra as duas camadas e os quatro marcos, com Ouro marcado quando pago", () => {
    const html = renderToStaticMarkup(
      createElement(BarraDeMeta, { meta: com({ vendido: 14000, pago: 10500, nivel: "ouro" }) }),
    );
    expect(html).toContain('aria-valuenow="105"');
    expect(html).toContain("width:70%"); // pago 10.500 de 15.000
    expect(html).toContain("width:93.33");
    expect(html).toContain("✓ Ouro");
    expect(html).not.toContain("✓ Diamante");
    expect(html).toContain("Diamante");
  });
});

describe("a migração", () => {
  const sql = readFileSync("supabase/migrations/20261021120000_meta_de_vendas_ouro_e_diamante.sql", "utf8");

  it("a tabela só é lida pelo próprio, gestão e financeiro, e ninguém escreve direto", () => {
    expect(sql).toContain("ALTER TABLE public.metas_vendas ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/CREATE POLICY "meta: leitura" ON public\.metas_vendas FOR SELECT/);
    expect(sql).not.toMatch(/ON public\.metas_vendas FOR (INSERT|UPDATE|DELETE|ALL)/);
  });

  it("o nível sai do PAGO e o diamante vale a partir de diamante_em_pct", () => {
    expect(sql).toContain("WHEN p_pago >= p_meta * p_diamante_em / 100 THEN 'diamante'");
    expect(sql).toContain("WHEN p_pago >= p_meta THEN 'ouro'");
  });

  it("o mês é o de São Paulo, não o do servidor em UTC", () => {
    expect(sql.match(/AT TIME ZONE 'America\/Sao_Paulo'/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("fechar lança em `comissoes` sem duplicar OS e só depois do mês acabar", () => {
    expect(sql).toContain("ON CONFLICT (os_id) DO NOTHING");
    expect(sql).toContain("O mês só fecha depois de terminar");
  });

  it("definir é só da gestão; o financeiro pode fechar", () => {
    const definir = sql.slice(sql.indexOf("FUNCTION public.meta_definir"), sql.indexOf("FUNCTION public.meta_fechar_mes"));
    expect(definir).toContain("has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor')");
    expect(definir).not.toContain("pagamentos.confirm");
    expect(sql.slice(sql.indexOf("FUNCTION public.meta_fechar_mes"))).toContain("pagamentos.confirm");
  });

  it("nenhuma função fica aberta para anon, e os ajudantes internos nem para authenticated", () => {
    for (const f of ["minha_meta()", "meta_painel(date)", "meta_comemorada(text)", "meta_definir(uuid,date,numeric,numeric,numeric,numeric)", "meta_fechar_mes(date)"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO authenticated;`);
    }
    expect(sql).toContain("tg_meta_montar(public.metas_vendas) FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("tg_meta_realizado(uuid,date) FROM PUBLIC, anon, authenticated");
  });

  it("as metas combinadas: 20 mil, 10 mil e 10 mil", () => {
    expect(sql).toContain("('medeirosketellem@gmail.com', 20000)");
    expect(sql).toContain("('fa6937895@gmail.com', 10000)");
    expect(sql).toContain("('leolpmalmeida@gmail.com', 10000)");
    expect(sql).toMatch(/DEFAULT 1 CHECK/);
    expect(sql).toMatch(/pct_diamante numeric NOT NULL DEFAULT 2\.5/);
  });
});

describe("as telas", () => {
  it("a barra tem papel de progressbar, texto nos marcos e fonte mínima de 11 px", () => {
    const b = readFileSync("src/components/metas/barra-de-meta.tsx", "utf8");
    expect(b).toContain('role="progressbar"');
    expect(b).toContain("aria-valuetext");
    expect(b).not.toMatch(/text-\[(8|9|10)px\]/);
  });

  it("a meta aparece no painel do vendedor e do operador, o placar só no financeiro", () => {
    expect(readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8")).toContain("<MinhaMeta />");
    expect(readFileSync("src/components/painel/PainelProducao.tsx", "utf8")).toContain("<MinhaMeta />");
    expect(readFileSync("src/routes/_authenticated/financeiro.tsx", "utf8")).toContain("<MetasPanel />");
  });

  it("a comemoração é gravada no banco, não no navegador", () => {
    const c = readFileSync("src/components/metas/minha-meta.tsx", "utf8");
    expect(c).toContain('"meta_comemorada"');
    expect(c).not.toMatch(/localStorage|sessionStorage/);
  });
});
