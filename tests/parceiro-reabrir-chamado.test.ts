import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIMITE_LINHAS_LEMBRETE, LINHAS_GUARDADAS_PARA_FECHADOS } from "@/domain/parceiros/sem-contato";

/**
 * Reabrir o chamado de parceiro fechado SEM ATENDIMENTO (22/11/2026) e o aviso do grupo que não esconde esse chamado.
 * Travam-se: a função só acrescenta (não toca nas regras de fechamento da caixa do WhatsApp), nasce fechada para anon,
 * confere o resultado no banco antes de dizer que reabriu, e o aviso guarda linhas para os fechados.
 */

const ler = (c: string) => readFileSync(c, "utf8");
const semComentarios = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").replace(/--[^\n']*$/gm, "");

const REABRIR = ler("supabase/migrations/20261122600000_parceiro_reabrir_chamado.sql");
const AVISO = ler("supabase/migrations/20261122610000_aviso_de_parceiros_nao_esconde_chamado_fechado.sql");
const CARTAO = ler("src/components/parceiros/atendimento-dos-parceiros.tsx");
const API = ler("src/lib/parceiro-atendimento-api.ts");

/** O papel logo depois do TO (ou FROM) de cada GRANT/REVOKE: `public.` do esquema não é o papel PUBLIC. */
const papeisDe = (sql: string, verbo: "GRANT" | "REVOKE") =>
  [...semComentarios(sql).matchAll(new RegExp(`${verbo}\\s+[^;]*?\\s${verbo === "GRANT" ? "TO" : "FROM"}\\s+([^;]+);`, "gi"))].flatMap((m) =>
    m[1].split(",").map((x) => x.trim().toLowerCase()),
  );

