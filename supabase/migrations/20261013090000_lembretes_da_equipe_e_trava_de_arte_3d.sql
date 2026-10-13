-- Lembretes diários do financeiro e da operação, e a trava de arte nas OS 3D
-- (13/10/2026).
--
-- Pedido do dono, depois do lembrete da gerência (#124/#125):
--   * "a Cibele e o Leonardo podem receber o mesmo tipo de lembrete, cada um com
--     a sua lista" — Cibele é o FINANCEIRO, Leonardo é a OPERAÇÃO;
--   * "pode dispensar essa trava": a OS de impressão 3D não passa por aprovação
--     de arte, e `os_bloqueios_para` barrava toda OS 3D que fosse para a
--     produção com "Arte ainda não aprovada".
--
-- PARTE 0, A QUE RODA SOZINHA ANTES DE TUDO (valor novo de enum não pode ser
-- usado na transação em que nasce):
--   ALTER TYPE public.automacao_gatilho ADD VALUE IF NOT EXISTS 'lembrete_financeiro';
--   ALTER TYPE public.automacao_gatilho ADD VALUE IF NOT EXISTS 'lembrete_operacao';

-- 1. A OS 3D não tem arte para aprovar ---------------------------------------
-- A OS é 3D quando algum orçamento 3D aponta para ela (os_id) ou para o
-- orçamento de onde ela nasceu. Só a trava "arte_nao_aprovada" sai: o
-- pagamento, o arquivo final, o material e a margem continuam valendo.
DO $arte3d$
DECLARE
  v_def text := pg_get_functiondef('public.os_bloqueios_para(uuid, public.status_os)'::regprocedure);
  v_de text := $a$    IF NOT public.arte_aprovada_da_os(os_bloqueios_para.os_id) THEN$a$;
  v_para text := $b$    -- OS de impressão 3D não passa por aprovação de arte (decisão do dono,
    -- 13/10/2026): o modelo é o que o cliente aprovou no orçamento 3D.
    IF NOT public.arte_aprovada_da_os(os_bloqueios_para.os_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.orcamentos_3d t3
         WHERE t3.os_id = os_bloqueios_para.os_id
            OR (t3.orcamento_id IS NOT NULL AND t3.orcamento_id = v_os.orcamento_id)
       ) THEN$b$;
BEGIN
  IF position('orcamentos_3d t3' IN v_def) > 0 THEN
    RETURN; -- já trocado
  END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'os_bloqueios_para: o teste da arte não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$arte3d$;

-- 2. Dois ajudantes de texto (só a varredura chama) ---------------------------
CREATE OR REPLACE FUNCTION public._reais(p numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT 'R$ ' || translate(to_char(coalesce(p, 0), 'FM999,999,990.00'), ',.', '.,')
$function$;

CREATE OR REPLACE FUNCTION public._dias(p integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT greatest(coalesce(p, 0), 0)::text || CASE WHEN greatest(coalesce(p, 0), 0) = 1 THEN ' dia' ELSE ' dias' END
$function$;

REVOKE ALL ON FUNCTION public._reais(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dias(integer) FROM PUBLIC, anon, authenticated;

-- 3. A varredura: uma mensagem por lista, nada pendente = nada enviado --------
CREATE OR REPLACE FUNCTION public.lembretes_da_equipe()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Belem')::date;
  v_qtd int;
  v_total numeric;
  v_lista text;
  v_fin text := '';
  v_op text := '';
  v_nfin int := 0;
  v_nop int := 0;
  v_enf_fin int := 0;
  v_enf_op int := 0;
  v_ctx jsonb;
BEGIN
  -- ===================== FINANCEIRO =====================

  -- 1. Contas a pagar vencidas.
  SELECT count(*), coalesce(sum(l.valor), 0),
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT cp.valor,
           row_number() OVER (ORDER BY cp.vencimento, cp.id) AS ordem,
           format('%s · %s · %s · venceu há %s',
             coalesce(nullif(btrim(cp.fornecedor), ''), 'sem fornecedor'),
             left(coalesce(nullif(btrim(cp.descricao), ''), 'sem descrição'), 100),
             public._reais(cp.valor),
             public._dias(v_hoje - cp.vencimento)) AS linha
    FROM public.contas_pagar cp
    WHERE cp.status::text IN ('aberta', 'atrasada') AND cp.vencimento < v_hoje
  ) l;
  IF v_qtd > 0 THEN
    v_fin := concat_ws(E'\n\n', nullif(v_fin, ''), format(
      E'Contas a pagar vencidas: %s, somando %s.\n%s%s\nSe já foi paga, registre o pagamento em Caixa e contas a pagar.',
      v_qtd, public._reais(v_total), v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nfin := v_nfin + 1;
  END IF;

  -- 2. Parcelas a receber vencidas.
  SELECT count(*), coalesce(sum(l.valor), 0),
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT p.valor,
           row_number() OVER (ORDER BY p.vencimento, p.id) AS ordem,
           format('OS #%s · %s · parcela %s · %s · venceu há %s',
             coalesce(os.numero::text, 'sem OS'),
             coalesce(nullif(btrim(c.nome), ''), 'sem cliente'),
             p.parcela, public._reais(p.valor),
             public._dias(v_hoje - p.vencimento)) AS linha
    FROM public.parcelas_receber p
    JOIN public.contas_receber cr ON cr.id = p.conta_id
    LEFT JOIN public.ordens_servico os ON os.id = cr.os_id
    LEFT JOIN public.clientes c ON c.id = cr.cliente_id
    WHERE p.status <> 'paga' AND p.vencimento < v_hoje
  ) l;
  IF v_qtd > 0 THEN
    v_fin := concat_ws(E'\n\n', nullif(v_fin, ''), format(
      E'Parcelas a receber vencidas: %s, somando %s.\n%s%s\nAbra Contas a receber, dê baixa no que já entrou e cobre o resto.',
      v_qtd, public._reais(v_total), v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nfin := v_nfin + 1;
  END IF;

  -- 3. Comprovantes do portal para conferir.
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY pc.created_at, pc.id) AS ordem,
           format('%s · enviado há %s',
             coalesce(nullif(btrim(c.nome), ''), 'cliente'),
             public._dias(v_hoje - (pc.created_at AT TIME ZONE 'America/Belem')::date)) AS linha
    FROM public.portal_comprovantes pc
    LEFT JOIN public.clientes c ON c.id = pc.cliente_id
    WHERE pc.situacao = 'a_conferir'
  ) l;
  IF v_qtd > 0 THEN
    v_fin := concat_ws(E'\n\n', nullif(v_fin, ''), format(
      E'Comprovantes de pagamento enviados pelo cliente a conferir: %s.\n%s%s\nAbra o cliente, aba Portal, confira o pagamento e dê a baixa onde for o caso.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nfin := v_nfin + 1;
  END IF;

  -- 4. Comissões a pagar.
  SELECT count(*), coalesce(sum(l.valor), 0),
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT co.valor,
           row_number() OVER (ORDER BY co.created_at, co.id) AS ordem,
           format('OS #%s · %s', coalesce(os.numero::text, 'sem OS'), public._reais(co.valor)) AS linha
    FROM public.comissoes co
    LEFT JOIN public.ordens_servico os ON os.id = co.os_id
    WHERE co.status = 'a_pagar'
  ) l;
  IF v_qtd > 0 THEN
    v_fin := concat_ws(E'\n\n', nullif(v_fin, ''), format(
      E'Comissões a pagar: %s, somando %s.\n%s%s\nPague no fechamento e marque como paga em Pagamentos e comissões.',
      v_qtd, public._reais(v_total), v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nfin := v_nfin + 1;
  END IF;

  -- 5. Trabalhos entregues sem nenhuma cobrança.
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY os.numero) AS ordem,
           format('OS #%s · %s · %s', os.numero,
             coalesce(nullif(btrim(c.nome), ''), 'sem cliente'),
             left(coalesce(nullif(btrim(os.titulo), ''), 'sem título'), 50)) AS linha
    FROM public.ordens_servico os
    LEFT JOIN public.clientes c ON c.id = os.cliente_id
    WHERE os.status::text IN ('concluido', 'faturado')
      AND NOT EXISTS (SELECT 1 FROM public.contas_receber cr WHERE cr.os_id = os.id)
  ) l;
  IF v_qtd > 0 THEN
    v_fin := concat_ws(E'\n\n', nullif(v_fin, ''), format(
      E'Trabalhos entregues sem nenhuma cobrança: %s.\n%s%s\nGere a cobrança a partir da OS.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nfin := v_nfin + 1;
  END IF;

  -- ===================== OPERAÇÃO =====================

  -- 1. A fila de produção de hoje (a mais urgente primeiro).
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY os.prazo_entrega NULLS LAST, os.numero) AS ordem,
           format('OS #%s · %s · %s · %s%s', os.numero,
             coalesce(nullif(btrim(c.nome), ''), 'sem cliente'),
             left(coalesce(nullif(btrim(os.titulo), ''), 'sem título'), 40),
             initcap(replace(os.status::text, '_', ' ')),
             CASE WHEN os.prazo_entrega IS NOT NULL THEN ' · prazo ' || to_char(os.prazo_entrega, 'DD/MM') ELSE '' END) AS linha
    FROM public.ordens_servico os
    LEFT JOIN public.clientes c ON c.id = os.cliente_id
    WHERE os.status::text IN ('aguardando_producao', 'producao', 'em_producao', 'em_impressao',
                              'em_corte', 'em_acabamento', 'em_uv', 'em_laser_cnc', 'em_3d')
  ) l;
  IF v_qtd > 0 THEN
    v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
      E'Fila de produção: %s OS.\n%s%s\nComece pela de menor prazo.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nop := v_nop + 1;
  END IF;

  -- 2. Peças prontas esperando retirada ou entrega.
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY os.updated_at, os.numero) AS ordem,
           format('OS #%s · %s · %s · pronta há %s', os.numero,
             coalesce(nullif(btrim(c.nome), ''), 'sem cliente'),
             left(coalesce(nullif(btrim(os.titulo), ''), 'sem título'), 40),
             public._dias(v_hoje - (os.updated_at AT TIME ZONE 'America/Belem')::date)) AS linha
    FROM public.ordens_servico os
    LEFT JOIN public.clientes c ON c.id = os.cliente_id
    WHERE os.status::text IN ('aguardando_retirada', 'aguardando_entrega')
      AND NOT (
        os.status::text = 'aguardando_entrega'
        AND (COALESCE(os.precisa_entrega, false) OR COALESCE(os.precisa_instalacao, false))
        AND NOT EXISTS (SELECT 1 FROM public.entregas_instalacoes e WHERE e.os_id = os.id AND e.status <> 'cancelada')
      )
  ) l;
  IF v_qtd > 0 THEN
    v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
      E'Prontas esperando retirada ou entrega: %s.\n%s%s\nAvise o cliente para retirar ou programe a entrega.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nop := v_nop + 1;
  END IF;

  -- 3. Peças prontas que pedem entrega ou instalação e não têm nada agendado.
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY os.updated_at, os.numero) AS ordem,
           format('OS #%s · %s · %s', os.numero,
             coalesce(nullif(btrim(c.nome), ''), 'sem cliente'),
             left(coalesce(nullif(btrim(os.titulo), ''), 'sem título'), 40)) AS linha
    FROM public.ordens_servico os
    LEFT JOIN public.clientes c ON c.id = os.cliente_id
    WHERE os.status::text IN ('aguardando_entrega', 'em_entrega', 'em_instalacao')
      AND (COALESCE(os.precisa_entrega, false) OR COALESCE(os.precisa_instalacao, false))
      AND NOT EXISTS (SELECT 1 FROM public.entregas_instalacoes e WHERE e.os_id = os.id AND e.status <> 'cancelada')
  ) l;
  IF v_qtd > 0 THEN
    v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
      E'Prontas que pedem entrega ou instalação e não têm nada agendado: %s.\n%s%s\nAbra Entregas e agende: o cliente está esperando.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nop := v_nop + 1;
  END IF;

  -- 4. Artes esperando o aceite do cliente há mais de 2 dias.
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY os.updated_at, os.numero) AS ordem,
           format('OS #%s · %s · %s · esperando o cliente há %s', os.numero,
             coalesce(nullif(btrim(c.nome), ''), 'sem cliente'),
             left(coalesce(nullif(btrim(os.titulo), ''), 'sem título'), 40),
             public._dias(v_hoje - (os.updated_at AT TIME ZONE 'America/Belem')::date)) AS linha
    FROM public.ordens_servico os
    LEFT JOIN public.clientes c ON c.id = os.cliente_id
    WHERE os.status::text = 'aguardando_aprovacao_arte' AND os.updated_at < now() - interval '2 days'
  ) l;
  IF v_qtd > 0 THEN
    v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
      E'Artes esperando o aceite do cliente há mais de 2 dias: %s.\n%s%s\nA produção não começa sem o aceite: reenvie o link ou confirme por telefone.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nop := v_nop + 1;
  END IF;

  -- 5. Orçamentos enviados sem resposta há mais de 7 dias.
  SELECT count(*), coalesce(sum(l.valor), 0),
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT o.valor_total AS valor,
           row_number() OVER (ORDER BY coalesce(o.enviado_em, o.created_at), o.numero) AS ordem,
           format('#%s · %s · %s · %s · enviado há %s', o.numero,
             coalesce(nullif(btrim(c.nome), ''), nullif(btrim(o.contato_nome), ''), 'sem cliente'),
             left(coalesce(nullif(btrim(o.titulo), ''), 'sem título'), 40),
             public._reais(o.valor_total),
             public._dias(v_hoje - (coalesce(o.enviado_em, o.created_at) AT TIME ZONE 'America/Belem')::date)) AS linha
    FROM public.orcamentos o
    LEFT JOIN public.clientes c ON c.id = o.cliente_id
    WHERE o.status::text = 'enviado' AND coalesce(o.enviado_em, o.created_at) < now() - interval '7 days'
  ) l;
  IF v_qtd > 0 THEN
    v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
      E'Orçamentos enviados sem resposta há mais de 7 dias: %s, somando %s.\n%s%s\nLigue ou mande mensagem antes de expirar.',
      v_qtd, public._reais(v_total), v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nop := v_nop + 1;
  END IF;

  -- 6. Orçamentos sem nenhum item (o 3D tem os itens no orçamento 3D).
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY o.created_at, o.numero) AS ordem,
           format('#%s · %s · %s · %s há %s', o.numero,
             coalesce(nullif(btrim(c.nome), ''), nullif(btrim(o.contato_nome), ''), 'sem cliente'),
             left(coalesce(nullif(btrim(o.titulo), ''), 'sem título'), 40),
             o.status::text,
             public._dias(v_hoje - (o.created_at AT TIME ZONE 'America/Belem')::date)) AS linha
    FROM public.orcamentos o
    LEFT JOIN public.clientes c ON c.id = o.cliente_id
    WHERE o.status::text NOT IN ('convertido', 'rejeitado', 'expirado')
      AND NOT EXISTS (SELECT 1 FROM public.orcamento_itens i WHERE i.orcamento_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM public.orcamentos_3d t WHERE t.orcamento_id = o.id)
  ) l;
  IF v_qtd > 0 THEN
    v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
      E'Orçamentos sem nenhum item: %s.\n%s%s\nAbra e acrescente os itens, ou rejeite se foi engano.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nop := v_nop + 1;
  END IF;

  -- 7. Materiais no mínimo ou abaixo (com saldo).
  SELECT count(*), 0::numeric,
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 8)
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT row_number() OVER (ORDER BY (m.estoque / nullif(m.estoque_minimo, 0)) NULLS LAST, m.nome) AS ordem,
           format('%s · %s %s (mínimo %s)', m.nome,
             replace(trim_scale(round(m.estoque, 2))::text, '.', ','),
             coalesce(m.unidade, ''),
             replace(trim_scale(round(coalesce(m.estoque_minimo, 0), 2))::text, '.', ',')) AS linha
    FROM public.materiais m
    WHERE coalesce(m.estoque, 0) > 0 AND coalesce(m.estoque, 0) <= coalesce(m.estoque_minimo, 0)
  ) l;
  IF v_qtd > 0 THEN
    v_op := concat_ws(E'\n\n', nullif(v_op, ''), format(
      E'Materiais no mínimo ou abaixo: %s.\n%s%s\nRepor antes de faltar no meio de um trabalho.',
      v_qtd, v_lista,
      CASE WHEN v_qtd > 8 THEN format(E'\n… e mais %s', v_qtd - 8) ELSE '' END));
    v_nop := v_nop + 1;
  END IF;

  -- Silêncio quando não há nada: nem "tudo certo" todo dia.
  IF v_nfin > 0 THEN
    v_ctx := jsonb_build_object('resumo', v_fin, 'link', 'https://bexprint.com.br/dashboard',
                                'blocos', v_nfin, 'dia', v_hoje);
    v_enf_fin := public.enqueue_automacoes('lembrete_financeiro', 'equipe', NULL, v_ctx);
  END IF;
  IF v_nop > 0 THEN
    v_ctx := jsonb_build_object('resumo', v_op, 'link', 'https://bexprint.com.br/dashboard',
                                'blocos', v_nop, 'dia', v_hoje);
    v_enf_op := public.enqueue_automacoes('lembrete_operacao', 'equipe', NULL, v_ctx);
  END IF;

  RETURN jsonb_build_object(
    'financeiro', jsonb_build_object('blocos', v_nfin, 'enfileirados', v_enf_fin),
    'operacao', jsonb_build_object('blocos', v_nop, 'enfileirados', v_enf_op)
  );
