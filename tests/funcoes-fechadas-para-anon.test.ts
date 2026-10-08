import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Doze funções SECURITY DEFINER que gravam tinham EXECUTE para `anon` — a
 * chave pública do aplicativo. Fechadas em 08/10/2026 (migração
 * 20261008040000, aplicada; guarda do fim do arquivo voltou vazia).
 */
const MIGRACAO = readFileSync(
  "supabase/migrations/20261008040000_funcoes_que_gravam_fechadas_para_anon.sql",
  "utf8",
);

const FECHADAS = [
  "aplicar_custo_hora_sugerido(uuid)",
  "avisar_manualmente(uuid, text)",
  "buscar_usuario_para_portal(text)",
  "cancelar_aviso(uuid, text)",
  "cancelar_avisos_orfaos()",
  "concluir_tarefa_os(uuid, boolean)",
  "criar_link_aprovacao(uuid, integer)",
  "marcar_lead_perdido(uuid, text)",
  "recalcular_previsao_custos(uuid)",
  "receber_item_compra(uuid, numeric, numeric, text)",
  "registrar_inspecao(uuid, text, jsonb, jsonb, text, uuid, uuid)",
  "vincular_usuario_ao_portal(uuid, uuid)",
];

describe("funções que gravam, fechadas para anon", () => {
  it("as doze estão na lista do REVOKE", () => {
    for (const f of FECHADAS) expect(MIGRACAO).toContain(`'public.${f}'`);
  });

  it("tira de PUBLIC e anon, devolve explicitamente a authenticated", () => {
    expect(MIGRACAO).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon");
    expect(MIGRACAO).toContain("GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role");
  });

  it("confere com has_function_privilege, porque o REVOKE não reclama", () => {
    expect(MIGRACAO).toMatch(/IF has_function_privilege\('anon', v_funcao, 'EXECUTE'\) THEN\s+RAISE EXCEPTION/);
    expect(MIGRACAO).toMatch(/IF NOT has_function_privilege\('authenticated', v_funcao, 'EXECUTE'\) THEN\s+RAISE EXCEPTION/);
  });

  it("o portal sem login continua aberto (aprovação por link e convite de parceiro)", () => {
    const lista = MIGRACAO.slice(MIGRACAO.indexOf("FOREACH"), MIGRACAO.indexOf("]::regprocedure[]"));
    for (const publica of [
      "abrir_aprovacao",
      "registrar_decisao_aprovacao",
      "arquivo_em_aprovacao_aberta",
      "convite_de_parceiro",
      "parceiro_cadastrar_por_convite",
    ]) {
      expect(lista).not.toContain(publica);
    }
  });
});
