import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Preços pendentes de aprovação e alerta de integridade dos orçamentos: o contrato da migração e do roteiro de ensaio,
 * lidos como TEXTO (nada aqui fala com banco). O que o SQL faz de verdade foi provado no banco vivo, dentro de uma
 * transação desfeita, e está em docs/ensaio-precos-pendentes-e-alertas.md.
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const NOME = "20261115180000_precos_pendentes_e_alertas_de_integridade.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const doc = readFileSync(join(RAIZ, "docs", "ensaio-precos-pendentes-e-alertas.md"), "utf8");

const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigo = semComentarios(sql);

function comandosSemWhere(s: string): string[] {
  const achados: string[] = [];
  const re =
    /\b(UPDATE\s+(?:ONLY\s+)?[\w.]+\s+(?:\w+\s+)?SET\b|DELETE\s+FROM\s+(?:ONLY\s+)?[\w.]+)([\s\S]*?)(?:;|$)/gi;
  for (const m of s.matchAll(re)) {
    if (!/\bWHERE\b/i.test(m[0])) achados.push(m[0].replace(/\s+/g, " ").slice(0, 120));
  }
  return achados;
}

/** O corpo de uma função: entre `AS $f$` e o `$f$` que fecha, a partir do nome. */
function corpoDe(nome: string): string {
  const i = codigo.indexOf(`FUNCTION public.${nome}(`);
  if (i < 0) throw new Error(`sem ${nome}`);
  const ini = codigo.indexOf("$f$", i) + 3;
  return codigo.slice(ini, codigo.indexOf("$f$", ini));
}

const blocosSql = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
const ensaio = blocosSql.find((b) => b.includes("ENSAIO OK"))!;
const volta = blocosSql.find((b) => b.includes("DO $volta$"))!;

const FUNCOES = [
  "_preco_piso(numeric, numeric)",
  "_preco_margem(numeric, numeric)",
  "_integridade_brl(numeric)",
  "preco_proposta_aprovar(uuid)",
  "preco_proposta_recusar(uuid, text)",
  "_integridade_achados()",
  "alerta_integridade_orcamentos(boolean)",
];

