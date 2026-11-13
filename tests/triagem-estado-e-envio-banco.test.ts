import { describe, expect, it } from "vitest";
import { MIGRACAO_B1, MIGRACAO_B4, corpoDaFuncao, grants, lerMigracao, semComentarios } from "./triagem/sql-lido-como-texto";
import { numeroDoIdentificador } from "../src/domain/whatsapp/triagem/textos";
import { detectarRobo } from "../src/domain/whatsapp/triagem/portao";
import { extrairNome } from "../src/domain/whatsapp/triagem/extrair";
import { SEMENTES_DO_QUADRO } from "../src/domain/whatsapp/triagem/quadro-sementes";

/**
 * B4 da triagem (Onda B): estado por conversa, eventos, bloqueios, funções de envio e pausa, lida como texto.
 *
 * O que estas travas seguram:
 *  - RLS nas três tabelas, anon sem nada, authenticated só lê (e não lê os bloqueios);
 *  - nenhuma função nova executável por anon, authenticated ou PUBLIC; cada nome com uma assinatura só; todas definer;
 *  - a mensagem da triagem sai pela fila existente com origem automacao + marca triagem, chave de idempotência da triagem,
 *    e o texto montado é revalidado antes de entrar na fila;
 *  - a pausa por humano dispara por saída que NÃO é automacao nem ia, e nunca derruba a mensagem de quem respondeu;
 *  - o banco não escreve em clientes, cliente_contatos, leads nem muda o CHECK de origem das mensagens;
 *  - os eventos não guardam conteúdo; o telefone bloqueado fica em hash.
 */
const BRUTO = lerMigracao(MIGRACAO_B4);
const SQL = semComentarios(BRUTO);
const B1 = semComentarios(lerMigracao(MIGRACAO_B1));

const TABELAS = ["whatsapp_triagens", "whatsapp_triagem_eventos", "whatsapp_automacao_bloqueios"];
const FUNCOES = [
  "_triagem_hash",
  "_triagem_sorteio",
  "_triagem_parece_robo",
  "_triagem_conhecido",
  "_triagem_bloqueado",
  "_triagem_nome_valido",
  "_triagem_humano_na_conversa",
  "_triagem_cancelar_pendentes",
  "_triagem_pausar",
  "_triagem_lista_limpa",
  "_triagem_em_andamento",
  "_triagem_desligar_config",
  "_triagem_desligar_interno",
  "_triagem_recompor_ultima",
  "_triagem_degrau_permite",
  "triagem_enviar",
  "triagem_dono_da_conversa",
  "triagem_ler_ou_abrir",
  "triagem_aplicar",
  "triagem_pausar_por_humano",
  "triagem_desligar",
  "triagem_varrer",
];
const PURAS = ["_triagem_hash", "_triagem_sorteio", "_triagem_parece_robo", "_triagem_nome_valido", "_triagem_lista_limpa"];
const DEFINER = FUNCOES.filter((f) => !PURAS.includes(f));

