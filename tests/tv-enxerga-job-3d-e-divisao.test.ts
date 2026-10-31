import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261030910000_tv_enxerga_job_3d_e_os_3d_divide_entre_impressoras.sql",
  "utf8",
);
const ficha = readFileSync("src/components/kanban/ficha-da-os.tsx", "utf8");
const pagina = readFileSync("src/routes/_authenticated/producao-3d.tsx", "utf8");

describe("TV enxerga o job 3D e a OS 3D se divide entre as impressoras (30/10/2026)", () => {
  it("a parede põe a OS na impressora do job aberto e a tira de 'sem máquina'", () => {
    expect(sql).toContain("jobs3d as (");
    expect(sql).toMatch(/j\.status in \(''planejado'', ''aguardando_material'', ''em_impressao'', ''pausado''\)/);
    expect(sql).toContain("not exists (select 1 from jobs3d y where y.os_id = x.os_id)");
    // a origem reaproveita um valor que o contrato da TV já aceita
    expect(sql).toContain("select ''maquina_id'', y.maquina_id, y.os_id");
  });

  it("a criação reparte as rodadas na impressora menos carregada e recusa acima de 300", () => {
    expect(sql).toContain("if v_n > 300 then");
    expect(sql).toContain("v_carga[v_k] < v_carga[v_pos]");
    expect(sql).toContain("(v_n > 1 or v_maq is null)");
  });

  it("repartir de novo só mexe em job planejado e sem horário na agenda", () => {
    expect(sql).toContain("j.os_id = p_os_id and j.status = 'planejado' and j.agenda_id is null");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.redistribuir_jobs_3d_da_os\(uuid, uuid\[\]\) FROM PUBLIC, anon/);
  });

  it("a ficha do quadro anexa o arquivo, e a tela 3D tem o simulador e o botão de repartir", () => {
    expect(ficha).toContain("AnexarArquivoRapido");
    expect(pagina).toContain("UsoDasImpressoras");
  });
});
