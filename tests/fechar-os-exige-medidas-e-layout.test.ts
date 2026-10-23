import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { rotuloBloqueio, traduzirBloqueios } from "../src/domain/os/etapas";

/**
 * Fechar a OS exige medidas e layout (22/10/2026, regra do dono). Ensaio com
 * rollback, chamando fechar_os nas 9 OS abertas como o dono: a #164 só seria
 * barrada pela regra nova — antes dela, fecharia sem arquivo nenhum.
 */

const SQL = readFileSync("supabase/migrations/20261022193000_fechar_os_exige_medidas_e_layout.sql", "utf8");

describe("fechar_os pergunta o que foi feito", () => {
  it("layout: um arquivo da OS marcado como final de produção", () => {
    expect(SQL).toContain("a.os_id = fechar_os.os_id AND a.final_producao = true");
    expect(SQL).toContain(`''"sem_layout"''::jsonb`);
  });

  it("medidas: todo item com largura × altura, menos os de serviço", () => {
    expect(SQL).toContain("(COALESCE(i.largura, 0) <= 0 OR COALESCE(i.altura, 0) <= 0)");
    expect(SQL).toContain("COALESCE(pr.tipo::text, ''produto'') <> ''servico''");
    expect(SQL).toContain(`''"sem_medidas"''::jsonb`);
  });

  it("OS de impressão 3D fica fora (o modelo aprovado é o layout)", () => {
    expect(SQL).toContain("IF NOT public.os_e_impressao_3d(fechar_os.os_id");
  });

  it("edição ancorada no corpo vivo: âncora fora do esperado para a migração", () => {
    expect(SQL).toContain("IF n <> 1 THEN");
  });
});

describe("a tela diz o que falta em português", () => {
  it("os dois códigos novos têm texto", () => {
    expect(rotuloBloqueio("sem_layout")).toContain("layout final");
    expect(rotuloBloqueio("sem_medidas")).toContain("largura × altura");
  });

  it("a recusa do Kanban vira frase, não código", () => {
    expect(traduzirBloqueios("A OS não pode fechar ainda: sem_layout; sem_medidas.")).toBe(
      `${rotuloBloqueio("sem_layout")} · ${rotuloBloqueio("sem_medidas")}`,
    );
  });
});

describe("dados de 22/10 (decisões do dono)", () => {
  const DADOS = readFileSync("supabase/migrations/20261022190000_dados_convertidos_e_perda_os_164.sql", "utf8");
  it("os 9 orçamentos com OS viram convertidos — só os que estão em aprovado e têm OS", () => {
    expect(DADOS).toContain("WHERE os_id IS NOT NULL AND status = 'aprovado'");
  });
  it("a lona presa da #164 entra como perda e a reserva é liberada, sem apagar nada", () => {
    expect(DADOS).toContain("INSERT INTO public.os_perdas");
    expect(DADOS).toContain("status = 'baixada'");
    expect(DADOS).not.toMatch(/\bDELETE\b/i);
  });
});

describe("a OS não nasce com item livre de custo zero", () => {
  const CONV = readFileSync("supabase/migrations/20261022194500_converter_exige_custo_do_item_livre.sql", "utf8");
  it("a trava fica na conversão, antes de criar a OS (não gasta número)", () => {
    expect(CONV).toContain("i.produto_id IS NULL AND COALESCE(i.custo_unitario, 0) <= 0");
    expect(CONV).toContain("Item fora do catálogo sem custo");
    // O texto novo é posto ANTES do trecho que cria o cliente e a OS (`... || v_de`).
    expect(CONV).toContain("|| v_de;");
    expect(CONV).toContain("v_para text := E'  -- (b2)");
  });
  it("edição ancorada no corpo vivo", () => {
    expect(CONV).toContain("IF n <> 1 THEN");
  });
});
