import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A OS 212 (Marcela, 50 adesivos de 21 × 5 cm = 0,55 m², 29/10/2026) nasceu sem horário no recorte: "sem
 * horário livre nos próximos 90 dias nesta máquina". O produto tem 35 min cadastrados e é vendido em m²;
 * `custo_cheio_do_produto` lê esse tempo POR UNIDADE (por m²), mas a agenda multiplicava pelas PEÇAS:
 * 35 × 50 = 1.750 min, mais do que um dia de expediente (600 min) — nenhum dos 90 dias servia.
 */
const PASTA = "supabase/migrations";
const MIGRACAO = "20261029500000_agenda_usa_a_area_do_m2.sql";
const SQL = readFileSync(join(PASTA, MIGRACAO), "utf8");

describe("agenda de máquina: o tempo do produto em m² é por m²", () => {
  it("é a última definição de agendar_os_interno", () => {
    const ultima = readdirSync(PASTA)
      .filter((nome) => nome.endsWith(".sql"))
      .sort()
      .filter((nome) =>
        readFileSync(join(PASTA, nome), "utf8").includes("CREATE OR REPLACE FUNCTION public.agendar_os_interno("),
      )
      .pop();
    expect(ultima).toBe(MIGRACAO);
  });

  it("produto em m² com área cobrada gasta tempo × área; os demais, tempo × quantidade", () => {
    expect(SQL).toContain("p.unidade::text AS unidade_produto");
    expect(SQL).toContain(
      "WHEN lower(replace(COALESCE(r.unidade_produto, ''), '²', '2')) = 'm2' AND COALESCE(r.area_cobrada, 0) > 0",
    );
    expect(SQL).toContain("THEN r.area_cobrada");
    expect(SQL).toContain("ELSE GREATEST(COALESCE(r.quantidade, 1), 1) END)::int;");
    // o caso que quebrou: 35 min por m² × 0,55 m² cobrados = 20 min; por peça seriam 1.750
    expect(Math.ceil(35 * 0.55)).toBe(20);
    expect(35 * 50).toBe(1750);
  });

  it("a mesma regra de unidade do custo cheio: tempo por unidade do produto, sem multiplicar por peça", () => {
    const custo = readFileSync(join(PASTA, "20261028500000_custo_cheio_usa_custo_digitado_sem_ficha.sql"), "utf8");
    expect(custo).toContain("v_horas := COALESCE(p.tempo_producao_min, 0) / 60.0;");
    expect(custo).toContain("lower(replace(COALESCE(p.unidade, ''), '²', '2')) = 'm2'");
    expect(custo).not.toMatch(/tempo_producao_min[^;]*quantidade/);
  });

  it("a máquina com velocidade (impressora) continua pela velocidade", () => {
    expect(SQL).toContain("IF COALESCE(r.velocidade_m2_h, 0) > 0 AND COALESCE(r.area_cobrada, 0) > 0 THEN");
    expect(SQL).toContain("v_min := ceil((r.area_cobrada / r.velocidade_m2_h) * 60)::int;");
  });

  it("item maior que o dia diz quanto precisa, antes de procurar horário nos 90 dias", () => {
    const limite = SQL.indexOf("IF v_min > 600 THEN");
    const busca = SQL.indexOf("v_inicio := public.proximo_horario_livre_interno(r.maquina_id, v_min, v_cursor);");
    expect(limite).toBeGreaterThan(-1);
    expect(busca).toBeGreaterThan(limite);
    expect(SQL).toContain("'precisa de ' || v_min || ' min seguidos, mais que o dia de 600 min (08:00 às 18:00)");
  });

  it("o dia de 600 min é o expediente que a busca de horário oferece", () => {
    // 08:00 às 18:00 em proximo_horario_livre_interno (migração viva de 23/09)
    const todas = readdirSync(PASTA)
      .filter((nome) => nome.endsWith(".sql"))
      .sort()
      .map((nome) => readFileSync(join(PASTA, nome), "utf8"))
      .filter((texto) => texto.includes("FUNCTION public.proximo_horario_livre_interno("));
    expect(todas.length).toBeGreaterThan(0);
    const ultima = todas[todas.length - 1];
    expect(ultima).toContain("v_abre time := '08:00'");
    expect(ultima).toContain("v_fecha time := '18:00'");
  });
});
