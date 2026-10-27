import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HORAS_DO_MES_DA_CASA,
  SALARIO_MINIMO,
  custoDaHora,
  parcelasDoRegime,
  somarEncargos,
} from "../src/domain/financeiro/encargos";

const ler = (caminho: string) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const migracao = ler("supabase/migrations/20261027500000_mao_de_obra_pelo_salario_minimo_e_pendencias.sql");
const tela = ler("src/routes/_authenticated/custos-producao.tsx");
const cliente = ler("src/routes/_authenticated/clientes.$id.tsx");

describe("mão de obra pelo salário mínimo (27/10/2026)", () => {
  it("a conta do dono: salário mínimo ÷ (8 h × 22 dias) com os encargos do Simples dá R$ 12,17 a hora", () => {
    expect(HORAS_DO_MES_DA_CASA).toBe(8 * 22);
    const r = custoDaHora({ salarioMensal: SALARIO_MINIMO, encargosPct: somarEncargos(parcelasDoRegime("simples")) });
    expect(r.salarioHora).toBeCloseTo(9.21, 2);
    expect(r.custoHora).toBeCloseTo(12.17, 2);
  });

  it("a migração troca o R$ 40 do 3D e as 5 funções, e só mexe no que ainda é o valor provisório", () => {
    expect(migracao).toMatch(/mo_custo_hora_padrao = round\(1621\.0 \* 1\.3219 \/ 176, 2\)/);
    expect(migracao).toMatch(/WHERE mo_custo_hora_padrao = 40 AND COALESCE\(mo_encargos_pct, 0\) = 0/);
    expect(migracao).toMatch(/WHERE ativo AND custo_hora = 10\.65 AND COALESCE\(salario_mensal, 0\) = 0/);
    expect(migracao).toContain("'mao_de_obra_3d_40_por_hora'");
  });

  it("a parcela sem vencimento passa a vencer no prazo da OS, sem tocar a que já foi paga", () => {
    expect(migracao).toContain("tg_parcela_nasce_com_o_prazo_da_os");
    expect(migracao).toContain("tg_os_prazo_vira_vencimento");
    expect(migracao).toMatch(/p\.vencimento IS NULL AND p\.status <> 'paga'/);
  });

  it("o prazo padrão só é gravado onde ainda é verdadeiro (data futura)", () => {
    expect(migracao).toMatch(/somar_dias_uteis\(o\.created_at::date, 5\) >= \(now\(\) AT TIME ZONE 'America\/Belem'\)::date/);
  });

  it("a tela guarda salário e horas por função e calcula o custo/hora", () => {
    expect(tela).toContain("salario_mensal");
    expect(tela).toContain("custoHoraDoForm");
  });

  it("no cliente, a linha do orçamento abre os itens e permite anexar a arte", () => {
    expect(cliente).toContain("ItensDoOrcamentoDoCliente");
    expect(cliente).toContain("<DialogoDeLayouts");
    expect(cliente).toContain("Anexar arte");
  });
});