describe("a função parceiro_reabrir_chamado", () => {
  const corpo = semComentarios(REABRIR);

  it("é SECURITY DEFINER com o caminho de busca fixo e recebe só o parceiro", () => {
    expect(corpo).toMatch(/CREATE OR REPLACE FUNCTION public\.parceiro_reabrir_chamado\(p_parceiro uuid\)/);
    expect(corpo).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public'/);
    expect(corpo).toMatch(/RETURNS jsonb/);
  });

  it("nasce FECHADA: tira de PUBLIC, anon e authenticated e devolve EXECUTE só a authenticated", () => {
    expect(papeisDe(REABRIR, "REVOKE")).toEqual(expect.arrayContaining(["public", "anon", "authenticated"]));
    expect(papeisDe(REABRIR, "GRANT")).toEqual(["authenticated"]);
    expect(corpo).toMatch(/has_function_privilege\('anon', v_oid, 'EXECUTE'\)/);
    expect(corpo).toMatch(/aclexplode\(/);
    expect(corpo).toMatch(/proconfig @> ARRAY\['search_path=public'\]/);
  });

  it("confere a permissão por dentro: gerência de parceiros ou o responsável do próprio parceiro", () => {
    expect(corpo).toMatch(/auth\.uid\(\)/);
    expect(corpo).toMatch(/has_permission\(v_uid, 'parceiros\.manage'\)/);
    expect(corpo).toMatch(/has_permission\(v_uid, 'parceiros\.read'\) AND v_p\.responsavel_id = v_uid/);
    expect(corpo).toContain("Permissão necessária: parceiros.manage");
  });

  it("só reabre chamado fechado SEM atendimento, pela mesma conta do cartão e do aviso", () => {
    expect(corpo).toMatch(/FROM public\._parceiros_sem_contato\(\) t WHERE t\.parceiro_id = p_parceiro/);
    expect(corpo).toMatch(/IF v_l\.fechado_em IS NULL THEN\s+RETURN jsonb_build_object\('reaberto', false, 'motivo', 'ja_aberto'/);
    expect(corpo).toMatch(/IF NOT v_l\.fechado_sem_contato THEN\s+RAISE EXCEPTION 'Este chamado foi fechado depois de a equipe falar com o parceiro/);
  });

  it("recusa conta de teste, parceiro inativo, sem responsável e sem conversa, com frases em português", () => {
    for (const frase of [
      "Só parceiro ativo tem chamado.",
      "Conta de teste não tem chamado.",
      "Este parceiro está sem responsável",
      "Este parceiro ainda não tem conversa no WhatsApp",
      "Parceiro não encontrado.",
    ]) {
      expect(corpo, frase).toContain(frase);
    }
  });

  it("abre pelo caminho de sempre e CONFERE no banco antes de dizer que reabriu", () => {
    expect(corpo).toMatch(/_parceiro_garantir_chamado\(p_parceiro\)/);
    expect(corpo).toMatch(/v_conf\.fechado_em IS NOT NULL/);
    expect(corpo).toMatch(/v_conf\.conversa_id IS DISTINCT FROM v_l\.conversa_id/);
    expect(corpo).toMatch(/v_conf\.reaberto_de IS DISTINCT FROM v_l\.atendimento_id/);
    expect(corpo).toContain("O banco não confirmou a reabertura do chamado. Nada foi alterado");
  });

  it("registra quem reabriu em logs_auditoria", () => {
    expect(corpo).toMatch(/INSERT INTO public\.logs_auditoria[\s\S]*'parceiro_chamado_reaberto'/);
    expect(corpo).toMatch(/VALUES \(v_uid, 'parceiros', p_parceiro/);
  });

  it("só ACRESCENTA: não mexe nas regras de fechamento da caixa do WhatsApp e não manda mensagem", () => {
    expect(corpo).not.toMatch(/whatsapp_resolver|whatsapp_transferir|CREATE\s+(OR\s+REPLACE\s+)?TRIGGER|DROP\s+TRIGGER|ALTER\s+TABLE|UPDATE\s+public\.whatsapp_|DELETE\s+FROM|DROP\s+FUNCTION/i);
    expect(corpo).not.toMatch(/enfileirar_notificacao|whatsapp_fila_envio|INSERT INTO public\.whatsapp_mensagens/i);
    // A única função criada é a nova.
    expect([...corpo.matchAll(/CREATE OR REPLACE FUNCTION\s+([\w.]+)/gi)].map((m) => m[1])).toEqual(["public.parceiro_reabrir_chamado"]);
  });

  it("exige a migração do fechado_sem_contato antes e tem o DESFAZER", () => {
    expect(corpo).toMatch(/fechado_sem_contato/);
    expect(corpo).toMatch(/migração 20261119120000/);
    expect(REABRIR).toMatch(/-- DROP FUNCTION public\.parceiro_reabrir_chamado\(uuid\);/);
  });
});

describe("o aviso do grupo guarda linhas para os chamados fechados sem atendimento", () => {
  const corpo = semComentarios(AVISO);

  it("só troca a função de 19/11/2026 (guarda por md5) e fica só do agendamento", () => {
    expect(corpo).toContain("a8f57adf9a48d9dfe031c6290d8b8d1b");
    expect(corpo).toMatch(/A função lembrete_parceiros_sem_contato mudou desde a revisão/);
    expect(papeisDe(AVISO, "GRANT")).toEqual(["service_role"]);
    expect(papeisDe(AVISO, "REVOKE")).toEqual(expect.arrayContaining(["public", "anon", "authenticated"]));
    expect([...corpo.matchAll(/CREATE OR REPLACE FUNCTION\s+([\w.]+)/gi)].map((m) => m[1])).toEqual(["public.lembrete_parceiros_sem_contato"]);
  });

  it("o texto continua com a data e SEM o nome de quem fechou", () => {
    expect(corpo).toMatch(/' · fechado em ' \|\| to_char\(r\.fechado_em AT TIME ZONE 'America\/Belem', 'DD\/MM'\)/);
    expect(corpo).not.toMatch(/fechado por|fechado_por_nome/);
    expect(corpo).toContain("Chamados fechados sem nenhuma mensagem:");
  });

  it("reserva linhas para os fechados e conta o 'E mais N' pelo que de fato não coube", () => {
    expect(corpo).toMatch(/c_reserva constant integer := 5;/);
    expect(corpo).toMatch(/v_max_abertos := c_limite - LEAST\(v_f, c_reserva\);/);
    expect(corpo).toMatch(/EXIT WHEN v_i > v_max_abertos;/);
    expect(corpo).toMatch(/IF v_n > v_i THEN[\s\S]*E mais ' \|\| \(v_n - v_i\)/);
  });

  it("mantém as regras de antes: uma mensagem por dia, domingo não envia, só o agendamento roda", () => {
    expect(corpo).toMatch(/extract\(isodow FROM v_hoje\) = 7/);
    expect(corpo).toContain("'parceiros_sem_contato:grupo:' || v_hoje");
    expect(corpo).toMatch(/IF auth\.uid\(\) IS NOT NULL THEN\s+RAISE EXCEPTION 'Só o agendamento roda o lembrete de parceiros\.'/);
  });

  it("o banco e o espelho em TypeScript usam os mesmos limites", () => {
    expect(Number(corpo.match(/c_limite constant integer := (\d+);/)?.[1])).toBe(LIMITE_LINHAS_LEMBRETE);
    expect(Number(corpo.match(/c_reserva constant integer := (\d+);/)?.[1])).toBe(LINHAS_GUARDADAS_PARA_FECHADOS);
  });

  it("tem o DESFAZER", () => {
    expect(AVISO).toMatch(/DESFAZER: restaura o corpo de 19\/11\/2026/);
  });
});

describe("o cartão Atendimento dos parceiros mostra a função", () => {
  it("o botão Reabrir chamado só vale para o chamado fechado sem atendimento, e passa por podeReabrirChamado", () => {
    expect(CARTAO).toMatch(/podeReabrirChamado\(\{\s*fechadoSemContato: l\.fechado_sem_contato,/);
    expect(CARTAO).toContain("Reabrir chamado");
    expect(CARTAO).toMatch(/data-testid=\{`reabrir-chamado-\$\{l\.parceiro_id\}`\}/);
    expect(CARTAO).toMatch(/data-testid="dica-reabrir-chamado"/);
  });

  it("chama só a função da API, não o banco, e recarrega o cartão depois", () => {
    expect(CARTAO).toContain("reabrirChamadoDoParceiro(parceiroId)");
    expect(CARTAO).not.toMatch(/supabase\b|\.from\(/);
    expect(CARTAO).toMatch(/invalidateQueries\(\{ queryKey: \["parceiros-sem-contato"\] \}\)/);
  });

  it("a API chama a RPC pelo nome literal e só diz 'reaberto' quando o banco disse reaberto: true", () => {
    expect(API).toMatch(/\(supabase\.rpc as any\)\("parceiro_reabrir_chamado", \{ p_parceiro: parceiroId \}\)/);
    expect(API).toMatch(/if \(r\.reaberto === true\) return/);
    expect(API).toContain("O banco não confirmou a reabertura do chamado");
  });
});