describe("triagem B4: forma da migração", () => {
  it("é transacional, tem precondições claras e termina com a conferência", () => {
    expect(SQL).toMatch(/^\s*BEGIN;/m);
    expect(SQL.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(SQL).toContain("DO $pre$");
    expect(SQL).toContain("DO $conferencia$");
    expect(SQL.match(/RAISE EXCEPTION/g)!.length).toBeGreaterThanOrEqual(30);
  });

  it("exige a B1, a B3 e a Onda A antes (sem a Onda A o ramo parceiro nasceria sem fonte)", () => {
    expect(SQL).toContain("aplique antes a 20261113130000_triagem_dados.sql");
    expect(SQL).toContain("aplique antes a 20261113131000_horario_unico.sql");
    expect(SQL).toContain("sem_onda_a");
    expect(SQL).toContain("column_name = 'tipo'");
    expect(SQL).toContain("to_regclass('public.conjuntos_anuncio')");
  });

  it("confere a premissa viva: automacao não zera a espera, a fila aceita 'cancelada' sem migração", () => {
    expect(SQL).toContain("_wa_mensagem_antes_inserir mudou: releia a definição viva");
    expect(SQL).toContain("whatsapp_fila_envio tem CHECK em status");
    expect(SQL).toContain("UNIQUE (idempotency_key)");
  });

  it("a palavra proibida do dono não aparece, nem em comentário", () => {
    expect(BRUTO).not.toMatch(/revendedor/i);
  });

  it("não escreve em cliente, contato de cliente nem lead, e não mexe no CHECK de origem das mensagens", () => {
    expect(SQL).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+public\.(clientes|cliente_contatos|leads|parceiros|orcamentos)\b/i);
    expect(SQL).not.toMatch(/ALTER TABLE public\.(whatsapp_mensagens|whatsapp_conversas|whatsapp_fila_envio|whatsapp_atendimentos|leads|clientes)/i);
    expect(SQL).not.toMatch(/whatsapp_mensagens_origem_check/);
    expect(SQL).not.toMatch(/FUNCTION public\.(_wa_mensagem_antes_inserir|whatsapp_ia_enviar|whatsapp_registrar_mensagem)\b/);
    // a única escrita em whatsapp_conversas é o resumo da última mensagem (ao enviar, como whatsapp_ia_enviar, e ao
    // apagar a pergunta que não saiu, para a caixa não mostrar o que o contato nunca recebeu)
    const escritas = [...SQL.matchAll(/UPDATE public\.whatsapp_conversas(?: \w+)?\s+SET (\w+)/g)].map((m) => m[1]);
    expect(escritas).toEqual(["ultima_mensagem", "ultima_mensagem"]);
  });

  it("nenhuma origem nova: a triagem usa 'automacao' com a marca payload.triagem", () => {
    expect(SQL).not.toMatch(/origem\s*(=|IN)\s*\(?\s*'triagem'/i);
    expect(SQL).not.toMatch(/p_origem|'celular'\s*,\s*'automacao'\s*,\s*'ia'\s*,\s*'triagem'/);
    const e = corpoDaFuncao(SQL, "triagem_enviar");
    expect(e).toContain("'automacao'");
    expect(e).toContain("jsonb_build_object('triagem', jsonb_build_object('id', t.id");
    expect(e).toContain("NULL, 'automacao'");
  });
});

describe("triagem B4: acesso", () => {
  it("tabelas com RLS, REVOKE pelo nome e só leitura para authenticated (bloqueios nem isso)", () => {
    for (const t of TABELAS) {
      expect(SQL, t).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(SQL, t).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(SQL, t).toContain(`GRANT ALL ON public.${t} TO service_role;`);
    }
    expect(SQL).toContain("GRANT SELECT ON public.whatsapp_triagens TO authenticated;");
    expect(SQL).toContain("GRANT SELECT ON public.whatsapp_triagem_eventos TO authenticated;");
    expect(SQL).not.toContain("GRANT SELECT ON public.whatsapp_automacao_bloqueios TO authenticated");
    expect(SQL).toContain("authenticated lê os bloqueios");
    const politicas = [...SQL.matchAll(/CREATE POLICY "([^"]+)" ON public\.(\w+)\s+FOR (\w+) TO (\w+)/g)];
    expect(politicas.map((p) => [p[2], p[3], p[4]])).toEqual([
      ["whatsapp_triagens", "SELECT", "authenticated"],
      ["whatsapp_triagem_eventos", "SELECT", "authenticated"],
    ]);
  });

  it("nenhum GRANT para anon ou PUBLIC; função só service_role", () => {
    for (const g of grants(SQL)) {
      expect(g.para, g.alvo).not.toContain("anon");
      expect(g.para, g.alvo).not.toContain("public");
      if (/^EXECUTE/.test(g.alvo)) expect(g.para, g.alvo).toEqual(["service_role"]);
      if (g.para.includes("authenticated")) expect(g.alvo).toMatch(/^SELECT ON public\.(whatsapp_triagens|whatsapp_triagem_eventos)$/);
    }
  });

  it("cada função: REVOKE de PUBLIC, anon e authenticated e GRANT só ao service_role; uma versão por nome", () => {
    for (const f of FUNCOES) {
      expect(SQL, f).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(SQL, f).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO service_role;`));
      expect(SQL.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${f}\\(`, "g"))?.length, f).toBe(1);
    }
    const criadas = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]).sort();
    expect(criadas).toEqual([...FUNCOES].sort());
    expect(SQL).toContain("sobrecarga quebra o PostgREST");
  });

  it("as que mexem em tabela são SECURITY DEFINER com search_path público", () => {
    for (const f of DEFINER) {
      const c = corpoDaFuncao(SQL, f);
      expect(c, f).toContain("SECURITY DEFINER");
      expect(c, f).toContain("SET search_path TO 'public'");
    }
    expect(DEFINER.length).toBe(17);
    expect(SQL).toContain("IF v_n <> 17 THEN RAISE EXCEPTION 'só % de 17 funções são SECURITY DEFINER com search_path'");
  });

  it("a assinatura de triagem_ler_ou_abrir, triagem_aplicar e triagem_enviar é a que o servidor vai chamar", () => {
    expect(SQL).toContain("triagem_ler_ou_abrir(p_conversa_id uuid, p_mensagem_id uuid, p_contexto jsonb DEFAULT '{}'::jsonb)");
    expect(SQL).toContain("triagem_aplicar(p_triagem_id uuid, p_versao integer, p_resultado jsonb)");
    expect(SQL).toContain("triagem_enviar(\n  p_triagem_id uuid, p_texto text, p_chave text, p_atraso_s integer, p_passo text, p_ordem integer, p_codigos text[])");
    expect(SQL).toContain("triagem_desligar(p_motivo text, p_usuario uuid)");
    expect(SQL).toContain("_triagem_desligar_interno(p_motivo text, p_usuario uuid)");
    expect(SQL).toContain("triagem_dono_da_conversa(p_conversa_id uuid)");
    expect(SQL).toContain("triagem_varrer()");
  });
});