describe("migração: arquivo e escopo", () => {
  it("vem depois da última migração e o prefixo de data é único", () => {
    expect(NOME > "20261115160000_parceiro_sempre_atendido.sql").toBe(true);
    expect(readdirSync(PASTA).filter((n) => n.startsWith(NOME.slice(0, 14)))).toEqual([NOME]);
  });

  it("abre com BEGIN e lock_timeout curto, fecha com COMMIT depois da conferência", () => {
    const i = sql.indexOf("BEGIN;");
    expect(i).toBeGreaterThan(-1);
    expect(sql.indexOf("SET LOCAL lock_timeout = '5s';")).toBeGreaterThan(i);
    expect(sql.lastIndexOf("COMMIT;")).toBeGreaterThan(sql.indexOf("DO $confere$"));
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("nenhum UPDATE nem DELETE sem WHERE (safeupdate)", () => {
    expect(comandosSemWhere(codigo)).toEqual([]);
    expect(codigo).not.toMatch(/\bTRUNCATE\b|\bDROP\s+(TABLE|FUNCTION|VIEW)\b/i);
  });

  it("não escreve em orçamento, item nem versão: o preço do produto só muda dentro de aprovar", () => {
    expect(codigo).not.toMatch(/\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+public\.orcamento/i);
    const updates = [...codigo.matchAll(/UPDATE public\.produtos\b[^;]*;/g)].map((m) => m[0]);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("SET preco_base = v_prop.preco_proposto WHERE id = v_prod.id");
    expect(corpoDe("preco_proposta_aprovar")).toContain("UPDATE public.produtos SET preco_base");
    expect(codigo).not.toMatch(/INSERT\s+INTO\s+public\.produtos\b/i);
  });

  it("a migração não muda preço: as propostas nascem pendente", () => {
    expect(sql).toContain("status          text NOT NULL DEFAULT 'pendente'");
    const semente = codigo.slice(codigo.indexOf("INSERT INTO public.precos_propostas"), codigo.indexOf("CREATE OR REPLACE FUNCTION public.preco_proposta_aprovar"));
    expect(semente).not.toMatch(/'aprovada'|'recusada'/);
    expect(semente).toContain("ON CONFLICT (produto_id) WHERE status = 'pendente' DO NOTHING");
  });
});

describe("migração: acesso", () => {
  it("toda função nova tem REVOKE de PUBLIC, anon, authenticated e service_role antes de qualquer GRANT", () => {
    for (const f of FUNCOES) {
      const rev = `REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated, service_role;`;
      expect(codigo, f).toContain(rev);
      const g = codigo.indexOf(`GRANT EXECUTE ON FUNCTION public.${f}`);
      if (g >= 0) expect(g).toBeGreaterThan(codigo.indexOf(rev));
    }
    expect([...codigo.matchAll(/CREATE OR REPLACE FUNCTION/g)]).toHaveLength(FUNCOES.length);
  });

  it("só a decisão e a consulta são abertas, e só para quem precisa", () => {
    const grants = [...codigo.matchAll(/GRANT EXECUTE ON FUNCTION public\.([^ ]+(?: [^ ]+)?) TO (\w+);/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(grants.sort()).toEqual(
      [
        "alerta_integridade_orcamentos(boolean) authenticated",
        "alerta_integridade_orcamentos(boolean) service_role",
        "preco_proposta_aprovar(uuid) authenticated",
        "preco_proposta_recusar(uuid, text) authenticated",
      ].sort(),
    );
    expect(codigo).not.toMatch(/GRANT[^;]*\b(anon|PUBLIC)\b/);
  });

  it("tabelas novas com RLS, só policy de leitura por quem vê custo, ACL por nome e nada para anon", () => {
    for (const t of ["precos_propostas", "alertas_integridade"]) {
      expect(codigo).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(codigo).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated, service_role;`);
      expect(codigo).toContain(`GRANT SELECT ON TABLE public.${t} TO authenticated;`);
      expect(codigo).toContain(`GRANT SELECT ON TABLE public.${t} TO service_role;`);
    }
    const policies = [...codigo.matchAll(/CREATE POLICY[\s\S]*?;/g)].map((m) => m[0]);
    expect(policies).toHaveLength(2);
    for (const p of policies) {
      expect(p).toContain("FOR SELECT TO authenticated");
      expect(p).toContain("public.pode_ver_custo((SELECT auth.uid()))");
    }
    expect(codigo).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)\b/i);
  });

  it("a view é security_invoker e sem acesso para anon", () => {
    expect(codigo).toContain("CREATE OR REPLACE VIEW public.vw_precos_propostas WITH (security_invoker = true)");
    expect(codigo).toContain("REVOKE ALL ON TABLE public.vw_precos_propostas FROM PUBLIC, anon, authenticated, service_role;");
  });

  it("decidir exige admin ou gestor que vê custo, e login (uid nulo recusa)", () => {
    for (const f of ["preco_proposta_aprovar", "preco_proposta_recusar"]) {
      const c = corpoDe(f);
      expect(c).toContain("v_uid IS NULL");
      expect(c).toContain("public.has_role(v_uid, 'admin'::public.app_role)");
      expect(c).toContain("public.has_role(v_uid, 'gestor'::public.app_role)");
      expect(c).toContain("public.pode_ver_custo(v_uid)");
      const cab = codigo.slice(codigo.indexOf(`FUNCTION public.${f}(`), codigo.indexOf("$f$", codigo.indexOf(`FUNCTION public.${f}(`)));
      expect(cab).toContain("SECURITY DEFINER SET search_path = public");
      expect(c).toContain("ERRCODE = '42501'");
    }
  });
});

describe("aprovar e recusar", () => {
  const ap = corpoDe("preco_proposta_aprovar");

  it("trava, confere pendente, preço desatualizado e piso vivo antes de gravar", () => {
    const iPend = ap.indexOf("v_prop.status <> 'pendente'");
    const iMudou = ap.indexOf("v_prod.preco_base IS DISTINCT FROM v_prop.preco_atual");
    const iPiso = ap.indexOf("v_prop.preco_proposto < v_piso");
    const iGrava = ap.indexOf("UPDATE public.produtos");
    expect(ap).toContain("FOR UPDATE");
    expect(iPend).toBeGreaterThan(-1);
    expect(iMudou).toBeGreaterThan(iPend);
    expect(iPiso).toBeGreaterThan(iMudou);
    expect(iGrava).toBeGreaterThan(iPiso);
    expect(ap).toContain("public._preco_piso(v_prod.custo_medio, v_prod.margem_minima)");
  });

  it("grava quem e quando, e a auditoria leva preço, nunca custo", () => {
    expect(ap).toContain("decidido_por = v_uid, decidido_em = now()");
    const aud = ap.slice(ap.indexOf("INSERT INTO public.logs_auditoria"));
    expect(aud).toContain("'preco_de'");
    expect(aud).toContain("'preco_para'");
    expect(aud).not.toMatch(/custo/);
  });

  it("recusar pede uma nota e não mexe em preço", () => {
    const rec = corpoDe("preco_proposta_recusar");
    expect(rec).toContain("length(btrim(COALESCE(p_nota, ''))) < 3");
    expect(rec).not.toMatch(/public\.produtos/);
  });
});

describe("a conta do piso é a do sistema", () => {
  it("a mesma fórmula de parceiro_precos", () => {
    expect(corpoDe("_preco_piso")).toContain(
      "round(p_custo / (1 - COALESCE(p_margem_minima, 0) / 100), 2)",
    );
    expect(corpoDe("_preco_piso")).toContain("COALESCE(p_margem_minima, 0) < 100");
  });

  it("as propostas do roteiro ficam no piso ou acima, e a margem proposta cobre o mínimo", () => {
    const linhas = [...doc.matchAll(/^\| ([^|]+) \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \|$/gm)];
    expect(linhas).toHaveLength(12);
    const num = (s: string) => Number(s.replace(",", "."));
    for (const l of linhas) {
      const [, nome, atual, proposto, piso, margemHoje, margemNova] = l;
      expect(num(proposto), nome).toBeGreaterThanOrEqual(num(piso));
      expect(num(proposto), nome).toBeGreaterThan(num(atual));
      expect(num(margemNova), nome).toBeGreaterThan(num(margemHoje));
    }
  });

  it("os preços semeados batem com a tabela do roteiro", () => {
    const semeados = [...codigo.matchAll(/\('([0-9a-f-]{36})'(?:::uuid)?,\s*([\d.]+)(?:::numeric)?,/g)].map((m) => Number(m[2]));
    expect(semeados).toHaveLength(12);
    const tabela = [...doc.matchAll(/^\| [^|]+ \| [\d,]+ \| ([\d,]+) \|/gm)].map((m) => Number(m[1].replace(",", ".")));
    expect(semeados.sort()).toEqual(tabela.sort());
    expect(sql).toContain("IF v_n <> 12 THEN");
  });
});

describe("alerta de integridade: detecção", () => {
  const det = corpoDe("_integridade_achados");

  it("os seis tipos de achado existem, com a chave tipo mais orçamento", () => {
    for (const t of [
      "valor_enviado_mudou",
      "orcamento_duplicado",
      "margem_negativa",
      "margem_baixa",
      "custo_fantasma",
      "item_aprovado_sem_custo",
      "produto_sem_preco",
    ]) {
      expect(det, t).toContain(`'${t}`);
    }
    expect(det).toContain("'valor_enviado_mudou:' || o.id");
    expect(det).toContain("'produto_sem_preco:' || p.id");
  });

  it("custo fantasma: mais de 3 vezes ou menos de um terço, por área quando vendido por m2", () => {
    expect(det).toContain("it.custo_un > 3 * it.esperado OR it.custo_un < it.esperado / 3.0");
    expect(det).toContain("i.preco_m2 IS NOT NULL");
    expect(det).toContain("COALESCE(NULLIF(i.area_unitaria, 0), i.largura * i.altura)");
  });

  it("só orçamento em rascunho, enviado ou aprovado entra", () => {
    expect(det).toContain("o.status::text IN ('rascunho', 'enviado', 'aprovado')");
  });

  it("o texto leva só percentual de margem: valor em reais só no valor enviado contra o de hoje", () => {
    const comReais = det.split("\n").filter((l) => l.includes("R$"));
    expect(comReais).toHaveLength(1);
    expect(comReais[0]).toContain("foi enviado por R$ %s e hoje está em R$ %s");
    expect(det).not.toMatch(/_integridade_brl\([^)]*custo/);
    expect(det).not.toMatch(/'custo_total'|custo_estimado/);
  });

  it("textos de tela sem parênteses, travessão nem seta", () => {
    const textos = [...det.matchAll(/format\('([^']*)'/g)].map((m) => m[1]);
    expect(textos.length).toBeGreaterThanOrEqual(6);
    for (const t of textos) expect(t, t).not.toMatch(/[()—–→]|->/);
    const motivos = [...sql.matchAll(/'((?:Mesma|Lona|Adesivo|O custo)[^']*)'/g)].map((m) => m[1]);
    expect(motivos.length).toBeGreaterThanOrEqual(5);
    for (const t of motivos) expect(t, t).not.toMatch(/[()—–→]|->/);
    const erros = [...codigo.matchAll(/RAISE EXCEPTION '([^']*)'/g)].map((m) => m[1]);
    for (const t of erros) expect(t, t).not.toMatch(/[()—–→]|->/);
  });
});

describe("alerta de integridade: aviso ao grupo", () => {
  const fn = corpoDe("alerta_integridade_orcamentos");

  it("só fala com o grupo da equipe, nunca com cliente", () => {
    expect(fn).toContain("v_grupo text := public.grupo_equipe_destino()");
    const chamadas = [...fn.matchAll(/enfileirar_notificacao\('whatsapp', ([^,]+), NULL,/g)].map((m) => m[1]);
    expect(chamadas).toEqual(["v_grupo", "v_grupo"]);
    expect(fn).not.toMatch(/cliente_id/);
    expect(fn).toContain("'aviso_grupo_equipe'");
  });

  it("começa com ATENCAO GERENTE, cita o gestor e pede conferência e autorização", () => {
    expect(fn).toContain("v_cab := 'ATENCAO GERENTE'");
    expect(fn).toContain("ur.role = 'gestor'::public.app_role");
    expect(fn).toContain("'mencionar', to_jsonb(v_tel)");
    expect(fn).toContain("Confira e autorize agora");
  });

  it("a chave da fila inclui o fato que muda e o dia, então não come o segundo aviso nem repete o primeiro", () => {
    expect(fn).toContain(
      "v_chave := 'grupo_equipe:integridade:' || v_alerta || ':' || r.h || ':' || public.hoje_br() || ':' || r.reenvios;",
    );
    expect(fn).toContain("md5(a.estado::text)");
    expect(fn).toContain("interval '24 hours'");
    expect(fn).toContain("interval '7 days'");
  });

  it("nunca descarta em silêncio: NULL da fila vira chave existente ou aviso_nao_enviado, sem erro mudo", () => {
    expect(fn).toContain("SELECT f.id INTO v_fila FROM public.notificacoes_fila f WHERE f.idempotency_key = v_chave");
    expect(fn).toContain("status = 'aviso_nao_enviado'");
    expect(fn).toContain("RAISE WARNING");
    expect(codigo).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);
    expect(codigo).not.toMatch(/RETURN\s+NULL/i);
  });

  it("aviso que não pode zerar: guarda o id da fila e confere se saiu, se falhou ou foi cancelado volta", () => {
    expect(fn).toContain("fila_id = v_fila");
    expect(fn).toContain("f.status = 'enviado'");
    expect(fn).toContain("f.status IN ('falhou', 'cancelado')");
    expect(fn).toContain("reenvios = a.reenvios + 1");
  });

  it("mais de 15 avisos novos: o que não é urgente vira um aviso só", () => {
    expect(fn).toContain("v_limite constant integer := 15");
    expect(fn).toContain("v_dobrar := v_novos > v_limite");
    expect(fn).toContain("NOT r.urgente AND (v_dobrar OR v_acao = 'lembrete')");
    expect(fn).toContain("OR v_individuais >= v_limite");
    // o estado de margem e custo fantasma não leva o número que oscila a cada edição
    expect(fn).not.toContain("jsonb_build_object('margem'");
    expect(fn).not.toContain("'razao', round(f.razao");
    expect(fn).toContain("v_resumo_linhas[1:25]");
  });

  it("modo seco não grava; só o agendamento enfileira; pessoa precisa ver custo", () => {
    expect(fn).toContain("IF v_uid IS NOT NULL THEN");
    expect(fn).toContain("IF NOT public.pode_ver_custo(v_uid) THEN");
    expect(fn).toContain("IF p_enfileirar THEN\n      RAISE EXCEPTION 'Só o agendamento envia o aviso.");
    expect(fn).toContain("p_enfileirar boolean DEFAULT false".split(" boolean")[0]);
    // todas as escritas no alerta e na fila ficam atrás de p_enfileirar
    const antes = fn.slice(0, fn.indexOf("v_dobrar := v_novos > v_limite"));
    expect(antes.match(/UPDATE public\.alertas_integridade/g)).toHaveLength(2);
    expect(antes.lastIndexOf("IF p_enfileirar THEN")).toBeGreaterThan(-1);
  });

  it("fila: a entidade aceita pela restrição da tabela", () => {
    expect(fn.match(/'aviso_grupo_equipe', 'orcamento',/g)).toHaveLength(2);
  });
});

describe("agendamento", () => {
  it("de hora em hora, das 8h às 18h de Macapá (UTC-3), segunda a sábado, chamando a função no banco", () => {
    expect(codigo).toContain(
      "PERFORM cron.schedule('integridade-orcamentos', '0 11-21 * * 1-6', 'SELECT public.alerta_integridade_orcamentos(true)');",
    );
    expect(codigo).toContain("PERFORM cron.unschedule('integridade-orcamentos')");
    expect(codigo).not.toMatch(/net\.http_post|vault\.decrypted_secrets/);
  });
});

describe("conferência final da migração", () => {
  const confere = sql.slice(sql.indexOf("DO $confere$"));
  it("confere 12 propostas, piso, RLS, ACL, anon e o job", () => {
    expect(confere).toContain("esperava 12 propostas pendentes");
    expect(confere).toContain("proposta semeada abaixo do piso");
    expect(confere).toContain("RLS desligada numa tabela nova");
    expect(confere).toContain("ACL das tabelas novas aberta demais");
    expect(confere).toContain("anon executa função nova");
    expect(confere).toContain("o agendamento integridade-orcamentos não ficou ativo");
  });
});

describe("roteiro de ensaio", () => {
  it("termina com RAISE EXCEPTION e nunca tem COMMIT", () => {
    expect(ensaio).toContain("RAISE EXCEPTION 'ENSAIO OK%', v_rel;");
    expect(ensaio).not.toMatch(/\bCOMMIT\b/);
  });

  it("prova papel, anon, decisão, piso, preço desatualizado, fila, falha, grupo desligado e orçamento intacto", () => {
    for (const trecho of [
      "vendedor ve propostas=",
      "anon na tabela barrado=",
      "admin enfileirar barrado=",
      "aprovar barrado=",
      "segunda vez barrada=",
      "abaixo do piso barrado=",
      "preco desatualizado barrado=",
      "segunda rodada: fila=",
      "problema mudou: fila=",
      "fila falhou: fila=",
      "grupo desligado: nao_enviados=",
      "grupo religado: ainda aviso_nao_enviado=",
      "orcamentos iguais antes e depois",
      "[7] cron:",
    ]) {
      expect(ensaio, trecho).toContain(trecho);
    }
  });

  it("limpa a identidade simulada antes de enviar como o agendamento", () => {
    const i = ensaio.indexOf("set_config('request.jwt.claim.sub', '', true)");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(ensaio.indexOf("[5] ENVIANDO"));
  });

  it("o roteiro de volta desfaz tudo que a migração cria", () => {
    for (const t of [
      "cron.unschedule('integridade-orcamentos')",
      "DROP FUNCTION IF EXISTS public.alerta_integridade_orcamentos(boolean)",
      "DROP FUNCTION IF EXISTS public._integridade_achados()",
      "DROP FUNCTION IF EXISTS public.preco_proposta_aprovar(uuid)",
      "DROP FUNCTION IF EXISTS public.preco_proposta_recusar(uuid, text)",
      "DROP VIEW IF EXISTS public.vw_precos_propostas",
      "DROP TABLE IF EXISTS public.alertas_integridade",
      "DROP TABLE IF EXISTS public.precos_propostas",
    ]) {
      expect(volta, t).toContain(t);
    }
  });

  it("o volume da primeira rodada está registrado", () => {
    expect(doc).toContain("16 achados: 6 urgentes e 10 não urgentes");
    expect(doc).toContain("**7 avisos**");
  });
});
