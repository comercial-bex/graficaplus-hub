import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BANCO da cobrança de orçamento no grupo: as três migrações lidas como texto.
 *
 * O que estas travas seguram:
 *  - o modo nasce desligado e nada no arquivo liga;
 *  - o histórico é só leitura para a equipe e fechado ao anônimo;
 *  - as funções novas são só do service_role (o navegador nunca as chama);
 *  - a função que registra não recebe destino: só o grupo da equipe, pela função do banco;
 *  - o aviso de cliente novo muda só o link;
 *  - o chat_lid é preenchido pelo telefone normalizado, sem tocar em mensagem.
 */

const PASTA = join(__dirname, "..", "supabase/migrations");
const ler = (nome: string) => readFileSync(join(PASTA, nome), "utf8");

/** Tira os comentários `--` para que explicar algo num comentário não passe nem reprove. */
const semComentarios = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const COBRANCA = semComentarios(ler("20261112110000_cobranca_de_orcamento_no_grupo.sql"));
const AVISO_BRUTO = ler("20261112120000_aviso_do_grupo_abre_a_conversa.sql");
const AVISO = semComentarios(AVISO_BRUTO);
const LID = semComentarios(ler("20261112130000_chat_lid_das_conversas.sql"));
const AVISO_ANTIGO = semComentarios(ler("20261110100000_aviso_no_grupo_da_equipe.sql"));

/** Corpo de `CREATE OR REPLACE FUNCTION public.<nome>(` até o `$function$;` que fecha. */
function corpoDa(sql: string, nome: string): string {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(inicio, `a função ${nome} não está na migração`).toBeGreaterThanOrEqual(0);
  const fim = sql.indexOf("$function$;", inicio);
  expect(fim).toBeGreaterThan(inicio);
  return sql.slice(inicio, fim + "$function$;".length);
}