describe("triagem B4: o que cada função garante", () => {
  it("triagem_enviar: chave da triagem, idempotência, revalidação do texto, teto e fila existente", () => {
    const c = corpoDaFuncao(SQL, "triagem_enviar");
    expect(c).toContain("p_chave NOT LIKE 'triagem:' || t.id::text || ':%'");
    expect(c).toContain("SELECT id, status INTO v_existente FROM public.whatsapp_fila_envio WHERE idempotency_key = p_chave");
    expect(c).toContain("_triagem_problemas_de_texto(v_texto, t.ramo, false)");
    expect(c).toContain("'texto_barrado'");
    expect(c).toContain("m.origem = 'automacao'");
    expect(c).toContain("v_ja >= cfg.max_mensagens");
    // a pergunta que ainda não saiu não conta contra si mesma: o teto é conferido antes do cancelar-e-substituir
    expect(c).toContain("NOT (m.status = 'pendente' AND m.payload ? 'triagem'");
    expect(c.indexOf("v_ja >= cfg.max_mensagens")).toBeLessThan(c.indexOf("PERFORM public._triagem_cancelar_pendentes(c.id)"));
    expect(c).toContain("INSERT INTO public.whatsapp_fila_envio");
    expect(c).toContain("'atraso_s', v_atraso, 'triagem_id', t.id");
    expect(c).toContain("least(15, greatest(1,");
    expect(c).toContain("cfg.estado NOT IN ('teste', 'parcial', 'ligada')");
    // texto barrado vem antes de qualquer INSERT de mensagem
    expect(c.indexOf("texto_barrado")).toBeLessThan(c.indexOf("INSERT INTO public.whatsapp_mensagens"));
    expect(c.indexOf("v_existente")).toBeLessThan(c.indexOf("INSERT INTO public.whatsapp_mensagens"));
  });

  it("triagem_aplicar: ensaio nunca escreve fila nem mensagem; texto barrado pausa só aquela triagem e o freio é por contagem", () => {
    const c = corpoDaFuncao(SQL, "triagem_aplicar");
    expect(c).toContain("IF v_ensaio THEN");
    const ensaio = c.slice(c.indexOf("IF v_ensaio THEN"), c.indexOf("ELSE\n      v_envio_res"));
    expect(ensaio).toContain("'envio_ensaio'");
    expect(ensaio).not.toMatch(/whatsapp_mensagens|whatsapp_fila_envio|triagem_enviar/);
    // o texto é conferido no ensaio também, mas nunca vai para o evento
    expect(ensaio).toContain("_triagem_problemas_de_texto(btrim(v_envio ->> 'texto'), t.ramo, false)");
    const detalhe = ensaio.slice(ensaio.indexOf("'envio_ensaio'"), ensaio.indexOf("'ramo', t.ramo));"));
    expect(detalhe).not.toMatch(/'texto'|v_envio ->> 'texto'/);
    expect(detalhe).toContain("_triagem_lista_limpa(v_envio -> 'variaveis', '^[a-z_]{1,40}$')");
    // texto barrado: só esta triagem para (entregue_equipe); NADA desliga a triagem de todos a partir de um contato
    expect(c).toContain("IF v_barrado THEN v_status := 'entregue_equipe'; END IF;");
    expect(c).not.toMatch(/triagem_desligar\(|_triagem_desligar_interno/);
    // o freio global é por contagem (3 em 30 minutos, depois de desligada_em) e só muda a configuração, sem percorrer conversas
    expect(c).toContain("v_barrados >= 3 AND public._triagem_desligar_config('freio_textos_barrados', NULL)");
    expect(c).toContain("interval '30 minutes', coalesce(cfg.desligada_em, '-infinity'::timestamptz)");
    expect(c).toContain("pg_advisory_xact_lock(hashtextextended('triagem:' || v_conversa::text, 0))");
    expect(c).toContain("t.versao <> p_versao");
    expect(c).toContain("ON CONFLICT (triagem_id, mensagem_id) WHERE tipo = 'entrada' DO NOTHING");
    expect(c).toContain("'duplicada', true");
  });

  it("triagem_aplicar: rajada (mensagens_ids), entrada mais antiga é repetida, portão reconferido, evento do aviso uma vez só", () => {
    const c = corpoDaFuncao(SQL, "triagem_aplicar");
    expect(c).toContain("p_resultado -> 'mensagens_ids'");
    expect(c).toContain("m.conversa_id = c.id AND m.direcao = 'entrada' AND m.id <> v_msg");
    expect(c).toContain("LIMIT 20");
    expect(c).toContain("'entrada_mais_antiga'");
    expect(c.indexOf("'entrada_mais_antiga'")).toBeLessThan(c.indexOf("INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, mensagem_id, tipo, passo)"));
    expect(c).toContain("v_portao := 'cliente_vinculado'");
    expect(c).toContain("_triagem_bloqueado(c.id)");
    // os tipos que o banco grava sozinho não são aceitos de novo vindos do servidor
    const aceitos = /v_ev ->> 'tipo' IN \(([^)]*)\)/.exec(c)![1];
    expect(aceitos).not.toMatch(/aviso_grupo|nome_nao_gravado|entrada|envio|expirou|freio/);
    expect(c).toContain("WHEN check_violation OR invalid_text_representation");
    // retomada: limpa o fim e refaz o aviso que a expiração decidiu
    expect(c).toContain("WHEN v_status IN ('ativa', 'ensaio') THEN NULL");
    expect(c).toContain("v_refaz_aviso");
    expect(c).toContain("aviso_grupo_rodada");
    // o ensaio grava o relógio do envio; o parar em ensaio não grava bloqueio real; parar sem chave não dá exceção
    expect(c).toContain("ultimo_envio_em = CASE WHEN v_enviou AND v_ensaio THEN now() ELSE ultimo_envio_em END");
    expect(c).toContain("'bloqueio_em_ensaio'");
    expect(c).toContain("'bloqueio_sem_chave'");
    expect(c.indexOf("IF v_hash_tel IS NULL AND v_hash_lid IS NULL")).toBeLessThan(c.indexOf("INSERT INTO public.whatsapp_automacao_bloqueios"));
  });

  it("triagem_aplicar: campos de escrita única, marcas que só sobem, ramo que só sobe, alternativo nunca verificado", () => {
    const c = corpoDaFuncao(SQL, "triagem_aplicar");
    expect(c).toContain("WHEN t.ramo = 'parceiro' THEN 'parceiro'");
    expect(c).toContain("cep = CASE WHEN cep IS NULL AND");
    expect(c).toContain("primeira_vez = CASE WHEN primeira_vez IS NULL AND");
    expect(c).toContain("endereco_texto = CASE WHEN endereco_texto IS NULL");
    expect(c).toContain("nome_completo = nome_completo OR (v_nome_gravado AND");
    expect(c).toContain("pediu_tabela_especial = pediu_tabela_especial OR");
    expect(c).toContain("(telefone_alternativo IS NULL OR t.passo = 'telefone_novo')");
    expect(c).not.toMatch(/telefone_alternativo_verificado\s*=/);
    expect(c).toContain("_triagem_nome_valido(v_nome)");
    expect(c).toContain("'nome_nao_gravado'");
  });

  it("triagem_ler_ou_abrir: o portão na ordem das críticas, e só o ensaio registra a recusa", () => {
    const c = corpoDaFuncao(SQL, "triagem_ler_ou_abrir");
    const ordem = [
      "cfg.estado = 'desligada'",
      "antes_da_data",
      "nao_e_pessoa",
      "'grupo'",
      "_wa_telefone_da_equipe",
      "cliente_vinculado",
      "tem_responsavel",
      "'arquivada'",
      "modo_humano",
      "ja_atendida",
      "cliente_conhecido",
      "'bloqueado'",
      "_triagem_parece_robo",
      "fora_dos_numeros_de_teste",
      "fora_do_sorteio",
      "freio_de_volume",
    ].map((t) => c.indexOf(t, c.indexOf("v_teste := ")));
    for (const i of ordem) expect(i).toBeGreaterThan(0);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(c).toContain("cfg.estado = 'ensaio' AND NOT EXISTS");
    expect(c).toContain("NOT (cfg.estado = 'teste' AND v_teste)");
    expect(c).toContain("'eh_grupo'");
    expect(c).toContain("'sem_catalogo'");
    expect(c).toContain("pg_advisory_xact_lock(hashtextextended('triagem:' || p_conversa_id::text, 0))");
    // qualquer saída anterior, inclusive aviso de pedido, impede abrir
    expect(c).toContain("s.direcao = 'saida')");
    // conversa que a equipe já fechou e a mensagem nova reabriu: os testes de responsável e modo já não enxergam nada
    expect(c).toContain("x.conversa_id = c.id AND (x.fechado_em IS NOT NULL OR x.reaberto_de IS NOT NULL)");
    // robô de empresa: ninguém responde, nem a assistente
    expect(c).toContain("v_motivo := 'robo'; v_dono := 'ninguem';");
    // o portão vale o fluxo todo: cliente vinculado, bloqueio manual e cliente conhecido param a triagem em curso
    const emCurso = c.slice(c.indexOf("IF v_tem_triagem THEN"), c.indexOf("ELSE\n    -- Portão de abertura"));
    for (const m of ["v_motivo := 'cliente_vinculado'", "v_motivo := 'bloqueado'", "_triagem_conhecido(c.id) IS NOT NULL", "'pulada'"]) expect(emCurso).toContain(m);
    // entrada mais antiga que uma já processada também é repetida
    expect(emCurso).toContain("m3.created_at > m.created_at");
    // o ensaio NÃO é dono
    expect(c).toContain("'dono', CASE WHEN v_ensaio THEN 'assistente' ELSE 'triagem' END");
    // o instantâneo não carrega texto de mensagem
    expect(c).not.toMatch(/'texto', m\.texto|m\.texto,/);
  });

  it("o conhecido é procurado em clientes (inclusive telefone_2 e telefone_3), contatos, lead ganho e conversa com o mesmo lid", () => {
    const c = corpoDaFuncao(SQL, "_triagem_conhecido");
    for (const t of ["telefone_2", "telefone_3", "whatsapp_principal", "cliente_contatos", "l.status = 'ganho'", "o.chat_lid = c.chat_lid"]) expect(c).toContain(t);
    expect(c).toContain("NOT IN ('automacao', 'ia')");
  });

  it("pausa por humano: saída que não é automacao nem ia, responsável, modo humano e arquivada; não derruba a mensagem", () => {
    expect(SQL).toContain("AFTER INSERT ON public.whatsapp_mensagens");
    expect(SQL).toContain("WHEN (NEW.direcao = 'saida' AND coalesce(NEW.origem, 'humano') NOT IN ('automacao', 'ia'))");
    expect(SQL).toContain("AFTER UPDATE OF responsavel_id, atribuido_para, modo, status ON public.whatsapp_conversas");
    expect(SQL).toContain("WHEN (NEW.responsavel_id IS NOT NULL OR NEW.atribuido_para IS NOT NULL OR NEW.modo = 'humano' OR NEW.status = 'arquivada')");
    const g = corpoDaFuncao(SQL, "triagem_pausar_por_humano");
    expect(g).toContain("WHEN OTHERS THEN\n      RAISE WARNING");
    expect(g).toContain("RETURN NULL");
    // NUNCA espera trava de outra sessão: SKIP LOCKED, lock_timeout só da função, e QUERY_CANCELED pelo nome (OTHERS não pega)
    expect(g).toContain("FOR UPDATE SKIP LOCKED");
    expect(g).not.toMatch(/FOR UPDATE;/);
    expect(g).toContain("WHEN query_canceled THEN");
    expect(g).toContain("SET lock_timeout TO '1s'");
    expect(g.indexOf("WHEN query_canceled")).toBeLessThan(g.indexOf("WHEN OTHERS"));
    // sem BEFORE: o gatilho da caixa continua sendo o único BEFORE INSERT
    expect(SQL).not.toMatch(/CREATE TRIGGER[^;]*BEFORE INSERT ON public\.whatsapp_mensagens/);
    // mesma ordem de travas em todo lugar: conversa primeiro, triagem depois
    for (const f of ["triagem_ler_ou_abrir", "triagem_aplicar"]) {
      const c = corpoDaFuncao(SQL, f);
      const conversa = c.search(/FROM public\.whatsapp_conversas WHERE id = [\w]+ FOR UPDATE/);
      const triagem = c.search(/FROM public\.whatsapp_triagens WHERE [^;]*FOR UPDATE/);
      expect(conversa, f).toBeGreaterThan(0);
      expect(triagem, f).toBeGreaterThan(conversa);
    }
  });

  it("o dono da conversa: triagem, assistente ou ninguém, e só lê", () => {
    const c = corpoDaFuncao(SQL, "triagem_dono_da_conversa");
    expect(c).toContain("STABLE SECURITY DEFINER");
    expect(c).toContain("'triagem'");
    expect(c).toContain("'assistente'");
    expect(c).toContain("'ninguem'");
    expect(c).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
    expect(c).toContain("cfg.agente_apos_triagem");
    // ensaio não é dono (senão o contato fica sem resposta nos dias de ensaio com a assistente ligada)
    expect(c).toContain("CASE WHEN t.modo = 'ensaio' OR cfg.estado = 'ensaio' THEN 'assistente' ELSE 'triagem' END");
    // pausada por gente e devolvida à IA (modo auto, sem responsável) volta para a assistente; pulada e o resto, ninguém
    expect(c).toContain("c.modo = 'auto' AND c.responsavel_id IS NULL AND c.atribuido_para IS NULL");
    expect(c).not.toMatch(/'pulada'\s*THEN\s*'assistente'/);
  });

  it("desligar: a pública exige usuário e permissão; a interna do freio trava a conversa antes da triagem e só apaga o que cancelou", () => {
    const pub = corpoDaFuncao(SQL, "triagem_desligar");
    expect(pub).toContain("IF p_usuario IS NULL OR NOT (public.has_permission(p_usuario, 'whatsapp.manage')");
    expect(pub).toContain("public.has_permission(p_usuario, 'configuracoes.manage')");
    expect(pub).toContain("RETURN public._triagem_desligar_interno(p_motivo, p_usuario)");
    expect(pub).not.toContain("UPDATE");
    const c = corpoDaFuncao(SQL, "_triagem_desligar_interno");
    expect(c).toContain("_triagem_desligar_config(v_motivo, p_usuario)");
    expect(c).toContain("_triagem_pausar(t.id, 'pausada_desligada', 'desligada')");
    expect(c).toContain("status = 'cancelada'");
    // ordem de travas: advisory, conversa FOR UPDATE, só então a triagem; conversas em ordem de id; configuração por último
    expect(c).toContain("ORDER BY conversa_id LOOP");
    const advisory = c.indexOf("pg_advisory_xact_lock");
    const conversa = c.indexOf("FROM public.whatsapp_conversas WHERE id = t.conversa_id FOR UPDATE");
    const pausar = c.indexOf("_triagem_pausar(t.id");
    const config = c.indexOf("_triagem_desligar_config(v_motivo");
    expect(advisory).toBeGreaterThan(0);
    expect(conversa).toBeGreaterThan(advisory);
    expect(pausar).toBeGreaterThan(conversa);
    expect(config).toBeGreaterThan(pausar);
    // só apaga mensagem cuja fila ESTE comando cancelou (nunca uma que o despachante já mandou), em dois comandos
    expect(c).toContain("array_agg(mensagem_id) FILTER (WHERE mensagem_id IS NOT NULL)");
    expect(c).toContain("DELETE FROM public.whatsapp_mensagens WHERE id = ANY (v_msgs) AND status = 'pendente' AND direcao = 'saida'");
    expect(c).not.toContain("NOT EXISTS (SELECT 1 FROM public.whatsapp_fila_envio f WHERE f.mensagem_id = m.id");
    // e a caixa volta a mostrar como última mensagem a que existe de verdade (como _triagem_cancelar_pendentes)
    expect(c).toContain("_triagem_recompor_ultima(v_convs, v_textos)");
    const cfg = corpoDaFuncao(SQL, "_triagem_desligar_config");
    expect(cfg).toContain("estado = 'desligada'");
    expect(cfg).not.toMatch(/whatsapp_triagens|whatsapp_conversas/);
  });

  it("varrer: expira sem lembrete e sem esperar trava, não leva resposta não aplicada, freia só depois de desligada_em, enfileira o aviso", () => {
    const c = corpoDaFuncao(SQL, "triagem_varrer");
    expect(c).toContain("'expirada'");
    expect(c).toContain("cfg.espera_resposta_min");
    expect(c).toContain("freio_falhas_de_envio");
    expect(c).toContain("freio_erros_de_leitura");
    expect(c).toContain("freio_textos_barrados");
    expect(c).toContain("cfg.retencao_eventos_dias");
    // o freio conta só o que aconteceu depois do último desligar
    expect(c).toContain("v_desde := coalesce(cfg.desligada_em, '-infinity'::timestamptz)");
    expect(c.match(/greatest\(now\(\) - interval '[^']+', v_desde\)/g)!.length).toBe(3);
    // expiração: conversa travada ANTES de tocar na triagem, sem esperar, e sem levar resposta recebida e não aplicada
    const exp = c.slice(c.indexOf("FOR t IN SELECT x.id, x.conversa_id FROM public.whatsapp_triagens x"), c.indexOf("UPDATE public.whatsapp_fila_envio f"));
    expect(exp).toContain("pg_try_advisory_xact_lock");
    expect(exp).toContain("FROM public.whatsapp_conversas WHERE id = t.conversa_id FOR UPDATE SKIP LOCKED");
    expect(exp.indexOf("FOR UPDATE SKIP LOCKED")).toBeLessThan(exp.indexOf("UPDATE public.whatsapp_triagens x"));
    expect(exp).toContain("m.created_at > now() - interval '10 minutes'");
    expect(exp).toContain("e.triagem_id = x.id AND e.mensagem_id = m.id AND e.tipo = 'entrada'");
    // a mesma decisão de aviso do TypeScript (maquina.ts): nome, CEP, primeira vez, alternativo, endereço ou preço
    for (const campo of ["x.nome_informado IS NOT NULL", "x.cep IS NOT NULL", "x.primeira_vez IS NOT NULL", "x.telefone_alternativo IS NOT NULL", "x.endereco_texto IS NOT NULL", "x.pediu_preco"]) {
      expect(exp, campo).toContain(campo);
    }
    // aviso: ENFILEIRADO em notificacoes_fila com chave própria, só depois de enfileirar fica marcado; só o primeiro nome
    const aviso = c.slice(c.indexOf("v_grupo := public.grupo_equipe_destino();"));
    expect(aviso).toContain("public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'aviso_grupo_equipe', 'whatsapp_atendimento'");
    expect(aviso).toContain("'triagem_aviso:' || t.id");
    expect(aviso.indexOf("enfileirar_notificacao")).toBeLessThan(aviso.indexOf("SET aviso_grupo_enviado_em = now()"));
    expect(aviso).toContain("aviso_grupo_enviado_em IS NULL");
    expect(aviso).toContain("x.status NOT IN ('pausada_humano', 'pausada_desligada', 'pulada')");
    expect(aviso).toContain("split_part(coalesce(x.nome_informado, ''), ' ', 1) AS primeiro_nome");
    expect(aviso).not.toMatch(/\bx\.cep\b|telefone_chat|cep_endereco|telefone_normalizado/);
    expect(aviso).toContain("v_grupo IS NULL");
    // erro de aviso não vira evento 'erro' (o freio de erros desligaria tudo por causa de um aviso)
    expect(aviso).toContain("RAISE WARNING");
    expect(aviso).not.toMatch(/INSERT INTO public\.whatsapp_triagem_eventos/);
  });

  it("a entidade do aviso é uma que o CHECK vivo de notificacoes_fila aceita", () => {
    expect(SQL).toContain("'whatsapp_atendimento'");
    expect(SQL).not.toMatch(/'whatsapp_triagem'/);
  });
});

describe("triagem B4: privacidade e dados", () => {
  it("eventos sem conteúdo: CHECK recursivo recusa chave de texto, nome, telefone, CEP, endereço; variaveis e codigos só com nomes", () => {
    expect(SQL).toContain("triagem_evento_detalhe_sem_conteudo");
    // jsonb_path_exists com $.** olha dentro de objetos e listas, não só a raiz
    expect(SQL).toContain("jsonb_path_exists(detalhe,");
    expect(SQL).toContain("'strict $.** ? (@.type() == \"object\").keyvalue()");
    const chaves = /like_regex "\^\(([^)]*)\)\$"/.exec(SQL)![1].split("|");
    for (const chave of ["texto", "mensagem", "conteudo", "nome", "telefone", "cep", "endereco", "email", "resposta", "frase"]) {
      expect(chaves, chave).toContain(chave);
    }
    expect(SQL).toContain("triagem_evento_variaveis_so_nomes");
    expect(SQL).toContain('like_regex "^[a-z_]{1,40}$"');
    expect(SQL).toContain("triagem_evento_codigos_so_codigos");
    // o servidor não passa valor para o evento: as listas são limpas antes de gravar
    expect(corpoDaFuncao(SQL, "_triagem_lista_limpa")).toContain("WHERE x ~ p_formato AND ord <= 20");
    expect(SQL).toContain("octet_length(detalhe::text) <= 2000");
    expect(SQL).toContain("CREATE UNIQUE INDEX whatsapp_triagem_eventos_entrada_unica ON public.whatsapp_triagem_eventos (triagem_id, mensagem_id)\n  WHERE tipo = 'entrada'");
  });

  it("a triagem guarda hash da última entrada e não o texto; o alternativo nasce não verificado", () => {
    expect(SQL).toContain("ultima_entrada_hash text CHECK");
    expect(SQL).toContain("telefone_alternativo_verificado boolean NOT NULL DEFAULT false");
    expect(SQL).not.toMatch(/ultima_entrada_texto|texto_da_entrada|ultima_mensagem_texto/);
  });

  it("bloqueio: só hash de telefone e de lid, uma chave única para cada, nenhum número em claro", () => {
    expect(SQL).toContain("telefone_hash text CHECK (telefone_hash IS NULL OR telefone_hash ~ '^[0-9a-f]{64}$')");
    expect(SQL).toContain("lid_hash text CHECK (lid_hash IS NULL OR lid_hash ~ '^[0-9a-f]{64}$')");
    expect(SQL).toContain("CHECK (telefone_hash IS NOT NULL OR lid_hash IS NOT NULL)");
    expect(SQL).not.toMatch(/telefone_normalizado text PRIMARY KEY/);
    expect(SQL.match(/CREATE UNIQUE INDEX whatsapp_automacao_bloqueios_/g)!.length).toBe(3);
    const h = corpoDaFuncao(SQL, "_triagem_hash");
    expect(h).toContain("sha256(");
    const b = corpoDaFuncao(SQL, "_triagem_bloqueado");
    for (const chave of ["b.conversa_id = c.id", "b.telefone_hash", "b.lid_hash"]) expect(b).toContain(chave);
  });

  it("o estado respeita o que a máquina de etapas conhece e o modo ensaio nunca fica 'ativa'", () => {
    expect(SQL).toContain("CHECK (status <> 'ensaio' OR modo = 'ensaio')");
    expect(SQL).toContain("CHECK (NOT (modo = 'ensaio' AND status = 'ativa'))");
    const passosB1 = /passo IS NULL OR passo IN \(([^)]*)\)/.exec(B1)![1];
    const passosB4 = /passo text CHECK \(passo IS NULL OR passo IN \(([^)]*)\)/.exec(SQL)![1];
    expect([...passosB4.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...passosB1.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  });

  it("nome validado no banco, igual ao do TypeScript: 6 palavras (4 fora de, da, do), sem ponto, sem link, nunca o que o quadro entende", () => {
    const c = corpoDaFuncao(SQL, "_triagem_nome_valido");
    expect(c).toContain("cardinality(v_palavras) > 6");
    expect(c).toContain("v_principais = 0 OR v_principais > 4");
    expect(c).toContain("ARRAY['da', 'de', 'do', 'das', 'dos', 'di', 'du']");
    expect(c).toContain("v_letras < 2 OR v_letras > 20");
    expect(c).toContain("> 15 THEN RETURN false");
    expect(c).toContain("char_length(v_nome) > 60");
    // a palavra não aceita ponto: www.exemplo.com, oi.com, bit.ly e meusite.com.br caem na primeira regra
    const regexPalavra = /v_palavra !~ '([^']*(?:''[^']*)*)'/.exec(c)![1];
    expect(regexPalavra).not.toContain(".");
    expect(c).toContain("FROM public.whatsapp_triagem_respostas r");
    expect(c).toContain("ramo IN ('todos', 'cliente', 'nome')");
  });

  it("os mesmos limites do banco no TypeScript: 6 palavras, 4 principais, primeiro nome até 15, 60 letras", () => {
    for (const [entrada, ok] of [
      ["Maria de Lourdes Santos Lima", true],
      ["Maria Aparecida dos Santos Silva", true],
      ["Maria Souza Lima Santos Pereira Alves", false],
      ["Um Dois Tres Quatro Cinco", false],
      ["www.exemplo.com", false],
      ["bit.ly", false],
      ["Pix", false],
    ] as [string, boolean][]) {
      expect(extrairNome(entrada).ok, entrada).toBe(ok);
    }
  });
});

describe("triagem B4: o banco e o TypeScript contam do mesmo jeito", () => {
  it("sorteio: resto de 100 dos 8 últimos dígitos hexadecimais, igual a numeroDoIdentificador", () => {
    expect(numeroDoIdentificador("00000000-0000-0000-0000-0000ffffffff") % 100).toBe(95);
    expect(numeroDoIdentificador("00000000-0000-0000-0000-000000000000") % 100).toBe(0);
    expect(SQL).toContain("_triagem_sorteio('00000000-0000-0000-0000-0000ffffffff') <> 95");
    expect(SQL).toContain("right(replace(p_conversa::text, '-', ''), 8)");
  });

  it("sinais de robô que dependem só do texto são os mesmos do código", () => {
    const amostras: [string, boolean][] = [
      ["Acesse https://golpe.exemplo agora", true],
      ["Digite 1 para falar com o atendente", true],
      ["*Atenção* sua fatura vence hoje", true],
      ["Seu código de verificação é 123456", true],
      ["Olá, tudo bem? Queria fazer um orçamento", false],
      ["Maria Souza", false],
    ];
    for (const [texto, robo] of amostras) expect(detectarRobo({ texto, quadro: SEMENTES_DO_QUADRO }).suspeito, texto).toBe(robo);
    const c = corpoDaFuncao(SQL, "_triagem_parece_robo");
    for (const sinal of ["> 300", "https?://|www", "negrito_no_comeco", "(responda|digite)", "intencao = 'automatica'"]) expect(c).toContain(sinal);
  });
});

describe("triagem B4: terceira revisão (degrau atual, gatilho de pausa, dono sem linha, lote, índices)", () => {
  it("descer a escada vale para a triagem em curso: as três portas conferem o degrau ATUAL para a conversa", () => {
    const d = corpoDaFuncao(SQL, "_triagem_degrau_permite");
    expect(d).toContain("STABLE SECURITY DEFINER");
    expect(d).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
    // desligada nunca; triagem em ensaio não envia; estado ensaio não envia de verdade; teste só número de teste;
    // parcial número de teste ou sorteio dentro do percentual ATUAL; ligada sim
    expect(d).toContain("IF cfg.estado = 'desligada' THEN RETURN false; END IF;");
    expect(d).toContain("IF p_modo = 'ensaio' THEN RETURN true; END IF;");
    expect(d).toContain("IF cfg.estado = 'ensaio' THEN RETURN false; END IF;");
    expect(d).toContain("IF cfg.estado = 'ligada' THEN RETURN true; END IF;");
    expect(d).toContain("v_tel = ANY (cfg.numeros_teste)");
    expect(d).toContain("IF cfg.estado = 'teste' THEN RETURN v_teste; END IF;");
    expect(d).toContain("RETURN v_teste OR public._triagem_sorteio(p_conversa) < cfg.percentual;");
    for (const f of ["triagem_ler_ou_abrir", "triagem_aplicar", "triagem_enviar"]) {
      const c = corpoDaFuncao(SQL, f);
      expect(c, f).toContain("IF NOT public._triagem_degrau_permite(c.id, t.modo) THEN");
      expect(c, f).toContain("_triagem_pausar(t.id, 'pausada_desligada', 'fora_do_degrau')");
    }
    // triagem_enviar para a triagem e devolve o motivo; triagem_aplicar não grava nada depois disso
    expect(corpoDaFuncao(SQL, "triagem_enviar")).toContain("'motivo', 'fora_do_degrau'");
    const a = corpoDaFuncao(SQL, "triagem_aplicar");
    expect(a).toContain("v_envio_res ->> 'motivo' = 'fora_do_degrau'");
    // triagem_enviar trava na mesma ordem das outras (advisory, conversa, triagem)
    const e = corpoDaFuncao(SQL, "triagem_enviar");
    expect(e.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(0);
    expect(e.indexOf("FROM public.whatsapp_conversas WHERE id = t.conversa_id FOR UPDATE")).toBeGreaterThan(e.indexOf("pg_advisory_xact_lock"));
    // a checagem do degrau vem depois da de gente na conversa e antes do texto montado ser revalidado e enfileirado
    expect(e.indexOf("_triagem_degrau_permite")).toBeGreaterThan(e.indexOf("_triagem_humano_na_conversa"));
    expect(e.indexOf("_triagem_degrau_permite")).toBeLessThan(e.indexOf("INSERT INTO public.whatsapp_mensagens"));
  });

  it("triagem_dono_da_conversa devolve ninguem para grupo, bloqueado, robô e inexistente também sem linha de triagem", () => {
    const c = corpoDaFuncao(SQL, "triagem_dono_da_conversa");
    const semLinha = c.slice(c.indexOf("IF NOT FOUND THEN"), c.indexOf("IF public._triagem_em_andamento"));
    expect(semLinha).toContain("c.telefone ~* '(-group|@g\\.us)'");
    expect(semLinha).toContain("public._triagem_bloqueado(c.id)");
    expect(semLinha).toContain("public._triagem_parece_robo(");
    expect(semLinha).toContain("ORDER BY m.created_at, m.id LIMIT 1");
    expect(semLinha.match(/RETURN 'ninguem'/g)!.length).toBe(3);
    expect(semLinha.trimEnd().endsWith("END IF;")).toBe(true);
    expect(semLinha).toContain("RETURN 'assistente';");
  });

  it("ultima_mensagem e ultima_mensagem_at são recompostas também nos DELETE em lote (desligar e varrer, passo 4)", () => {
    const r = corpoDaFuncao(SQL, "_triagem_recompor_ultima");
    expect(r).toContain("ultima_mensagem = coalesce(");
    expect(r).toContain("ultima_mensagem_at = coalesce(");
    expect(r).toContain("c.id = ANY (p_conversas) AND c.ultima_mensagem = ANY (p_textos)");
    for (const f of ["_triagem_cancelar_pendentes", "_triagem_desligar_interno", "triagem_varrer"]) {
      expect(corpoDaFuncao(SQL, f), f).toContain("_triagem_recompor_ultima(");
    }
    // em dois comandos: a fila é cancelada e depois a mensagem apagada (a fila aponta para a mensagem)
    for (const f of ["_triagem_desligar_interno", "triagem_varrer"]) {
      const c = corpoDaFuncao(SQL, f);
      expect(c, f).toContain("DELETE FROM public.whatsapp_mensagens WHERE id = ANY (v_msgs)");
      expect(c, f).not.toContain("DELETE FROM public.whatsapp_mensagens m USING canc");
    }
  });

  it("as cinco chaves estrangeiras para mensagem e atendimento têm índice, e a conferência falha se faltar", () => {
    for (const idx of [
      "whatsapp_triagens_atendimento ON public.whatsapp_triagens (atendimento_id)",
      "whatsapp_triagens_primeira_mensagem ON public.whatsapp_triagens (primeira_mensagem_id)",
      "whatsapp_triagens_ultima_entrada ON public.whatsapp_triagens (ultima_entrada_id)",
      "whatsapp_triagens_ultima_pergunta ON public.whatsapp_triagens (ultima_pergunta_mensagem_id)",
      "whatsapp_triagem_eventos_mensagem ON public.whatsapp_triagem_eventos (mensagem_id)",
    ]) expect(SQL).toContain(`CREATE INDEX ${idx};`);
    expect(SQL).toContain("chave(s) estrangeira(s) das tabelas da triagem sem índice");
    // toda coluna que referencia outra tabela está coberta por índice na própria migração
    const tabelas = ["whatsapp_triagens", "whatsapp_triagem_eventos", "whatsapp_automacao_bloqueios"];
    for (const t of tabelas) {
      const bloco = SQL.slice(SQL.indexOf(`CREATE TABLE public.${t} (`), SQL.indexOf(");", SQL.indexOf(`CREATE TABLE public.${t} (`)));
      const colunas = [...bloco.matchAll(/^\s+(\w+) uuid(?: NOT NULL)?(?: UNIQUE)? REFERENCES/gm)].map((m) => m[1]);
      expect(colunas.length, t).toBeGreaterThan(0);
      for (const col of colunas) {
        const coberta = new RegExp(`CREATE (?:UNIQUE )?INDEX \\w+ ON public\\.${t} \\(${col}[,)]`).test(SQL) || /UNIQUE REFERENCES/.test(bloco.split(col)[1]?.split("\n")[0] ?? "");
        expect(coberta, `${t}.${col}`).toBe(true);
      }
    }
  });

  it("o cabeçalho registra o B0 como pré-requisito do B5 e a prova sem sessão da página seja-parceiro", () => {
    expect(BRUTO).toContain("PRÉ-REQUISITOS DO B5");
    expect(BRUTO).toMatch(/PR B0[\s\S]{0,200}#451[\s\S]{0,60}pré-requisito do B5/);
    expect(BRUTO).toContain("seja-parceiro");
    expect(BRUTO).toContain("PROVA POR REQUISIÇÃO SEM SESSÃO");
    expect(BRUTO).toContain("não mostra preço");
  });
});
