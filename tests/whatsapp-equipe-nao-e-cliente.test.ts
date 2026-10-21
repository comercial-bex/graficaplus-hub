import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Mensagem da equipe não é cliente esperando resposta (21/10/2026). O painel
 * listava o Leonardo e a Jhessy — escrevendo do próprio celular para o número
 * da empresa — entre os "Clientes esperando resposta no WhatsApp". Aplicado
 * depois de ensaio com rollback: a mensagem simulada do Leonardo entrou na
 * conversa sem abrir atendimento nem marcar espera; a da YRLEN marcou espera e
 * abriu atendimento como sempre; 0 aviso e 0 envio. Depois de aplicar, o painel
 * do dono mostra só a Griff Móveis.
 */

const SQL = readFileSync("supabase/migrations/20261021170000_whatsapp_equipe_nao_e_cliente_esperando.sql", "utf8");

describe("quem é da equipe", () => {
  it("só usuário ativo com telefone, comparado pelo número normalizado", () => {
    expect(SQL).toContain("WHERE u.ativo IS NOT FALSE");
    expect(SQL).toContain("coalesce(btrim(u.telefone), '') <> ''");
    expect(SQL).toContain("public.normalize_whatsapp_phone(u.telefone) = p_telefone_normalizado");
  });

  it("a função não fica exposta ao navegador", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public._wa_telefone_da_equipe(text) FROM PUBLIC, anon, authenticated;");
  });
});

describe("a mensagem que chega", () => {
  it("da equipe: entra na conversa, mas não abre atendimento nem marca espera", () => {
    const ramo = SQL.slice(SQL.indexOf("IF public._wa_telefone_da_equipe(c.telefone_normalizado) THEN"), SQL.indexOf("ELSE\\n"));
    expect(ramo).toContain("v_at := c.atendimento_ativo_id;");
    expect(ramo).not.toContain("_wa_abrir_atendimento");
    expect(ramo).not.toContain("aguardando_desde");
  });

  it("de cliente: as duas linhas de antes, sem mudança", () => {
    const senao = SQL.slice(SQL.indexOf("ELSE\\n"), SQL.indexOf("END IF;\\n"));
    expect(senao).toContain("v_at := coalesce(c.atendimento_ativo_id, public._wa_abrir_atendimento(c.id, ''mensagem_recebida'', NULL));");
    expect(senao).toContain("UPDATE public.whatsapp_conversas SET aguardando_desde = coalesce(aguardando_desde, v_quando) WHERE id = c.id;");
  });
});

describe("a pendência do painel", () => {
  it("também ignora a equipe (a transferência de fila marca espera por outro caminho)", () => {
    expect(SQL).toContain("AND NOT public._wa_telefone_da_equipe(c.telefone_normalizado)");
  });

  it("as duas edições são ancoradas no corpo vivo: âncora fora do esperado para a migração", () => {
    expect(SQL.match(/IF n <> 1 THEN/g)).toHaveLength(2);
  });

  it("as conversas da equipe que estavam esperando são só desmarcadas, nada apagado", () => {
    expect(SQL).not.toMatch(/\bDELETE\b/i);
    expect(SQL).toContain("SET aguardando_desde = NULL");
  });
});