function fechadaSoParaOServico(sql: string, nome: string, assinatura: string) {
  const corpo = corpoDa(sql, nome);
  expect(corpo, `${nome} sem SECURITY DEFINER`).toMatch(/\bSECURITY DEFINER\b/);
  expect(corpo, `${nome} sem SET search_path = public`).toMatch(/SET search_path = public\b/);
  expect(sql).toContain(
    `REVOKE ALL ON FUNCTION public.${nome}(${assinatura}) FROM PUBLIC, anon, authenticated;`,
  );
  expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${nome}(${assinatura}) TO service_role;`);
  // Nenhum GRANT da função para quem não é o servidor.
  const grants = [
    ...sql.matchAll(new RegExp(`GRANT[^;]*FUNCTION\\s+public\\.${nome}\\b[^;]*\\bTO\\s+([^;]+);`, "gi")),
  ].map((m) => m[1].trim());
  expect(grants).toEqual(["service_role"]);
}

describe("20261112110000: banco da cobrança e o job", () => {
  it("cobranca_modo nasce 'desligada' e nenhum UPDATE liga", () => {
    expect(COBRANCA).toContain("ADD COLUMN IF NOT EXISTS cobranca_modo text NOT NULL DEFAULT 'desligada'");
    expect(COBRANCA).toContain("CHECK (cobranca_modo IN ('desligada', 'ensaio', 'ligada'))");
    // Fora da função de salvar (que só a tela chama, com permissão), nada grava o modo.
    // (a função de gravar a rodada só mexe nas colunas cobranca_rodada_*.)
    const foraDoSalvar = COBRANCA.replace(corpoDa(COBRANCA, "whatsapp_cobranca_salvar"), "").replace(
      corpoDa(COBRANCA, "whatsapp_cobranca_rodada_gravar"),
      "",
    );
    expect(foraDoSalvar).not.toMatch(/\bSET\s+cobranca_modo\b/i);
    expect(foraDoSalvar).not.toMatch(/cobranca_modo\s*=\s*'(ensaio|ligada)'/i);
    expect(foraDoSalvar).not.toMatch(/UPDATE\s+public\.whatsapp_configuracoes/i);
  });

  it("os três tempos com padrão e CHECK de 30 a 1440; sábado nasce desligado até as 12h", () => {
    expect(COBRANCA).toContain("cobranca_min_pedido integer NOT NULL DEFAULT 240");
    expect(COBRANCA).toContain("cobranca_min_orcamento integer NOT NULL DEFAULT 120");
    expect(COBRANCA).toContain("cobranca_min_gestor integer NOT NULL DEFAULT 240");
    for (const coluna of ["cobranca_min_pedido", "cobranca_min_orcamento", "cobranca_min_gestor"]) {
      expect(COBRANCA).toContain(`CHECK (${coluna} BETWEEN 30 AND 1440)`);
    }
    expect(COBRANCA).toContain("cobranca_sabado boolean NOT NULL DEFAULT false");
    expect(COBRANCA).toContain("cobranca_sabado_fim time NOT NULL DEFAULT '12:00'");
  });

  it("dispensa no atendimento com motivo fechado e coerente", () => {
    for (const coluna of [
      "pediu_orcamento_em timestamptz",
      "pediu_orcamento_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL",
      "orcamento_dispensado_em timestamptz",
      "orcamento_dispensado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL",
      "orcamento_dispensado_motivo text",
    ]) {
      expect(COBRANCA).toContain(`ADD COLUMN IF NOT EXISTS ${coluna}`);
    }
    expect(COBRANCA).toContain(
      "('enviado_por_fora', 'nao_e_orcamento', 'respondeu_preco_por_texto', 'cliente_desistiu')",
    );
    expect(COBRANCA).toContain("CHECK ((orcamento_dispensado_em IS NULL) = (orcamento_dispensado_motivo IS NULL))");
  });

  it("whatsapp_cobrancas: RLS ligada, REVOKE de anon por extenso, chave única (atendimento_id, nivel, modo)", () => {
    expect(COBRANCA).toContain("CREATE TABLE IF NOT EXISTS public.whatsapp_cobrancas");
    expect(COBRANCA).toContain("ALTER TABLE public.whatsapp_cobrancas ENABLE ROW LEVEL SECURITY;");
    expect(COBRANCA).toContain("REVOKE ALL ON TABLE public.whatsapp_cobrancas FROM anon;");
    // O padrão do schema dá arwdDxtm ao authenticated: tira TUDO (TRUNCATE, REFERENCES, TRIGGER,
    // MAINTAIN também) e devolve só o SELECT.
    expect(COBRANCA).toContain("REVOKE ALL ON TABLE public.whatsapp_cobrancas FROM authenticated;");
    expect(COBRANCA).toContain("GRANT SELECT ON TABLE public.whatsapp_cobrancas TO authenticated;");
    expect(COBRANCA).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_cobrancas_uma_por_nivel\s+ON public\.whatsapp_cobrancas \(atendimento_id, nivel, modo\);/,
    );
    // No modo ligada o destino não pode ser nulo: sem o IS NOT NULL o CHECK dá NULL e aceita.
    expect(COBRANCA).toContain(
      "CHECK (modo = 'ensaio' OR (destino IS NOT NULL AND destino ~ '^\\d{10,}-group$'))",
    );
    // Só admin e gestor leem (configuracoes.manage): o texto traz o "@número" de colegas e
    // usuarios.telefone é restrito a eles. Nenhuma política de escrita.
    expect(COBRANCA).toMatch(
      /FOR SELECT TO authenticated\s+USING \(public\.has_permission\(\(SELECT auth\.uid\(\)\), 'configuracoes\.manage'\)\)/,
    );
    expect(COBRANCA).not.toMatch(/FOR SELECT TO authenticated[^;]*'whatsapp\.read'/);
    // O histórico nunca guarda o telefone dos citados.
    expect(COBRANCA).toContain("c.value - 'mencao'");
    expect(COBRANCA).not.toMatch(/CREATE POLICY[^;]*whatsapp_cobrancas[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/i);
    expect(COBRANCA).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*whatsapp_cobrancas[^;]*TO[^;]*\b(anon|authenticated)\b/i);
  });

  it("funções SECURITY DEFINER com SET search_path = public, REVOKE ALL ... FROM PUBLIC, anon, authenticated e GRANT EXECUTE ... TO service_role", () => {
    fechadaSoParaOServico(COBRANCA, "whatsapp_cobranca_pendencias", "timestamptz");
    fechadaSoParaOServico(COBRANCA, "whatsapp_cobranca_equipe", "");
    fechadaSoParaOServico(COBRANCA, "whatsapp_cobranca_registrar", "text, jsonb, text, text[], boolean");
    fechadaSoParaOServico(COBRANCA, "whatsapp_cobranca_salvar", "uuid, jsonb");
    fechadaSoParaOServico(COBRANCA, "whatsapp_cobranca_rodada_gravar", "boolean, text, text");
  });

  it("o resultado da última rodada tem colunas e função própria; a pendência separa os dois responsáveis", () => {
    for (const coluna of ["cobranca_rodada_em timestamptz", "cobranca_rodada_ok boolean", "cobranca_rodada_parada text", "cobranca_rodada_erro text"]) {
      expect(COBRANCA).toContain(`ADD COLUMN IF NOT EXISTS ${coluna}`);
    }
    expect(COBRANCA).toContain("whatsapp_cobranca_rodada_gravar(p_ok boolean, p_parada text, p_erro text)");
    const pendencias = corpoDa(COBRANCA, "whatsapp_cobranca_pendencias");
    expect(pendencias).toContain("resp_atendimento_id uuid");
    expect(pendencias).toContain("resp_conversa_id uuid");
    expect(pendencias).not.toMatch(/COALESCE\(a\.responsavel_id, c\.responsavel_id\)/);
  });

  it("os parâmetros batem com tests/rpc-assinaturas.test.ts", () => {
    expect(COBRANCA).toContain("whatsapp_cobranca_pendencias(p_desde timestamptz)");
    expect(COBRANCA).toContain("whatsapp_cobranca_equipe()");
    expect(corpoDa(COBRANCA, "whatsapp_cobranca_registrar")).toMatch(
      /\(\s*p_modo text,\s*p_itens jsonb,\s*p_texto text,\s*p_mencionar text\[\],\s*p_agrupada boolean\s*\)/,
    );
    expect(COBRANCA).toContain("whatsapp_cobranca_salvar(p_usuario uuid, p_config jsonb)");
  });

  it("pendências só com sinal confiável: orçamento pela conversa, marca ou palavra estrita", () => {
    const corpo = corpoDa(COBRANCA, "whatsapp_cobranca_pendencias");
    expect(corpo).toContain("'(or[cç]amento|quanto custa|quanto fica|quanto sai|quanto seria|cota[cç][aã]o)'");
    // A palavra ampla (83 %) não entra.
    expect(corpo).not.toMatch(/\|valor\b|\|pre[cç]o\b/);
    expect(corpo).toContain("o.conversa_id = a.conversa_id");
    expect(corpo).toContain("a.pediu_orcamento_em");
    expect(corpo).toContain("LEAST(pal.em, a.pediu_orcamento_em, orc.primeiro) IS NOT NULL");
    expect(corpo).toContain("LEAST(pal.em, a.pediu_orcamento_em, orc.primeiro) >= p_desde");
    expect(corpo).toContain("p_desde IS NOT NULL");
    expect(corpo).toContain("a.fechado_em IS NULL");
    expect(corpo).toContain("a.origem_abertura::text <> 'manual'");
    expect(corpo).toContain("~* 'segue o or[cç]amento n'");
  });

  it("equipe citável: só ativo com papel de equipe", () => {
    const corpo = corpoDa(COBRANCA, "whatsapp_cobranca_equipe");
    expect(corpo).toContain("WHERE u.ativo AND public.is_staff(u.id)");
    expect(corpo).not.toContain("auth.uid()");
  });

  it("registrar não recebe destino: usa grupo_equipe_destino() e recusa o que não casa ^\\d{10,}-group$", () => {
    const corpo = corpoDa(COBRANCA, "whatsapp_cobranca_registrar");
    expect(corpo).not.toMatch(/p_destino|p_destinatario/);
    expect(corpo).toContain("v_grupo := public.grupo_equipe_destino();");
    expect(corpo).toContain(
      "IF p_modo = 'ligada' AND (v_grupo IS NULL OR v_grupo !~ '^\\d{10,}-group$') THEN",
    );
    expect(corpo).toContain("RAISE EXCEPTION 'cobrança recusada: o destino não é o grupo da equipe';");
    // O único enfileirar vai para v_grupo.
    const enfileira = [...corpo.matchAll(/enfileirar_notificacao\(\s*'whatsapp',\s*(\w+)/g)].map((m) => m[1]);
    expect(enfileira).toEqual(["v_grupo"]);
    // A trava vem antes de gravar.
    expect(corpo.indexOf("cobrança recusada")).toBeLessThan(corpo.indexOf("INSERT INTO public.whatsapp_cobrancas"));
    expect(corpo).toContain("pg_advisory_xact_lock(hashtext('whatsapp_cobranca_registrar'))");
    expect(corpo).toContain("'motivo', 'modo_mudou'");
    expect(corpo).toContain("'motivo', 'ja_registrada'");
    expect(corpo).toContain("x !~ '^\\d{12,13}$'");
  });

  it("idempotency_key 'cobranca_orcamento:' || atendimento || ':' || nivel", () => {
    const corpo = corpoDa(COBRANCA, "whatsapp_cobranca_registrar");
    expect(corpo).toContain(
      "v_chave := 'cobranca_orcamento:' || (p_itens->0->>'atendimento_id') || ':' || (p_itens->0->>'nivel');",
    );
    expect(corpo).toContain("'cobranca_orcamento:lista:'");
    // Chave repetida na fila derruba tudo (o INSERT volta junto).
    expect(corpo).toMatch(/IF v_fila IS NULL THEN[\s\S]*?RAISE EXCEPTION/);
    expect(corpo).toContain("jsonb_build_object('texto', p_texto, 'mencionar',");
  });

  it("salvar exige configuracoes.manage e só liga com o grupo da equipe ligado", () => {
    const corpo = corpoDa(COBRANCA, "whatsapp_cobranca_salvar");
    expect(corpo).toContain("NOT public.has_permission(p_usuario, 'configuracoes.manage')");
    expect(corpo).toContain("IF v_modo = 'ligada' AND public.grupo_equipe_destino() IS NULL THEN");
    expect(corpo).toMatch(/cobranca_ligada_em = CASE WHEN v_modo = 'ligada' AND v_atual\.cobranca_modo <> 'ligada'/);
    expect(corpo).toMatch(/cobranca_ensaio_desde = CASE WHEN v_modo = 'ensaio' AND v_atual\.cobranca_modo <> 'ensaio'/);
  });

  it("modelo cobranca_orcamento com {{texto}}; job whatsapp-cobrar */5 com o token do Vault", () => {
    expect(COBRANCA).toMatch(
      /SELECT 'cobranca_orcamento', 'whatsapp', '\{\{texto\}\}',[\s\S]*?WHERE NOT EXISTS \(SELECT 1 FROM public\.notificacao_templates WHERE evento = 'cobranca_orcamento'\)/,
    );
    expect(COBRANCA).toContain("PERFORM cron.unschedule('whatsapp-cobrar');");
    expect(COBRANCA).toMatch(/cron\.schedule\(\s*'whatsapp-cobrar',\s*'\*\/5 \* \* \* \*',/);
    expect(COBRANCA).toContain("url := 'https://bexprint.com.br/api/whatsapp/cobrar'");
    expect(COBRANCA).toContain(
      "'x-despachante-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'despachante_token')",
    );
    expect(COBRANCA).toContain(
      "IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'despachante_token') THEN",
    );
  });

  it("nenhuma das três usa current_date", () => {
    for (const sql of [COBRANCA, AVISO, LID]) expect(sql).not.toMatch(/\bcurrent_date\b/i);
  });
});

describe("20261112120000: link da conversa no aviso de cliente novo", () => {
  it("parte da definição viva e só troca o link por ?conversa=<id>", () => {
    const novo = corpoDa(AVISO, "tg_atendimento_avisa_grupo");
    expect(novo).toContain("Responder: https://bexprint.com.br/whatsapp?conversa=%s'");
    expect(novo).toMatch(/ELSE '🆕 Contato novo' END,\s*NEW\.conversa_id\);/);
    expect(novo).toContain("'grupo_equipe:atendimento:' || NEW.id");
    expect(novo).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);

    // Tirando as duas mudanças, o corpo é o da migração anterior (igual à definição viva de 12/11).
    const antigo = corpoDa(AVISO_ANTIGO, "tg_atendimento_avisa_grupo");
    const normalizar = (s: string) => s.replace(/\s+/g, " ").trim();
    const desfeito = novo
      .replace("whatsapp?conversa=%s'", "whatsapp'")
      .replace(/ELSE '🆕 Contato novo' END,\s*NEW\.conversa_id\);/, "ELSE '🆕 Contato novo' END);");
    expect(normalizar(desfeito)).toBe(normalizar(antigo));
  });

  it("o gatilho não é recriado e a função continua fechada", () => {
    expect(AVISO).not.toMatch(/CREATE TRIGGER|DROP TRIGGER/i);
    expect(AVISO).toContain("REVOKE ALL ON FUNCTION public.tg_atendimento_avisa_grupo() FROM PUBLIC, anon, authenticated;");
    expect(AVISO).not.toMatch(/\bGRANT\b/i);
  });
});

describe("20261112130000: chat_lid", () => {
  it("coluna chat_lid com índice único parcial; preenchida pelo telefone normalizado", () => {
    expect(LID).toContain("ADD COLUMN IF NOT EXISTS chat_lid text");
    expect(LID).toContain("CHECK (chat_lid ~ '^\\d{6,20}@lid$')");
    expect(LID).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversas_chat_lid_key\s+ON public\.whatsapp_conversas \(instancia_id, chat_lid\)\s+WHERE chat_lid IS NOT NULL;/,
    );
    expect(LID).toContain("public.normalize_whatsapp_phone(e.payload->>'phone')");
    expect(LID).toContain("FROM public.whatsapp_webhook_eventos e");
    expect(LID).toContain("COALESCE((e.payload->>'fromMe')::boolean, false) = false");
    expect(LID).toContain("COALESCE((e.payload->>'isGroup')::boolean, false) = false");
    expect(LID).toContain("HAVING count(DISTINCT tel) = 1");
    expect(LID).toContain("HAVING count(DISTINCT lid) = 1");
    expect(LID).toMatch(/AND c\.chat_lid IS NULL/);
  });

  it("o preenchimento não toca em mensagem nem cria conversa", () => {
    expect(LID).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+public\.whatsapp_mensagens/i);
    expect(LID).not.toMatch(/INSERT INTO\s+public\.whatsapp_conversas/i);
    expect(LID).not.toMatch(/INSERT INTO\s+public\.leads/i);
    expect(LID).not.toMatch(/DELETE FROM/i);
  });

  it("funções do lid só do service_role", () => {
    fechadaSoParaOServico(LID, "whatsapp_conversa_do_lid", "uuid, text");
    fechadaSoParaOServico(LID, "whatsapp_aprender_lid", "uuid, text");
    expect(LID).toContain("whatsapp_conversa_do_lid(p_instancia_id uuid, p_chat_lid text)");
    expect(LID).toContain("whatsapp_aprender_lid(p_conversa_id uuid, p_chat_lid text)");
    // Lid repetido nunca derruba o webhook.
    expect(corpoDa(LID, "whatsapp_aprender_lid")).toMatch(/EXCEPTION WHEN unique_violation THEN\s+RETURN false;/);
  });
});