END;
$function$;

COMMENT ON FUNCTION public.lembretes_da_equipe() IS
  'Varredura diária (job lembrete-equipe, 9h de Macapá, seg a sáb): monta a lista do financeiro e a da operação e enfileira UMA mensagem de cada, pelas automações dos gatilhos lembrete_financeiro e lembrete_operacao (quem recebe é o número de cada automação). Nada pendente, nada enviado.';

REVOKE ALL ON FUNCTION public.lembretes_da_equipe() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lembretes_da_equipe() TO service_role;

-- 4. Os dois gatilhos entram no motor: condição sempre passa e vale "uma na
--    fila por automação" (a mesma regra de OS atrasada) ----------------------
DO $motor$
DECLARE
  v_def text;
  v_de text;
  v_para text;
BEGIN
  v_def := pg_get_functiondef('public.automacao_condicao_ok(public.automacao_gatilho, jsonb, jsonb)'::regprocedure);
  v_de := $a$ELSIF p_gatilho IN ('pagamento_atrasado','os_atrasada','orcamento_aprovado_sem_os') THEN$a$;
  v_para := $b$ELSIF p_gatilho IN ('pagamento_atrasado','os_atrasada','orcamento_aprovado_sem_os','lembrete_financeiro','lembrete_operacao') THEN$b$;
  IF position(v_para IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
      RAISE EXCEPTION 'automacao_condicao_ok: o ramo das situações não está como esperado; revise a troca';
    END IF;
    EXECUTE replace(v_def, v_de, v_para);
  END IF;

  v_def := pg_get_functiondef('public.enqueue_automacoes(public.automacao_gatilho, text, uuid, jsonb)'::regprocedure);
  v_de := $a$p_gatilho IN ('os_atrasada','pagamento_atrasado','estoque_minimo','margem_abaixo_minimo','orcamento_aprovado_sem_os')$a$;
  v_para := $b$p_gatilho IN ('os_atrasada','pagamento_atrasado','estoque_minimo','margem_abaixo_minimo','orcamento_aprovado_sem_os','lembrete_financeiro','lembrete_operacao')$b$;
  IF position(v_para IN v_def) = 0 THEN
    IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
      RAISE EXCEPTION 'enqueue_automacoes: a lista de situações não está como esperado; revise a troca';
    END IF;
    EXECUTE replace(v_def, v_de, v_para);
  END IF;
END
$motor$;

-- 5. As automações (aparecem em Automações; dá para editar, trocar o número ou
--    desligar). O número vem do cadastro de Usuários, pelo id da pessoa: o
--    arquivo não guarda telefone. Sem telefone cadastrado, não cria.
INSERT INTO public.automacoes (nome, descricao, gatilho, condicao, ativo, acao, payload, cooldown_segundos, delay_segundos)
SELECT
  'Lembrete ao financeiro: o que está pendente',
  'Pedido do dono em 13/10/2026 (Cibele, financeiro). Todo dia, de segunda a sábado, às 9h: contas a pagar vencidas, parcelas a receber vencidas, comprovantes do portal a conferir, comissões a pagar e trabalhos entregues sem cobrança. Nada pendente, nada enviado. Para mais alguém receber, crie outra automação com este gatilho.',
  'lembrete_financeiro',
  '{}'::jsonb,
  true,
  'whatsapp',
  jsonb_build_object(
    'telefone', '55' || public.normalize_whatsapp_phone(u.telefone),
    'mensagem', E'Olá, Cibele! Lembrete do Bex Print: o que está pendente no financeiro.\n\n{{resumo}}\n\n{{link}}'
  ),
  43200,
  0
FROM public.usuarios u
WHERE u.id = 'a5bc923d-2a41-4d6d-bdf5-93929a56dea2'
  AND public.normalize_whatsapp_phone(u.telefone) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.automacoes WHERE gatilho = 'lembrete_financeiro');

