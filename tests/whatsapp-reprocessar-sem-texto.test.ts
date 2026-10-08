import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * "Reprocessar mensagens sem texto" (Monitor do WhatsApp) chamava uma função
 * que o Postgres recusava (42P10: o alvo do UPDATE citado num LATERAL do FROM)
 * — o botão nunca corrigiu nada. Conferido e consertado em 08/10/2026
 * (migração 20261008030000, aplicada; md5 do corpo igual ao arquivo).
 */
const MIGRACAO = readFileSync("supabase/migrations/20261008030000_whatsapp_reprocessar_sem_texto.sql", "utf8");
const CORPO = /\$\$([\s\S]*?)\$\$/.exec(MIGRACAO)?.[1] ?? "";

describe("whatsapp_reprocessar_sistema, consertada", () => {
  it("o UPDATE das conversas não cita a própria tabela num LATERAL", () => {
    expect(CORPO).not.toMatch(/FROM\s+LATERAL/i);
    expect(CORPO).toMatch(/SELECT DISTINCT ON \(m\.conversa_id\)/);
    expect(CORPO).toMatch(/WHERE x\.conversa_id = c\.id AND c\.ultima_mensagem = '\[sistema\]'/);
  });

  it("modelo de empresa recuperado vira 'automacao' (não é cliente)", () => {
    expect(CORPO).toMatch(/origem = CASE WHEN v_modelo THEN 'automacao' ELSE origem END/);
  });

  it("continua só do servidor: REVOKE de PUBLIC, anon e authenticated", () => {
    expect(MIGRACAO).toMatch(
      /REVOKE ALL ON FUNCTION public\.whatsapp_reprocessar_sistema\(\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(MIGRACAO).toMatch(/GRANT EXECUTE ON FUNCTION public\.whatsapp_reprocessar_sistema\(\) TO service_role;/);
  });
});