INSERT INTO public.automacoes (nome, descricao, gatilho, condicao, ativo, acao, payload, cooldown_segundos, delay_segundos)
SELECT
  'Lembrete à operação: o que está na sua mão',
  'Pedido do dono em 13/10/2026 (Leonardo, operação). Todo dia, de segunda a sábado, às 9h: fila de produção, prontas esperando retirada ou entrega, prontas sem entrega agendada, artes esperando o cliente, orçamentos sem resposta ou sem item e materiais no mínimo. Nada pendente, nada enviado. Para mais alguém receber, crie outra automação com este gatilho.',
  'lembrete_operacao',
  '{}'::jsonb,
  true,
  'whatsapp',
  jsonb_build_object(
    'telefone', '55' || public.normalize_whatsapp_phone(u.telefone),
    'mensagem', E'Olá, Leonardo! Lembrete do Bex Print: o que está na sua mão hoje.\n\n{{resumo}}\n\n{{link}}'
  ),
  43200,
  0
FROM public.usuarios u
WHERE u.id = '1c72900c-a334-4caa-bd3e-6159ac68fa2f'
  AND public.normalize_whatsapp_phone(u.telefone) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.automacoes WHERE gatilho = 'lembrete_operacao');

-- 6. O job: 9h de Macapá (12h UTC), de segunda a sábado -----------------------
DO $job$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lembrete-equipe') THEN
    PERFORM cron.unschedule('lembrete-equipe');
  END IF;
  PERFORM cron.schedule(
    'lembrete-equipe',
    '0 12 * * 1-6',
    $cmd$SELECT public.lembretes_da_equipe()$cmd$
  );
END
$job$;
